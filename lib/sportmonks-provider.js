/**
 * SportmonksProvider - Fetches and normalizes soccer match data from Sportmonks API v3
 */

const SPORTMONKS_BASE_URL = process.env.SPORTMONKS_BASE_URL || 'https://api.sportmonks.com/v3/football';
const SPORTMONKS_API_TOKEN = process.env.SPORTMONKS_API_TOKEN || '';
const CACHE_TTL_MS = 20000; // 20 seconds cache

// Status mapping from Sportmonks state codes to internal enum
const STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  LIVE: 'LIVE',
  HALFTIME: 'HALFTIME',
  ENDED: 'ENDED'
};

// Known Sportmonks state codes/names (comprehensive list)
const STATE_MAP = {
  // Not started
  'NS': STATUS.NOT_STARTED,
  'TBA': STATUS.NOT_STARTED,
  'POSTP': STATUS.NOT_STARTED,
  'SUSP': STATUS.NOT_STARTED,
  'CANC': STATUS.NOT_STARTED,
  'ABD': STATUS.NOT_STARTED,
  'DELAYED': STATUS.NOT_STARTED,
  'WO': STATUS.NOT_STARTED,
  'ABANDONED': STATUS.NOT_STARTED,
  'CANCELLED': STATUS.NOT_STARTED,
  'POSTPONED': STATUS.NOT_STARTED,
  'SUSPENDED': STATUS.NOT_STARTED,
  'INTERRUPTED': STATUS.LIVE, // Match interrupted but still in progress
  // Live states - first half
  '1H': STATUS.LIVE,
  'FIRST_HALF': STATUS.LIVE,
  'INPLAY_1ST_HALF': STATUS.LIVE,
  'IH1': STATUS.LIVE,
  // Live states - second half
  '2H': STATUS.LIVE,
  'SECOND_HALF': STATUS.LIVE,
  'INPLAY_2ND_HALF': STATUS.LIVE,
  'IH2': STATUS.LIVE,
  // Live states - general
  'LIVE': STATUS.LIVE,
  'INPLAY': STATUS.LIVE,
  'IN_PLAY': STATUS.LIVE,
  'PLAYING': STATUS.LIVE,
  // Extra time
  'ET': STATUS.LIVE,
  'EXTRA_TIME': STATUS.LIVE,
  'INPLAY_ET': STATUS.LIVE,
  'ET_1H': STATUS.LIVE,
  'ET_2H': STATUS.LIVE,
  'INPLAY_ET_1ST_HALF': STATUS.LIVE,
  'INPLAY_ET_2ND_HALF': STATUS.LIVE,
  // Penalties
  'PEN_LIVE': STATUS.LIVE,
  'INPLAY_PENALTIES': STATUS.LIVE,
  'PENALTIES': STATUS.LIVE,
  // Halftime / Breaks
  'BREAK': STATUS.HALFTIME,
  'HT': STATUS.HALFTIME,
  'HALF_TIME': STATUS.HALFTIME,
  'HALFTIME': STATUS.HALFTIME,
  'HALFTIME_BREAK': STATUS.HALFTIME,
  'ET_BREAK': STATUS.HALFTIME,
  'AWAITING_ET': STATUS.HALFTIME,
  'AWAITING_PEN': STATUS.HALFTIME,
  'PAUSE': STATUS.HALFTIME,
  // Finished
  'FT': STATUS.ENDED,
  'FULL_TIME': STATUS.ENDED,
  'ENDED': STATUS.ENDED,
  'AET': STATUS.ENDED,
  'AFTER_ET': STATUS.ENDED,
  'FT_PEN': STATUS.ENDED,
  'AFTER_PEN': STATUS.ENDED,
  'AWARDED': STATUS.ENDED,
  'FINISHED': STATUS.ENDED,
};

// Track unknown states for debugging
const unknownStates = new Set();

class SportmonksProvider {
  constructor() {
    this._cache = null;
    this._cacheTime = 0;
  }

  _getApiToken() {
    return SPORTMONKS_API_TOKEN;
  }

