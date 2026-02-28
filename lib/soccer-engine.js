/**
 * Soccer Engine - Manages soccer matches, slices, aggregation, and real-time updates
 *
 * Data Model:
 * - Aggregates stored as: matchId -> roomKey -> period -> sliceIndex -> { counts, total }
 * - Periods: '1H', '2H', 'ET1', 'ET2', 'PEN'
 * - SliceIndex is 0-based within each period
 *   - 1H/2H: 0-44 = regular time (min 1-45), 45+ = stoppage
 *   - ET1/ET2: 0-14 = regular time (15 min), 15+ = stoppage
 *   - PEN: 0+ = kick number (alternating T1, T2)
 */

const fs = require('fs');
const path = require('path');
const { SportmonksProvider, STATUS } = require('./sportmonks-provider');

// Each slice = 1 minute (60 seconds)
const SLICE_SECONDS = parseInt(process.env.SOCCER_SLICE_SECONDS, 10) || 60;
const POLL_SECONDS = parseInt(process.env.SOCCER_POLL_SECONDS, 10) || 30;

// Room keys
const ROOM_GLOBAL = 'GLOBAL';
const ROOM_HOME = 'HOME';
const ROOM_AWAY = 'AWAY';

// Period constants
const PERIOD = {
  FIRST_HALF: '1H',
  HALF_TIME: 'HT',
  SECOND_HALF: '2H',
  EXTRA_TIME_1: 'ET1',
  EXTRA_TIME_BREAK: 'ET_HT',
  EXTRA_TIME_2: 'ET2',
  PENALTIES: 'PEN',
  ENDED: 'FT'
};

// Period config: regular minutes and base minute for display
const PERIOD_CONFIG = {
  [PERIOD.FIRST_HALF]: { regularSlices: 45, baseMinute: 1 },      // 1-45, stoppage 45+1...
  [PERIOD.SECOND_HALF]: { regularSlices: 45, baseMinute: 46 },    // 46-90, stoppage 90+1...
  [PERIOD.EXTRA_TIME_1]: { regularSlices: 15, baseMinute: 91 },   // 91-105, stoppage 105+1...
  [PERIOD.EXTRA_TIME_2]: { regularSlices: 15, baseMinute: 106 },  // 106-120, stoppage 120+1...
  [PERIOD.PENALTIES]: { regularSlices: 0, baseMinute: 0 }         // Kick-based, not time-based
};

class SoccerEngine {
  constructor(emotionsGetter, saveArchiveFn, getArchiveFn, deleteArchiveFn) {
    this.provider = new SportmonksProvider();
    this._getEmotions = emotionsGetter;
    this._saveArchive = saveArchiveFn;
    this._getArchive = getArchiveFn;
    this._deleteArchive = deleteArchiveFn;

    // In-memory match registry
    this.matches = new Map();

    // Aggregation: matchId -> roomKey -> period -> sliceIndex -> { counts, total }
    this.aggregates = new Map();

    // SSE clients for soccer: matchId -> Set<res>
    this.sseClients = new Map();

    // Ticker interval handle
    this._tickerHandle = null;

    // World Cup rooms config
    this._worldCupRoomsPath = path.join(__dirname, '..', 'data', 'soccer', 'worldcupRooms.json');
    this._worldCupRooms = this._loadWorldCupRooms();
  }

  _loadWorldCupRooms() {
    try {
      if (fs.existsSync(this._worldCupRoomsPath)) {
        const raw = fs.readFileSync(this._worldCupRoomsPath, 'utf8');
        return JSON.parse(raw) || {};
      }
    } catch (e) {
      console.warn('[SoccerEngine] Could not load worldcupRooms.json:', e.message);
    }
    return {};
  }

  _saveWorldCupRooms() {
    try {
      const dir = path.dirname(this._worldCupRoomsPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._worldCupRoomsPath, JSON.stringify(this._worldCupRooms, null, 2));
    } catch (e) {
      console.error('[SoccerEngine] Could not save worldcupRooms.json:', e.message);
    }
  }

  isWorldCupRoomsEnabled(matchId) {
    return !!this._worldCupRooms[String(matchId)];
  }

  setWorldCupRoomsEnabled(matchId, enabled) {
    if (enabled) {
      this._worldCupRooms[String(matchId)] = true;
    } else {
      delete this._worldCupRooms[String(matchId)];
    }
    this._saveWorldCupRooms();
  }