  async _fetchWithAuth(endpoint, params = {}) {
    const token = this._getApiToken();
    if (!token) {
      console.warn('[SportmonksProvider] No SPORTMONKS_API_TOKEN set');
      return null;
    }
    const url = new URL(`${SPORTMONKS_BASE_URL}${endpoint}`);
    url.searchParams.set('api_token', token);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.error(`[SportmonksProvider] HTTP ${res.status} from ${endpoint}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error('[SportmonksProvider] Fetch error:', err.message);
      return null;
    }
  }

  async _getLivescoresCached() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTime) < CACHE_TTL_MS) {
      return this._cache;
    }
    // Include events for penalty kick detection
    const data = await this._fetchWithAuth('/livescores', {
      include: 'participants;periods;state;events'
    });
    if (data && data.data) {
      this._cache = data.data;
      this._cacheTime = now;
    }
    return this._cache || [];
  }

  _mapStatus(fixture) {
    // state can be an object with short_name, developer_name, or name
    const state = fixture.state;
    if (!state) return STATUS.NOT_STARTED;

    // Try multiple fields that Sportmonks might use
    const possibleNames = [
      state.short_name,
      state.developer_name,
      state.state,
      state.name
    ].filter(Boolean);

    for (const name of possibleNames) {
      const upperName = String(name).toUpperCase().replace(/[- ]/g, '_');
      if (STATE_MAP[name]) {
        return STATE_MAP[name];
      }
      if (STATE_MAP[upperName]) {
        return STATE_MAP[upperName];
      }
    }

    // Fallback: check state_id ranges (Sportmonks v3 specific)
    // See: https://docs.sportmonks.com/football/api/entities/states
    const stateId = state.id || fixture.state_id;
    if (stateId) {
      // State IDs based on Sportmonks v3 documentation:
      // 1 = Not Started (NS)
      // 2 = Postponed, 3 = Cancelled, 4 = TBA, 5 = Abandoned
      // 6 = 1st Half (LIVE)
      // 7 = Half-Time (HT)
      // 8 = 2nd Half (LIVE)
      // 9 = Extra Time (LIVE)
      // 10 = Extra Time 1st Half (LIVE)
      // 11 = Extra Time Half-Time (BREAK)
      // 12 = Extra Time 2nd Half (LIVE)
      // 13 = Awaiting Penalties (BREAK)
      // 14 = Penalties (LIVE)
      // 15 = Break (general break)
      // 16-21 = Various live/break states
      // 22+ = Finished states (FT, AET, FT_PEN, etc.)
      if (stateId === 1) return STATUS.NOT_STARTED;
      if (stateId >= 2 && stateId <= 5) return STATUS.NOT_STARTED;
      if (stateId >= 6 && stateId <= 21) {
        // Halftime/break states
        if (stateId === 7 || stateId === 11 || stateId === 13 || stateId === 15) {
          return STATUS.HALFTIME;
        }
        return STATUS.LIVE;
      }
      if (stateId >= 22) return STATUS.ENDED;
    }

    // Log unknown state for debugging
    const stateKey = `${state.id}:${state.short_name || state.developer_name || state.name}`;
    if (!unknownStates.has(stateKey)) {
      unknownStates.add(stateKey);
      console.warn(`[SportmonksProvider] Unknown state: id=${state.id}, short_name=${state.short_name}, developer_name=${state.developer_name}, name=${state.name}`);
    }

    return STATUS.NOT_STARTED;
  }

  _computeElapsedSeconds(fixture, previousElapsed = 0) {
    // Method 1: Try to get minute directly from fixture (most reliable)
    const directMinute = fixture.minute || fixture.clock?.minute || fixture.time?.minute;
    if (directMinute && directMinute > 0) {
      if (process.env.DEBUG_SPORTMONKS) {
        console.log(`[SportmonksProvider] Match ${fixture.id}: Using direct minute: ${directMinute}`);
      }
      return directMinute * 60;
    }

    // Method 2: Get from periods - find the active (ticking) period
    // IMPORTANT: In Sportmonks, period.minutes represents the CURRENT MATCH MINUTE,
    // not the duration of that period. So we just use the ticking period's minutes directly.
    const periods = fixture.periods;
    if (!periods || !Array.isArray(periods) || periods.length === 0) {
      return previousElapsed;
    }

    // Find the currently active (ticking) period
    const activePeriod = periods.find(p => p.ticking === true);
    if (activePeriod && activePeriod.minutes > 0) {
      if (process.env.DEBUG_SPORTMONKS) {
        console.log(`[SportmonksProvider] Match ${fixture.id}: Using active period minutes: ${activePeriod.minutes} (${activePeriod.description})`);
      }
      return activePeriod.minutes * 60;
    }

    // If no ticking period, find the most recent ended period
    // Sort by sort_order descending to get the latest
    const sortedPeriods = [...periods].sort((a, b) => (b.sort_order || 0) - (a.sort_order || 0));
    for (const period of sortedPeriods) {
      if (period.ended && period.minutes > 0) {
        if (process.env.DEBUG_SPORTMONKS) {
          console.log(`[SportmonksProvider] Match ${fixture.id}: Using ended period minutes: ${period.minutes} (${period.description})`);
        }
        return period.minutes * 60;
      }
    }

    // Fallback
    if (process.env.DEBUG_SPORTMONKS) {
      console.log(`[SportmonksProvider] Match ${fixture.id}: No valid period found, using previousElapsed: ${previousElapsed}`);
    }
    return previousElapsed;
  }

  _extractTeams(fixture) {
    const participants = fixture.participants || [];
    let home = { id: null, name: 'Home' };
    let away = { id: null, name: 'Away' };

    for (const p of participants) {
      const meta = p.meta || {};
      if (meta.location === 'home') {
        home = { id: p.id, name: p.name || 'Home' };
      } else if (meta.location === 'away') {
        away = { id: p.id, name: p.name || 'Away' };
      }
    }
    return { home, away };
  }

  _getPeriodLabel(fixture) {
    const state = fixture.state;
    if (!state) return '';
    return state.short_name || state.name || '';
  }

  // Count penalty shootout kicks from events
  _countPenaltyKicks(fixture) {
    const events = fixture.events;
    if (!events || !Array.isArray(events)) return 0;

    // Sportmonks event types for penalties:
    // type_id 21 = Penalty (shootout)
    // type_id 14 = Missed Penalty (shootout)
    // We can also check the 'section' field = 'penalty_shootout'
    let penaltyKicks = 0;
    for (const event of events) {
      // Check if event is a penalty shootout event
      const typeId = event.type_id;
      const section = event.section || '';
      const typeName = (event.type?.name || event.type || '').toLowerCase();

      // Multiple ways to identify penalty shootout events
      if (section === 'penalty_shootout' ||
          typeId === 21 || typeId === 14 ||
          typeName.includes('penalty shootout') ||
          (typeName.includes('penalty') && event.minute > 120)) {
        penaltyKicks++;
      }
    }
    return penaltyKicks;
  }

  _normalizeFixture(fixture, previousElapsed = 0) {
    const status = this._mapStatus(fixture);
    const { home, away } = this._extractTeams(fixture);
    const elapsedSeconds = this._computeElapsedSeconds(fixture, previousElapsed);
    const startTime = fixture.starting_at || fixture.starting_at_timestamp
      ? new Date(fixture.starting_at || fixture.starting_at_timestamp * 1000).toISOString()
      : null;

    // Debug: log match state info (only first time or on status issues)
    const state = fixture.state;
    if (state && process.env.DEBUG_SPORTMONKS) {
      console.log(`[SportmonksProvider] Match ${fixture.id}: state_id=${state.id}, short_name=${state.short_name}, developer_name=${state.developer_name} -> ${status}`);
    }

    return {
      matchId: String(fixture.id),
      status,
      elapsedSeconds,
      startTime,
      homeTeam: home,
      awayTeam: away,
      periodLabel: this._getPeriodLabel(fixture),
      penaltyKicks: this._countPenaltyKicks(fixture),
      raw: fixture
    };
  }

  async listMatches() {
    const fixtures = await this._getLivescoresCached();
    if (!fixtures || !Array.isArray(fixtures)) return [];
    return fixtures.map(f => this._normalizeFixture(f));
  }

  async getMatchState(matchId, previousElapsed = 0) {
    // Try cached livescores first
    const cached = await this._getLivescoresCached();
    if (cached && Array.isArray(cached)) {
      const found = cached.find(f => String(f.id) === String(matchId));
      if (found) {
        return this._normalizeFixture(found, previousElapsed);
      }
    }

    // Fallback: fetch individual fixture
    const data = await this._fetchWithAuth(`/fixtures/${matchId}`, {
      include: 'participants;periods;state;events'
    });
    if (data && data.data) {
      return this._normalizeFixture(data.data, previousElapsed);
    }
    return null;
  }

  clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }
}

module.exports = { SportmonksProvider, STATUS };