  _emptyCounts() {
    const emotions = this._getEmotions();
    const obj = {};
    for (const e of emotions) obj[e.key] = 0;
    return obj;
  }

  _dominantOf(counts) {
    const emotions = this._getEmotions();
    const total = Object.values(counts).reduce((a, v) => a + (v || 0), 0);
    if (total === 0) return { key: null, count: 0 };
    let best = null;
    let bestCount = -1;
    for (const e of emotions) {
      const c = counts[e.key] || 0;
      if (c > bestCount) {
        best = e.key;
        bestCount = c;
      }
    }
    return { key: best, count: bestCount };
  }

  // Convert period + sliceIndex to display label
  sliceToLabel(period, sliceIndex) {
    const config = PERIOD_CONFIG[period];
    if (!config) return `${sliceIndex + 1}`;

    if (period === PERIOD.PENALTIES) {
      // Alternating: 0=T1-1, 1=T2-1, 2=T1-2, 3=T2-2, ...
      const kickNum = Math.floor(sliceIndex / 2) + 1;
      const team = sliceIndex % 2 === 0 ? 'T1' : 'T2';
      return `${team}-${kickNum}`;
    }

    const { regularSlices, baseMinute } = config;
    if (sliceIndex < regularSlices) {
      // Regular time
      return `${baseMinute + sliceIndex}'`;
    } else {
      // Stoppage time
      const stoppageMin = sliceIndex - regularSlices + 1;
      const lastRegularMin = baseMinute + regularSlices - 1;
      return `${lastRegularMin}+${stoppageMin}'`;
    }
  }

  // Parse period label from Sportmonks to our PERIOD constants
  // elapsedSeconds is used to disambiguate ET when just "ET" is received
  _normalizePeriod(periodLabel, elapsedSeconds = 0) {
    if (!periodLabel) return PERIOD.FIRST_HALF;
    const label = String(periodLabel).toUpperCase().replace(/[^A-Z0-9]/g, '');

    // First half
    if (label.includes('1ST') || label.includes('1H') || label.includes('FIRSTHALF') ||
        label === 'INPLAY1STHALF' || label.includes('FIRST')) {
      return PERIOD.FIRST_HALF;
    }
    // Second half
    if (label.includes('2ND') || label.includes('2H') || label.includes('SECONDHALF') ||
        label === 'INPLAY2NDHALF' || label.includes('SECOND')) {
      return PERIOD.SECOND_HALF;
    }
    // Half time
    if (label === 'HT' || label.includes('HALFTIME') || label === 'BREAK') {
      return PERIOD.HALF_TIME;
    }
    // Extra time first half (explicit)
    if (label.includes('ET1') || label.includes('EXTRATIME1') || label === 'INPLAYET1STHALF' ||
        label === 'ET1H' || label === 'EXTRATIME1STHALF') {
      return PERIOD.EXTRA_TIME_1;
    }
    // Extra time second half (explicit)
    if (label.includes('ET2') || label.includes('EXTRATIME2') || label === 'INPLAYET2NDHALF' ||
        label === 'ET2H' || label === 'EXTRATIME2NDHALF') {
      return PERIOD.EXTRA_TIME_2;
    }
    // Extra time break
    if (label === 'ETBREAK' || label.includes('AWAITINGET') || label === 'ETHT' ||
        label.includes('EXTRATIMEBREAK') || label.includes('EXTRATIMEHALFTIME')) {
      return PERIOD.EXTRA_TIME_BREAK;
    }
    // Extra time (generic) - disambiguate using elapsed time
    if (label === 'ET' || label === 'EXTRATIME' || label === 'INPLAYET') {
      const minute = this._getAbsoluteMinute(elapsedSeconds);
      // ET1 = 91-105, ET2 = 106-120+
      return minute <= 105 ? PERIOD.EXTRA_TIME_1 : PERIOD.EXTRA_TIME_2;
    }
    // Penalties
    if (label.includes('PEN') || label.includes('SHOOTOUT') || label === 'INPLAYPEN') {
      return PERIOD.PENALTIES;
    }
    // Awaiting penalties
    if (label.includes('AWAITINGPEN')) {
      return PERIOD.PENALTIES; // Treat as penalties starting
    }
    // Finished
    if (label === 'FT' || label === 'AET' || label.includes('FULLTIME') || label.includes('ENDED') ||
        label === 'FTPEN' || label === 'AFTERPEN' || label === 'AFTERET') {
      return PERIOD.ENDED;
    }

    return PERIOD.FIRST_HALF;
  }

  // Calculate sliceIndex within the current period based on absolute minute
  _computePeriodSliceIndex(period, absoluteMinute) {
    const config = PERIOD_CONFIG[period];
    if (!config) return 0;

    if (period === PERIOD.PENALTIES) {
      return 0; // Penalties handled differently
    }

    const { baseMinute } = config;
    return Math.max(0, absoluteMinute - baseMinute);
  }

  // Get current absolute minute from elapsed seconds
  _getAbsoluteMinute(elapsedSeconds) {
    return Math.floor(elapsedSeconds / 60) + 1;
  }

  // Aggregation helpers - now with period
  _getMatchAggregates(matchId) {
    if (!this.aggregates.has(matchId)) {
      this.aggregates.set(matchId, new Map());
    }
    return this.aggregates.get(matchId);
  }

  _getRoomAggregates(matchId, roomKey) {
    const matchAgg = this._getMatchAggregates(matchId);
    if (!matchAgg.has(roomKey)) {
      matchAgg.set(roomKey, new Map());
    }
    return matchAgg.get(roomKey);
  }

  _getPeriodAggregates(matchId, roomKey, period) {
    const roomAgg = this._getRoomAggregates(matchId, roomKey);
    if (!roomAgg.has(period)) {
      roomAgg.set(period, new Map());
    }
    return roomAgg.get(period);
  }

  _getSliceAggregate(matchId, roomKey, period, sliceIndex) {
    const periodAgg = this._getPeriodAggregates(matchId, roomKey, period);
    if (!periodAgg.has(sliceIndex)) {
      periodAgg.set(sliceIndex, { counts: this._emptyCounts(), total: 0 });
    }
    return periodAgg.get(sliceIndex);
  }

  // Record a tap with period info
  recordTap(matchId, roomKey, period, sliceIndex, emotion) {
    const agg = this._getSliceAggregate(matchId, roomKey, period, sliceIndex);
    if (agg.counts[emotion] === undefined) {
      agg.counts[emotion] = 0;
    }
    agg.counts[emotion]++;
    agg.total++;
    return {
      period,
      sliceIndex,
      counts: agg.counts,
      total: agg.total,
      dominant: this._dominantOf(agg.counts)
    };
  }

  // Get heatmap data organized by period
  getHeatmapSlices(matchId, roomKey) {
    const match = this.matches.get(String(matchId));
    if (!match) {
      return { ok: false, error: 'Match not found' };
    }

    const currentPeriod = match.currentPeriod || PERIOD.FIRST_HALF;
    const currentMinute = this._getAbsoluteMinute(match.elapsedSeconds);
    const roomAgg = this._getRoomAggregates(matchId, roomKey);

    // Determine which periods to include based on match progression
    const periodsToInclude = [PERIOD.FIRST_HALF, PERIOD.SECOND_HALF];
    if (match.hasExtraTime || currentPeriod === PERIOD.EXTRA_TIME_1 || currentPeriod === PERIOD.EXTRA_TIME_2) {
      periodsToInclude.push(PERIOD.EXTRA_TIME_1, PERIOD.EXTRA_TIME_2);
    }
    if (match.hasPenalties || currentPeriod === PERIOD.PENALTIES) {
      periodsToInclude.push(PERIOD.PENALTIES);
    }

    const periods = {};
    let maxTotal = 0;

    for (const period of periodsToInclude) {
      const config = PERIOD_CONFIG[period];
      const periodAgg = roomAgg.get(period) || new Map();

      // Determine max slice for this period
      let maxSlice;
      if (period === PERIOD.PENALTIES) {
        // For penalties, use penaltyKicks count (kick 1 = slice 0, etc.)
        maxSlice = (match.penaltyKicks || 1) - 1;
      } else if (period === currentPeriod) {
        maxSlice = this._computePeriodSliceIndex(period, currentMinute);
      } else {
        // Completed period - use stored max or regular slices
        maxSlice = match[`${period}MaxSlice`] || (config ? config.regularSlices - 1 : 44);
      }

      const slices = [];
      for (let i = 0; i <= maxSlice; i++) {
        const agg = periodAgg.get(i) || { counts: this._emptyCounts(), total: 0 };
        if (agg.total > maxTotal) maxTotal = agg.total;
        slices.push({
          sliceIndex: i,
          label: this.sliceToLabel(period, i),
          total: agg.total,
          dominant: this._dominantOf(agg.counts),
          counts: { ...agg.counts }
        });
      }

      periods[period] = {
        slices,
        maxSliceIndex: maxSlice,
        isActive: period === currentPeriod
      };
    }

    // Add intensity (normalized 0-1)
    for (const period of Object.keys(periods)) {
      for (const s of periods[period].slices) {
        s.intensity = maxTotal > 0 ? (s.total / maxTotal) : 0;
      }
    }

    return {
      ok: true,
      matchId: String(matchId),
      roomKey,
      currentPeriod,
      currentMinute,
      periods,
      hasExtraTime: match.hasExtraTime || false,
      hasPenalties: match.hasPenalties || false
    };
  }

  getReplaySlices(matchId, roomKey) {
    const match = this.matches.get(String(matchId));
    if (!match || !match.archived) {
      return null;
    }

    const heatmap = this.getHeatmapSlices(matchId, roomKey);
    if (!heatmap.ok) return null;

    // Calculate peak/calmest across all periods
    let peakSlice = { period: null, sliceIndex: 0, total: 0 };
    let calmestSlice = { period: null, sliceIndex: 0, total: Infinity };

    for (const [period, data] of Object.entries(heatmap.periods)) {
      for (const s of data.slices) {
        if (s.total > peakSlice.total) {
          peakSlice = { period, sliceIndex: s.sliceIndex, total: s.total, label: s.label };
        }
        if (s.total < calmestSlice.total) {
          calmestSlice = { period, sliceIndex: s.sliceIndex, total: s.total, label: s.label };
        }
      }
    }

    return {
      ...heatmap,
      meta: {
        peakSlice,
        calmestSlice: calmestSlice.total === Infinity ? { ...calmestSlice, total: 0 } : calmestSlice
      }
    };
  }

  // SSE helpers
  getSseClients(matchId) {
    const key = String(matchId);
    if (!this.sseClients.has(key)) {
      this.sseClients.set(key, new Set());
    }
    return this.sseClients.get(key);
  }

  sseWrite(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  }

  broadcastToMatch(matchId, event, data) {
    const clients = this.getSseClients(String(matchId));
    for (const res of clients) {
      this.sseWrite(res, event, data);
    }
  }

  // Ticker - polls Sportmonks every POLL_SECONDS
  startTicker() {
    if (this._tickerHandle) return;

    const tick = async () => {
      try {
        const liveMatches = await this.provider.listMatches();
        if (!liveMatches || !Array.isArray(liveMatches)) return;

        for (const normalized of liveMatches) {
          const matchId = normalized.matchId;
          let match = this.matches.get(matchId);
          // Pass elapsed seconds for ET disambiguation
          const currentPeriod = this._normalizePeriod(normalized.periodLabel, normalized.elapsedSeconds);
          const currentMinute = this._getAbsoluteMinute(normalized.elapsedSeconds);

          if (!match) {
            // Register new match
            const hasExtraTime = currentPeriod === PERIOD.EXTRA_TIME_1 || currentPeriod === PERIOD.EXTRA_TIME_2;
            const hasPenalties = currentPeriod === PERIOD.PENALTIES;
            const penaltyKicks = hasPenalties ? Math.max(1, normalized.penaltyKicks || 0) : 0;

            match = {
              matchId,
              status: normalized.status,
              elapsedSeconds: normalized.elapsedSeconds,
              currentPeriod,
              currentSliceIndex: hasPenalties ? Math.max(0, penaltyKicks - 1) : this._computePeriodSliceIndex(currentPeriod, currentMinute),
              homeTeam: normalized.homeTeam,
              awayTeam: normalized.awayTeam,
              startTime: normalized.startTime,
              periodLabel: normalized.periodLabel,
              archived: false,
              worldCupRoomsEnabled: this.isWorldCupRoomsEnabled(matchId),
              hasExtraTime,
              hasPenalties,
              penaltyKicks
            };
            this.matches.set(matchId, match);
            continue;
          }

          if (match.archived) continue;

          const prevPeriod = match.currentPeriod;
          const prevSlice = match.currentSliceIndex;
          const prevStatus = match.status;

          // Track max slice when period ends
          if (prevPeriod !== currentPeriod && prevPeriod) {
            match[`${prevPeriod}MaxSlice`] = prevSlice;
          }

          // Update match state
          match.elapsedSeconds = Math.max(match.elapsedSeconds, normalized.elapsedSeconds);
          match.currentPeriod = currentPeriod;
          match.currentSliceIndex = this._computePeriodSliceIndex(currentPeriod, currentMinute);
          match.status = normalized.status;
          match.periodLabel = normalized.periodLabel;
          match.homeTeam = normalized.homeTeam;
          match.awayTeam = normalized.awayTeam;

          // Track if match has gone to ET or penalties
          if (currentPeriod === PERIOD.EXTRA_TIME_1 || currentPeriod === PERIOD.EXTRA_TIME_2) {
            match.hasExtraTime = true;
          }
          if (currentPeriod === PERIOD.PENALTIES) {
            match.hasPenalties = true;
            // Update penalty kick count from Sportmonks events
            if (normalized.penaltyKicks > 0) {
              const prevKicks = match.penaltyKicks || 0;
              match.penaltyKicks = Math.max(prevKicks, normalized.penaltyKicks);
              match.currentSliceIndex = match.penaltyKicks - 1;
              // Broadcast if new penalty kick detected
              if (match.penaltyKicks > prevKicks) {
                this.broadcastToMatch(matchId, 'penalty_kick', {
                  matchId,
                  kickNumber: match.penaltyKicks,
                  sliceIndex: match.currentSliceIndex
                });
              }
            }
          }

          // Broadcast updates
          if (match.currentSliceIndex !== prevSlice || match.currentPeriod !== prevPeriod) {
            this.broadcastToMatch(matchId, 'slice_advance', {
              matchId,
              period: match.currentPeriod,
              sliceIndex: match.currentSliceIndex,
              label: this.sliceToLabel(match.currentPeriod, match.currentSliceIndex),
              elapsedSeconds: match.elapsedSeconds,
              status: match.status
            });
          }

          if (match.status !== prevStatus || match.currentPeriod !== prevPeriod) {
            this.broadcastToMatch(matchId, 'status_change', {
              matchId,
              status: match.status,
              period: match.currentPeriod,
              periodLabel: match.periodLabel
            });

            if (match.status === STATUS.ENDED && !match.archived) {
              this._archiveMatch(matchId);
            }
          }
        }
      } catch (err) {
        console.error('[SoccerTicker] Error:', err.message);
      }
    };

    tick();
    this._tickerHandle = setInterval(tick, POLL_SECONDS * 1000);
    console.log(`[SoccerTicker] Started, polling every ${POLL_SECONDS}s`);
  }

  stopTicker() {
    if (this._tickerHandle) {
      clearInterval(this._tickerHandle);
      this._tickerHandle = null;
      console.log('[SoccerTicker] Stopped');
    }
  }

  _archiveMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match || match.archived) return;

    match.archived = true;

    // Save aggregates to persistent storage
    const payload = {
      matchId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      startTime: match.startTime,
      elapsedSeconds: match.elapsedSeconds,
      hasExtraTime: match.hasExtraTime,
      hasPenalties: match.hasPenalties,
      periods: {}
    };

    const matchAgg = this._getMatchAggregates(matchId);
    for (const [roomKey, roomAgg] of matchAgg.entries()) {
      payload.periods[roomKey] = {};
      for (const [period, periodAgg] of roomAgg.entries()) {
        payload.periods[roomKey][period] = {};
        for (const [sliceIndex, agg] of periodAgg.entries()) {
          payload.periods[roomKey][period][sliceIndex] = agg;
        }
      }
    }

    const archiveId = `soccer-${matchId}`;
    const name = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
    this._saveArchive(archiveId, name, payload);

    this.broadcastToMatch(matchId, 'match_ended', { matchId, archived: true });
    console.log(`[SoccerEngine] Archived match ${matchId}`);
  }

  async refreshMatchState(matchId) {
    const match = this.matches.get(matchId);
    const prevElapsed = match ? match.elapsedSeconds : 0;
    const state = await this.provider.getMatchState(matchId, prevElapsed);
    if (state) {
      const currentPeriod = this._normalizePeriod(state.periodLabel, state.elapsedSeconds);
      const currentMinute = this._getAbsoluteMinute(state.elapsedSeconds);

      if (!match) {
        this.matches.set(matchId, {
          matchId: state.matchId,
          status: state.status,
          elapsedSeconds: state.elapsedSeconds,
          currentPeriod,
          currentSliceIndex: this._computePeriodSliceIndex(currentPeriod, currentMinute),
          homeTeam: state.homeTeam,
          awayTeam: state.awayTeam,
          startTime: state.startTime,
          periodLabel: state.periodLabel,
          archived: false,
          worldCupRoomsEnabled: this.isWorldCupRoomsEnabled(matchId),
          hasExtraTime: false,
          hasPenalties: false
        });
      } else {
        match.elapsedSeconds = Math.max(match.elapsedSeconds, state.elapsedSeconds);
        match.currentPeriod = currentPeriod;
        match.currentSliceIndex = this._computePeriodSliceIndex(currentPeriod, currentMinute);
        match.status = state.status;
        match.periodLabel = state.periodLabel;
      }
    }
    return this.matches.get(matchId);
  }

  // Count total taps across all rooms and periods for a match
  getTotalTaps(matchId) {
    const matchAgg = this.aggregates.get(String(matchId));
    if (!matchAgg) return 0;

    let total = 0;
    for (const roomAgg of matchAgg.values()) {
      for (const periodAgg of roomAgg.values()) {
        for (const sliceAgg of periodAgg.values()) {
          total += sliceAgg.total || 0;
        }
      }
    }
    return total;
  }

  listMatches() {
    return Array.from(this.matches.values()).map(m => ({
      matchId: m.matchId,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      startTime: m.startTime,
      status: m.status,
      period: m.currentPeriod,
      elapsedSeconds: m.elapsedSeconds,
      currentSliceIndex: m.currentSliceIndex,
      worldCupRoomsEnabled: m.worldCupRoomsEnabled || this.isWorldCupRoomsEnabled(m.matchId),
      totalTaps: this.getTotalTaps(m.matchId)
    }));
  }

  getMatchState(matchId) {
    const m = this.matches.get(String(matchId));
    if (!m) return null;
    return {
      matchId: m.matchId,
      status: m.status,
      period: m.currentPeriod,
      sliceIndex: m.currentSliceIndex,
      sliceLabel: this.sliceToLabel(m.currentPeriod, m.currentSliceIndex),
      elapsedSeconds: m.elapsedSeconds,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      startTime: m.startTime,
      periodLabel: m.periodLabel,
      archived: m.archived,
      worldCupRoomsEnabled: m.worldCupRoomsEnabled || this.isWorldCupRoomsEnabled(m.matchId),
      hasExtraTime: m.hasExtraTime || false,
      hasPenalties: m.hasPenalties || false
    };
  }

  // DEV: Simulate time advance (auto-transitions periods based on elapsed time)
  devAdvanceTime(matchId, seconds) {
    if (process.env.NODE_ENV === 'production') return null;
    const m = this.matches.get(String(matchId));
    if (!m) return null;

    m.elapsedSeconds += seconds;
    const currentMinute = this._getAbsoluteMinute(m.elapsedSeconds);

    // Auto-transition periods based on elapsed time
    let newPeriod = m.currentPeriod;
    if (currentMinute <= 45) {
      newPeriod = PERIOD.FIRST_HALF;
    } else if (currentMinute <= 90) {
      newPeriod = PERIOD.SECOND_HALF;
    } else if (currentMinute <= 105) {
      newPeriod = PERIOD.EXTRA_TIME_1;
      m.hasExtraTime = true;
    } else if (currentMinute <= 120) {
      newPeriod = PERIOD.EXTRA_TIME_2;
      m.hasExtraTime = true;
    }

    // If period changed, store max slice for previous period
    if (newPeriod !== m.currentPeriod) {
      m[`${m.currentPeriod}MaxSlice`] = m.currentSliceIndex;
      m.currentPeriod = newPeriod;
      m.periodLabel = newPeriod;
    }

    m.currentSliceIndex = this._computePeriodSliceIndex(m.currentPeriod, currentMinute);

    this.broadcastToMatch(matchId, 'slice_advance', {
      matchId: String(matchId),
      period: m.currentPeriod,
      sliceIndex: m.currentSliceIndex,
      label: this.sliceToLabel(m.currentPeriod, m.currentSliceIndex),
      elapsedSeconds: m.elapsedSeconds,
      status: m.status
    });

    return this.getMatchState(matchId);
  }

  // DEV: Set period (for testing ET, penalties)
  devSetPeriod(matchId, period, elapsedSeconds = null) {
    if (process.env.NODE_ENV === 'production') return null;
    const m = this.matches.get(String(matchId));
    if (!m) return null;

    // Store max slice for previous period
    if (m.currentPeriod) {
      m[`${m.currentPeriod}MaxSlice`] = m.currentSliceIndex;
    }

    m.currentPeriod = period;
    m.periodLabel = period;

    if (elapsedSeconds !== null) {
      m.elapsedSeconds = elapsedSeconds;
    } else {
      // Set default elapsed for period
      const config = PERIOD_CONFIG[period];
      if (config) {
        m.elapsedSeconds = (config.baseMinute - 1) * 60;
      }
    }

    const currentMinute = this._getAbsoluteMinute(m.elapsedSeconds);
    m.currentSliceIndex = this._computePeriodSliceIndex(period, currentMinute);

    if (period === PERIOD.EXTRA_TIME_1 || period === PERIOD.EXTRA_TIME_2) {
      m.hasExtraTime = true;
    }
    if (period === PERIOD.PENALTIES) {
      m.hasPenalties = true;
      m.penaltyKicks = 1; // Start at kick 1
      m.currentSliceIndex = 0; // T1-1
    }

    this.broadcastToMatch(matchId, 'status_change', {
      matchId: String(matchId),
      status: m.status,
      period: m.currentPeriod,
      periodLabel: m.periodLabel
    });

    return this.getMatchState(matchId);
  }

  // DEV: Advance to next penalty kick
  devRecordPenalty(matchId) {
    if (process.env.NODE_ENV === 'production') return null;
    const m = this.matches.get(String(matchId));
    if (!m || m.currentPeriod !== PERIOD.PENALTIES) return null;

    // Advance to next kick
    m.penaltyKicks = (m.penaltyKicks || 1) + 1;
    m.currentSliceIndex = m.penaltyKicks - 1; // kick 1 = slice 0, kick 2 = slice 1, etc.

    this.broadcastToMatch(matchId, 'penalty_kick', {
      matchId: String(matchId),
      kickNumber: m.penaltyKicks,
      sliceIndex: m.currentSliceIndex
    });

    return this.getMatchState(matchId);
  }

  // DEV: Create a mock match
  devCreateMockMatch(matchId, homeName, awayName) {
    if (process.env.NODE_ENV === 'production') return null;
    if (this.matches.has(String(matchId))) return this.matches.get(String(matchId));

    const match = {
      matchId: String(matchId),
      status: STATUS.LIVE,
      elapsedSeconds: 0,
      currentPeriod: PERIOD.FIRST_HALF,
      currentSliceIndex: 0,
      homeTeam: { id: 'mock-home', name: homeName || 'Home Team' },
      awayTeam: { id: 'mock-away', name: awayName || 'Away Team' },
      startTime: new Date().toISOString(),
      periodLabel: '1H',
      archived: false,
      worldCupRoomsEnabled: false,
      hasExtraTime: false,
      hasPenalties: false,
      penaltyKicks: 0
    };
    this.matches.set(match.matchId, match);
    return match;
  }

  // DEV: End a match
  devEndMatch(matchId) {
    if (process.env.NODE_ENV === 'production') return null;
    const m = this.matches.get(String(matchId));
    if (!m) return null;
    m.status = STATUS.ENDED;
    m.currentPeriod = PERIOD.ENDED;
    this._archiveMatch(matchId);
    return this.getMatchState(matchId);
  }
}

module.exports = { SoccerEngine, ROOM_GLOBAL, ROOM_HOME, ROOM_AWAY, STATUS, PERIOD, PERIOD_CONFIG, SLICE_SECONDS };
