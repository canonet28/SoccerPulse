(() => {
  'use strict';

  // DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Views
  const homeView = $('#home-view');
  const matchView = $('#match-view');
  const replayView = $('#replay-view');

  // Home view elements
  const liveMatches = $('#live-matches');
  const upcomingMatches = $('#upcoming-matches');
  const finishedMatches = $('#finished-matches');
  const noMatchesMsg = $('#no-matches');
  const devControls = $('#dev-controls');
  const devMatchIdInput = $('#dev-match-id');
  const devHomeInput = $('#dev-home');
  const devAwayInput = $('#dev-away');
  const devCreateBtn = $('#dev-create-btn');
  const devModeToggle = $('#dev-mode-toggle');

  // Match view elements
  const backBtn = $('#back-btn');
  const homeName = $('#home-name');
  const awayName = $('#away-name');
  const matchStatus = $('#match-status');
  const clockLabel = $('#clock-label');
  const roomSelector = $('#room-selector');
  const roomHomeBtn = $('#room-home-btn');
  const roomAwayBtn = $('#room-away-btn');
  const emojiPad = $('#emoji-pad');

  // Timeline elements
  const tabMyPicks = $('#tab-my-picks');
  const tabPulsemap = $('#tab-pulsemap');
  const timelineContainer = $('#timeline-container');
  const liveTimeline = $('#live-timeline');
  const exportTimelineBtn = $('#export-timeline-btn');

  // Track current view mode
  let currentViewMode = 'my-picks'; // 'my-picks' or 'pulsemap'

  // Dev controls
  const devMatchControls = $('#dev-match-controls');
  const devAdvance1m = $('#dev-advance-1m');
  const devAdvance2m = $('#dev-advance-2m');
  const devAdvance10m = $('#dev-advance-10m');
  const devHalftime = $('#dev-halftime');
  const devSecondHalf = $('#dev-second-half');
  const devRefresh = $('#dev-refresh');
  const devEnd = $('#dev-end');

  // Replay view elements
  const replayBackBtn = $('#replay-back-btn');
  const replayHomeName = $('#replay-home-name');
  const replayAwayName = $('#replay-away-name');
  const replayRoomSelector = $('#replay-room-selector');
  const replayRoomHomeBtn = $('#replay-room-home-btn');
  const replayRoomAwayBtn = $('#replay-room-away-btn');
  const tabReplayScrub = $('#tab-replay-scrub');
  const tabReplayPulsemap = $('#tab-replay-pulsemap');
  const panelReplayScrub = $('#panel-replay-scrub');
  const panelReplayPulsemap = $('#panel-replay-pulsemap');
  const replayPulsemapTimeline = $('#replay-pulsemap-timeline');
  const replayStats = $('#replay-stats');
  const replayScrubber = $('#replay-scrubber');
  const replayEmojiPopup = $('#replay-emoji-popup');
  const replayTimeRange = $('#replay-time-range');
  const replayInfo = $('#replay-info');
  const exportReplayPulsemap = $('#export-replay-pulsemap');

  // State
  let EMOTIONS = [];
  let EMO_MAP = new Map();
  let currentMatchId = null;
  let currentRoomKey = 'GLOBAL';
  let matchSSE = null;
  let currentMatchState = null;
  let replayRoomKey = 'GLOBAL';

  // User picks storage key - now uses period|sliceIndex format
  const getPicksKey = (matchId) => `soccerpulse_picks_v2_${matchId}`;
  const getUserPicks = (matchId) => {
    try {
      return JSON.parse(localStorage.getItem(getPicksKey(matchId)) || '{}');
    } catch (_) { return {}; }
  };
  const saveUserPick = (matchId, period, sliceIndex, emotion) => {
    const picks = getUserPicks(matchId);
    const key = `${period}|${sliceIndex}`;
    picks[key] = emotion;
    localStorage.setItem(getPicksKey(matchId), JSON.stringify(picks));
  };
  const getUserPickForSlice = (matchId, period, sliceIndex) => {
    const picks = getUserPicks(matchId);
    return picks[`${period}|${sliceIndex}`] || null;
  };

  // Period constants (must match server)
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

  // Period config: regular minutes and base minute for display (must match server)
  const PERIOD_CONFIG = {
    [PERIOD.FIRST_HALF]: { regularSlices: 45, baseMinute: 1 },
    [PERIOD.SECOND_HALF]: { regularSlices: 45, baseMinute: 46 },
    [PERIOD.EXTRA_TIME_1]: { regularSlices: 15, baseMinute: 91 },
    [PERIOD.EXTRA_TIME_2]: { regularSlices: 15, baseMinute: 106 },
    [PERIOD.PENALTIES]: { regularSlices: 0, baseMinute: 0 }
  };

  const ADMIN_TOKEN_KEY = 'soccerpulse_admin_token';
  function getAdminToken() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('admin_token');
    if (fromQuery) {
      localStorage.setItem(ADMIN_TOKEN_KEY, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  }

  // API
  const API = {
    matches: () => fetch('/api/matches').then(r => r.json()),
    matchState: (id) => fetch(`/api/matches/${id}/state`).then(r => r.json()),
    tap: (id, emotion, roomKey, period, sliceIndex) => fetch(`/api/matches/${id}/tap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emotion, roomKey, period, sliceIndex })
    }).then(r => r.json()),
    heatmap: (id, roomKey) => fetch(`/api/matches/${id}/heatmap/slices?roomKey=${roomKey}`).then(r => r.json()),
    replay: (id, roomKey) => fetch(`/api/matches/${id}/replay/slices?roomKey=${roomKey}`).then(r => r.json()),
    // Dev
    createMock: (matchId, home, away) => fetch('/api/dev/mock-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, home, away })
    }).then(r => r.json()),
    advanceTime: (matchId, seconds) => fetch('/api/dev/advance-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, seconds })
    }).then(r => r.json()),
    refreshState: (matchId) => fetch('/api/dev/refresh-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    }).then(r => r.json()),
    endMatch: (matchId) => fetch('/api/dev/end-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    }).then(r => r.json()),
    setPeriod: (matchId, period, elapsedSeconds) => fetch('/api/dev/set-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, period, elapsedSeconds })
    }).then(r => r.json()),
    recordPenalty: (matchId) => fetch('/api/dev/record-penalty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    }).then(r => r.json()),
    deleteMatch: async (matchId) => {
      const adminToken = getAdminToken();
      const endpoint = `/api/admin/archive/${matchId}`;
      const resp = await fetch(endpoint, {
        method: 'DELETE',
        headers: adminToken ? { 'x-admin-token': adminToken } : undefined
      });
      return resp.json();
    }
  };

  // Dev mode persistence
  const DEV_MODE_KEY = 'soccerpulse_dev_mode';
  function isDevModeEnabled() {
    return localStorage.getItem(DEV_MODE_KEY) === 'true';
  }
  function setDevMode(enabled) {
    localStorage.setItem(DEV_MODE_KEY, enabled ? 'true' : 'false');
    document.body.classList.toggle('dev-mode', enabled);
    if (devModeToggle) devModeToggle.checked = enabled;
  }
  function initDevMode() {
    const enabled = isDevModeEnabled();
    setDevMode(enabled);
  }

  // Utilities
  function showNotice(text, duration = 2000) {
    let el = $('#notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'notice';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
  }

  function formatClock(elapsedSeconds) {
    const mins = Math.floor(elapsedSeconds / 60);
    return `${mins}'`;
  }

  function emotionEmoji(key) {
    const e = EMO_MAP.get(key);
    return e ? e.emoji : '';
  }

  function intensityLevel(value, max) {
    if (!max || max <= 0) return value > 0 ? 1 : 0;
    const r = value / max;
    if (r >= 0.95) return 5;
    if (r >= 0.75) return 4;
    if (r >= 0.55) return 3;
    if (r >= 0.35) return 2;
    if (r > 0) return 1;
    return 0;
  }

  // Haptics
  function hapticTap() {
    try {
      if (window.Capacitor?.Plugins?.Haptics) {
        window.Capacitor.Plugins.Haptics.impact({ style: 'light' });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (_) {}
  }

  // Views
  function showView(view) {
    homeView.classList.add('hidden');
    matchView.classList.add('hidden');
    replayView.classList.add('hidden');
    view.classList.remove('hidden');
  }

  // Emoji pad rendering
  function renderEmojiPad() {
    emojiPad.innerHTML = '';
    EMOTIONS.forEach(e => {
      const btn = document.createElement('button');
      btn.className = 'emo';
      btn.dataset.emotion = e.key;
      btn.innerHTML = `${e.emoji}<span>${e.label}</span>`;
      emojiPad.appendChild(btn);
    });
  }

  // Match list rendering
  function renderMatchList(matches) {
    liveMatches.innerHTML = '';
    upcomingMatches.innerHTML = '';
    finishedMatches.innerHTML = '';

    if (!matches || matches.length === 0) {
      noMatchesMsg.classList.remove('hidden');
      return;
    }
    noMatchesMsg.classList.add('hidden');

    matches.forEach(m => {
      const card = document.createElement('div');
      card.className = 'match-card';
      card.dataset.matchId = m.matchId;

      const teams = document.createElement('div');
      teams.className = 'teams';
      teams.textContent = `${m.home} vs ${m.away}`;

      const meta = document.createElement('div');
      meta.className = 'meta';

      const statusChip = document.createElement('div');
      statusChip.className = 'status-chip';

      if (m.status === 'LIVE') {
        statusChip.textContent = formatClock(m.elapsedSeconds);
        statusChip.classList.add('live');
        liveMatches.appendChild(card);
      } else if (m.status === 'HALFTIME') {
        statusChip.textContent = 'HT';
        statusChip.classList.add('ht');
        liveMatches.appendChild(card);
      } else if (m.status === 'ENDED') {
        // Only show finished matches that have at least one tap
        if (!m.totalTaps || m.totalTaps === 0) {
          return; // Skip this match - no taps recorded
        }
        statusChip.textContent = 'FT';
        statusChip.classList.add('ended');

        // Add delete button for finished matches (visible in dev mode)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '✕';
        deleteBtn.title = 'Delete match';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${m.home} vs ${m.away}"?`)) return;
          const resp = await API.deleteMatch(m.matchId);
          if (resp.ok) {
            showNotice('Match deleted');
            loadMatches();
          } else {
            showNotice(resp.error || 'Failed to delete');
          }
        });
        meta.appendChild(deleteBtn);

        finishedMatches.appendChild(card);
      } else {
        statusChip.textContent = 'Upcoming';
        statusChip.classList.add('upcoming');
        upcomingMatches.appendChild(card);
      }

      meta.appendChild(statusChip);
      card.appendChild(teams);
      card.appendChild(meta);

      card.addEventListener('click', () => openMatch(m.matchId));
    });
  }

  // ============================================
  // DYNAMIC TIMELINE RENDERING (1-minute slices)
  // ============================================

  // Minute (1-based) to sliceIndex (0-based): sliceIndex = minute - 1
  // SliceIndex (0-based) to minute (1-based): minute = sliceIndex + 1

  // Calculate optimal layout - dynamically size cells to fill available width
  function calculateLayout(containerWidth, minutesPerHalf = 45) {
    const padding = 16;
    const gap = 2;
    const availableWidth = containerWidth - padding;

    // Cell size range: 24-48px for good visibility and touch targets
    const minCellSize = 24;
    const maxCellSize = 48;

    // Try 1, 2, 3, 4, 5, 6 rows per half
    for (let rowsPerHalf = 1; rowsPerHalf <= 6; rowsPerHalf++) {
      const cellsPerRow = Math.ceil(minutesPerHalf / rowsPerHalf);
      const cellSize = Math.floor((availableWidth - (cellsPerRow - 1) * gap) / cellsPerRow);

      if (cellSize >= minCellSize && cellSize <= maxCellSize) {
        return {
          cellSize: Math.min(cellSize, maxCellSize),
          cellsPerRow,
          rowsPerHalf
        };
      } else if (cellSize > maxCellSize) {
        // Cells too big, use max size
        return { cellSize: maxCellSize, cellsPerRow, rowsPerHalf };
      }
    }

    // Fallback: use minimum cell size with calculated rows
    const cellsPerRow = Math.floor((availableWidth - gap) / (minCellSize + gap));
    const rowsPerHalf = Math.ceil(minutesPerHalf / cellsPerRow);
    return { cellSize: minCellSize, cellsPerRow, rowsPerHalf };
  }

  // Key slice indices that should always show labels (within each period)
  const KEY_SLICES_1H = new Set([0, 14, 29, 44]); // 1', 15', 30', 45'
  const KEY_SLICES_2H = new Set([0, 14, 29, 44]); // 46', 60', 75', 90'
  const KEY_SLICES_ET1 = new Set([0, 14]); // 91', 105'
  const KEY_SLICES_ET2 = new Set([0, 14]); // 106', 120'

  // Current heatmap data (period-based)
  let currentHeatmapData = null;

  // Build the dynamic timeline with period-based data
  function buildLiveTimeline(heatmapData, isUserPicks = false) {
    if (!liveTimeline || !timelineContainer) return;
    if (!heatmapData || !heatmapData.periods) return;

    currentHeatmapData = heatmapData;
    const { periods, currentPeriod, hasExtraTime, hasPenalties } = heatmapData;
    const userPicks = getUserPicks(currentMatchId);

    const containerWidth = timelineContainer.clientWidth;
    const { cellSize, cellsPerRow, rowsPerHalf } = calculateLayout(containerWidth);

    // Set CSS variable for cell size
    liveTimeline.style.setProperty('--cell-size', `${cellSize}px`);

    // Helper to get emoji for a slice
    const getSliceEmoji = (period, sliceIndex) => {
      if (isUserPicks) {
        const pick = getUserPickForSlice(currentMatchId, period, sliceIndex);
        return pick ? emotionEmoji(pick) : '';
      } else {
        const periodData = periods[period];
        if (!periodData || !periodData.slices) return '';
        const slice = periodData.slices.find(s => s.sliceIndex === sliceIndex);
        return slice?.dominant?.key ? emotionEmoji(slice.dominant.key) : '';
      }
    };

    // Helper to check if a slice is current
    const isCurrentSlice = (period, sliceIndex) => {
      return period === currentPeriod && currentMatchState &&
             sliceIndex === currentMatchState.sliceIndex;
    };

    // Helper to check if a slice is future
    const isFutureSlice = (period, sliceIndex) => {
      const periodOrder = [PERIOD.FIRST_HALF, PERIOD.SECOND_HALF, PERIOD.EXTRA_TIME_1, PERIOD.EXTRA_TIME_2, PERIOD.PENALTIES];
      const currentIdx = periodOrder.indexOf(currentPeriod);
      const slicePeriodIdx = periodOrder.indexOf(period);

      if (slicePeriodIdx > currentIdx) return true;
      if (slicePeriodIdx < currentIdx) return false;
      return currentMatchState && sliceIndex > currentMatchState.sliceIndex;
    };

    // Build period section
    const buildPeriodSection = (period, baseMinute, regularSlices, keySlices, label) => {
      const periodData = periods[period];
      if (!periodData) return '';

      const totalSlices = periodData.maxSliceIndex + 1;
      const stoppageSlices = Math.max(0, totalSlices - regularSlices);

      let html = `<div class="timeline-period" data-period="${period}">`;
      html += `<div class="period-label">${label}</div>`;

      // Regular time cells
      html += '<div class="timeline-half">';
      for (let row = 0; row < rowsPerHalf; row++) {
        html += '<div class="timeline-row">';
        const startSlice = row * cellsPerRow;
        const endSlice = Math.min((row + 1) * cellsPerRow - 1, regularSlices - 1);

        for (let sliceIdx = startSlice; sliceIdx <= endSlice; sliceIdx++) {
          const minute = baseMinute + sliceIdx;
          const emoji = getSliceEmoji(period, sliceIdx);
          const isCurrent = isCurrentSlice(period, sliceIdx);
          const isFuture = isFutureSlice(period, sliceIdx);
          const hasData = emoji !== '';
          const isKey = keySlices.has(sliceIdx);

          let classes = 'minute-cell';
          if (isCurrent) classes += ' current';
          else if (isFuture) classes += ' future';
          if (hasData) classes += ' has-data';
          if (isKey) classes += ' key';

          const displayLabel = `${minute}'`;
          const content = hasData
            ? `<span class="cell-emoji">${emoji}</span><span class="cell-min">${displayLabel}</span>`
            : `<span class="cell-min">${displayLabel}</span>`;

          html += `<div class="${classes}" data-period="${period}" data-slice="${sliceIdx}">${content}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';

      // Stoppage time cells (inline expansion)
      if (stoppageSlices > 0) {
        html += '<div class="stoppage-section">';
        html += '<span class="stoppage-label">+</span>';
        for (let i = 0; i < stoppageSlices; i++) {
          const sliceIdx = regularSlices + i;
          const stoppageMin = i + 1;
          const emoji = getSliceEmoji(period, sliceIdx);
          const isCurrent = isCurrentSlice(period, sliceIdx);
          const isFuture = isFutureSlice(period, sliceIdx);
          const hasData = emoji !== '';

          let classes = 'minute-cell stoppage';
          if (isCurrent) classes += ' current';
          else if (isFuture) classes += ' future';
          if (hasData) classes += ' has-data';

          const displayLabel = `+${stoppageMin}`;
          const content = hasData
            ? `<span class="cell-emoji">${emoji}</span><span class="cell-min">${displayLabel}</span>`
            : `<span class="cell-min">${displayLabel}</span>`;

          html += `<div class="${classes}" data-period="${period}" data-slice="${sliceIdx}">${content}</div>`;
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    };

    // Build penalty section
    const buildPenaltySection = () => {
      const periodData = periods[PERIOD.PENALTIES];
      if (!periodData || periodData.slices.length === 0) return '';

      let html = '<div class="timeline-period penalties" data-period="PEN">';
      html += '<div class="period-label">Penalties</div>';
      html += '<div class="penalty-grid">';

      for (const slice of periodData.slices) {
        const kickNum = Math.floor(slice.sliceIndex / 2) + 1;
        const team = slice.sliceIndex % 2 === 0 ? 'T1' : 'T2';
        const emoji = getSliceEmoji(PERIOD.PENALTIES, slice.sliceIndex);
        const isCurrent = isCurrentSlice(PERIOD.PENALTIES, slice.sliceIndex);
        const hasData = emoji !== '';

        let classes = 'penalty-cell';
        if (isCurrent) classes += ' current';
        if (hasData) classes += ' has-data';
        classes += team === 'T1' ? ' team1' : ' team2';

        const displayLabel = `${team}-${kickNum}`;
        const content = hasData
          ? `<span class="cell-emoji">${emoji}</span><span class="cell-label">${displayLabel}</span>`
          : `<span class="cell-label">${displayLabel}</span>`;

        html += `<div class="${classes}" data-period="PEN" data-slice="${slice.sliceIndex}">${content}</div>`;
      }

      html += '</div></div>';
      return html;
    };

    // Build complete timeline
    let html = '';

    // First half
    if (periods[PERIOD.FIRST_HALF]) {
      html += buildPeriodSection(PERIOD.FIRST_HALF, 1, 45, KEY_SLICES_1H, '1st Half');
    }

    // HT Spacer
    html += '<div class="ht-spacer">HT</div>';

    // Second half
    if (periods[PERIOD.SECOND_HALF]) {
      html += buildPeriodSection(PERIOD.SECOND_HALF, 46, 45, KEY_SLICES_2H, '2nd Half');
    }

    // Extra time (only if match has gone to ET)
    if (hasExtraTime || periods[PERIOD.EXTRA_TIME_1] || periods[PERIOD.EXTRA_TIME_2]) {
      html += '<div class="et-spacer">Extra Time</div>';

      if (periods[PERIOD.EXTRA_TIME_1]) {
        html += buildPeriodSection(PERIOD.EXTRA_TIME_1, 91, 15, KEY_SLICES_ET1, 'ET 1st Half');
      }

      html += '<div class="et-ht-spacer">ET HT</div>';

      if (periods[PERIOD.EXTRA_TIME_2]) {
        html += buildPeriodSection(PERIOD.EXTRA_TIME_2, 106, 15, KEY_SLICES_ET2, 'ET 2nd Half');
      }
    }

    // Penalties (only if match has gone to shootout)
    if (hasPenalties || periods[PERIOD.PENALTIES]) {
      html += '<div class="pen-spacer">Shootout</div>';
      html += buildPenaltySection();
    }

    liveTimeline.innerHTML = html;
  }

  // Debounced resize handler
  let resizeTimeout = null;
  function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Re-render live timeline if in match view
      if (!matchView.classList.contains('hidden') && currentMatchState && currentMatchId) {
        renderLiveTimeline();
      }
      // Re-render replay pulsemap if in replay view and on pulsemap tab
      if (!replayView.classList.contains('hidden') && replaySlicesData && replaySlicesData.periods) {
        renderReplayPulsemapGrid(replaySlicesData);
      }
    }, 150);
  }

  // Global resize listener
  window.addEventListener('resize', handleResize);

  // ============================================
  // LIVE MATCH
  // ============================================

  let currentSlicesData = null; // Now stores the full heatmap response with periods

  async function openMatch(matchId) {
    currentMatchId = matchId;
    currentRoomKey = 'GLOBAL';

    const resp = await API.matchState(matchId);
    if (!resp.ok) {
      showNotice('Could not load match');
      return;
    }

    currentMatchState = resp;

    // If match ended, go to replay view
    if (resp.archived || resp.status === 'ENDED') {
      openReplay(matchId);
      return;
    }

    showView(matchView);
    updateMatchHeader(resp);

    // Room selector visibility
    if (resp.worldCupRoomsEnabled) {
      roomSelector.classList.remove('hidden');
      roomHomeBtn.textContent = resp.homeTeam.name;
      roomAwayBtn.textContent = resp.awayTeam.name;
    } else {
      roomSelector.classList.add('hidden');
    }

    // Default to Pulse tab
    currentViewMode = 'pulsemap';
    showTimelineTab('pulsemap');

    // Load heatmap data and render timeline
    await loadAndRenderTimelines();

    // Subscribe to SSE
    subscribeToMatchSSE(matchId);
  }

  function updateMatchHeader(state) {
    homeName.textContent = state.homeTeam.name;
    awayName.textContent = state.awayTeam.name;
    const mins = Math.floor(state.elapsedSeconds / 60) + 1;
    clockLabel.textContent = `${mins}'`;

    matchStatus.textContent = state.status === 'LIVE' ? 'LIVE' :
                              state.status === 'HALFTIME' ? 'HT' :
                              state.status === 'ENDED' ? 'FT' : state.status;
    matchStatus.className = 'live-status';
    if (state.status === 'HALFTIME') matchStatus.classList.add('ht');
    else if (state.status === 'ENDED') matchStatus.classList.add('ended');
  }

  async function loadAndRenderTimelines() {
    const resp = await API.heatmap(currentMatchId, currentRoomKey);
    if (resp.ok) {
      currentSlicesData = resp; // Store full response with periods
      // Debug: log periods with data
      if (resp.periods) {
        for (const [period, data] of Object.entries(resp.periods)) {
          const withData = (data.slices || []).filter(s => s.total > 0);
          if (withData.length > 0) {
            console.log(`[Pulse] ${period}:`, withData.map(s => `${s.label}: ${s.dominant?.key} (${s.total})`).join(', '));
          }
        }
      }
    }
    renderLiveTimeline();
  }

  function renderLiveTimeline() {
    if (!currentSlicesData) return;

    const isUserPicks = currentViewMode === 'my-picks';
    buildLiveTimeline(currentSlicesData, isUserPicks);
    updateEmojiPadState();
  }

  // Check if user already tapped for current slice and update emoji pad
  function updateEmojiPadState() {
    if (!currentMatchState || !emojiPad) return;

    const period = currentMatchState.period || PERIOD.FIRST_HALF;
    const sliceIndex = currentMatchState.sliceIndex || 0;
    const existingPick = getUserPickForSlice(currentMatchId, period, sliceIndex);

    if (existingPick) {
      emojiPad.classList.add('disabled');
    } else {
      emojiPad.classList.remove('disabled');
    }
  }

  async function showTimelineTab(tab) {
    currentViewMode = tab;
    tabMyPicks.classList.toggle('active', tab === 'my-picks');
    tabPulsemap.classList.toggle('active', tab === 'pulsemap');
    // Reload data to ensure consistency
    await loadAndRenderTimelines();
  }

  function subscribeToMatchSSE(matchId) {
    if (matchSSE) {
      try { matchSSE.close(); } catch (_) {}
    }
    matchSSE = new EventSource(`/api/matches/${matchId}/stream`);

    matchSSE.addEventListener('open', () => {
      console.log('[SSE] Connected to match stream');
    });

    matchSSE.addEventListener('error', (e) => {
      console.warn('[SSE] Connection error, will retry...', e);
    });

    matchSSE.addEventListener('slice_advance', async (e) => {
      const data = JSON.parse(e.data);
      console.log('[SSE] slice_advance:', data);
      currentMatchState.elapsedSeconds = data.elapsedSeconds;
      currentMatchState.sliceIndex = data.sliceIndex;
      currentMatchState.period = data.period;
      currentMatchState.sliceLabel = data.label;
      currentMatchState.status = data.status;
      updateMatchHeader(currentMatchState);
      await loadAndRenderTimelines();
    });

    matchSSE.addEventListener('status_change', (e) => {
      const data = JSON.parse(e.data);
      currentMatchState.status = data.status;
      currentMatchState.period = data.period;
      currentMatchState.periodLabel = data.periodLabel;
      updateMatchHeader(currentMatchState);
      if (data.status === 'ENDED') {
        showNotice('Match ended!');
        setTimeout(() => openReplay(matchId), 2000);
      }
    });

    matchSSE.addEventListener('penalty_kick', async (e) => {
      const data = JSON.parse(e.data);
      console.log('[SSE] penalty_kick:', data);
      currentMatchState.sliceIndex = data.sliceIndex;
      await loadAndRenderTimelines();
    });

    matchSSE.addEventListener('tap_update', async (e) => {
      const data = JSON.parse(e.data);
      if (data.roomKey === currentRoomKey) {
        // Refresh PulseMap
        await loadAndRenderTimelines();
      }
    });
  }

  // ============================================
  // REPLAY (ARCHIVED MATCH)
  // ============================================

  let replaySlicesData = null; // Now stores full response with periods

  async function openReplay(matchId) {
    currentMatchId = matchId;
    replayRoomKey = 'GLOBAL';

    const state = await API.matchState(matchId);
    if (!state.ok) {
      showNotice('Could not load match');
      return;
    }

    showView(replayView);
    replayHomeName.textContent = state.homeTeam.name;
    replayAwayName.textContent = state.awayTeam.name;

    // Room selector
    if (state.worldCupRoomsEnabled) {
      replayRoomSelector.classList.remove('hidden');
      replayRoomHomeBtn.textContent = `${state.homeTeam.name} Fans`;
      replayRoomAwayBtn.textContent = `${state.awayTeam.name} Fans`;
    } else {
      replayRoomSelector.classList.add('hidden');
    }

    // Default to Replay tab
    showReplayTab('scrub');

    await loadReplayData(matchId, replayRoomKey);
  }

  function showReplayTab(tab) {
    tabReplayScrub.classList.toggle('active', tab === 'scrub');
    tabReplayPulsemap.classList.toggle('active', tab === 'pulsemap');
    panelReplayScrub.classList.toggle('hidden', tab !== 'scrub');
    panelReplayPulsemap.classList.toggle('hidden', tab !== 'pulsemap');
  }

  async function loadReplayData(matchId, roomKey) {
    const resp = await API.replay(matchId, roomKey);
    if (!resp.ok) {
      if (replayStats) replayStats.innerHTML = `<p class="empty-msg">${resp.error || 'Could not load replay'}</p>`;
      return;
    }

    replaySlicesData = resp; // Store full response with periods

    // Render PulseMap timeline
    renderReplayPulsemapGrid(resp);

    // Render stats
    renderReplayStats(resp);

    // Render scrubber
    renderReplayScrubber(resp);
  }

  function renderReplayPulsemapGrid(data) {
    if (!replayPulsemapTimeline || !data || !data.periods) return;

    const { periods, hasExtraTime, hasPenalties } = data;

    // Calculate layout based on container width
    const panel = replayPulsemapTimeline.closest('.timeline-panel');
    const containerWidth = panel?.clientWidth || replayPulsemapTimeline.parentElement?.clientWidth || window.innerWidth - 32;
    const { cellSize, cellsPerRow, rowsPerHalf } = calculateLayout(containerWidth);

    // Set CSS variable for cell size
    replayPulsemapTimeline.style.setProperty('--cell-size', `${cellSize}px`);

    // Helper to get emoji for a slice
    const getSliceEmoji = (period, sliceIndex) => {
      const periodData = periods[period];
      if (!periodData || !periodData.slices) return '';
      const slice = periodData.slices.find(s => s.sliceIndex === sliceIndex);
      return slice?.dominant?.key ? emotionEmoji(slice.dominant.key) : '';
    };

    // Build period section for replay
    const buildReplayPeriodSection = (period, baseMinute, regularSlices, label) => {
      const periodData = periods[period];
      if (!periodData) return '';

      const totalSlices = periodData.maxSliceIndex + 1;
      const stoppageSlices = Math.max(0, totalSlices - regularSlices);

      let html = `<div class="timeline-period" data-period="${period}">`;

      // Regular time cells
      html += '<div class="timeline-half">';
      for (let row = 0; row < rowsPerHalf; row++) {
        html += '<div class="timeline-row">';
        const startSlice = row * cellsPerRow;
        const endSlice = Math.min((row + 1) * cellsPerRow - 1, regularSlices - 1);

        for (let sliceIdx = startSlice; sliceIdx <= endSlice; sliceIdx++) {
          const minute = baseMinute + sliceIdx;
          const emoji = getSliceEmoji(period, sliceIdx);
          const hasData = emoji !== '';

          let classes = 'minute-cell';
          if (hasData) classes += ' has-data';

          const displayLabel = `${minute}'`;
          const content = hasData
            ? `<span class="cell-emoji">${emoji}</span><span class="cell-min">${displayLabel}</span>`
            : `<span class="cell-min">${displayLabel}</span>`;

          html += `<div class="${classes}" data-period="${period}" data-slice="${sliceIdx}">${content}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';

      // Stoppage time cells
      if (stoppageSlices > 0) {
        html += '<div class="stoppage-section">';
        html += '<span class="stoppage-label">+</span>';
        for (let i = 0; i < stoppageSlices; i++) {
          const sliceIdx = regularSlices + i;
          const stoppageMin = i + 1;
          const emoji = getSliceEmoji(period, sliceIdx);
          const hasData = emoji !== '';

          let classes = 'minute-cell stoppage';
          if (hasData) classes += ' has-data';

          const displayLabel = `+${stoppageMin}`;
          const content = hasData
            ? `<span class="cell-emoji">${emoji}</span><span class="cell-min">${displayLabel}</span>`
            : `<span class="cell-min">${displayLabel}</span>`;

          html += `<div class="${classes}" data-period="${period}" data-slice="${sliceIdx}">${content}</div>`;
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    };

    // Build penalty section for replay
    const buildReplayPenaltySection = () => {
      const periodData = periods[PERIOD.PENALTIES];
      if (!periodData || periodData.slices.length === 0) return '';

      let html = '<div class="timeline-period penalties" data-period="PEN">';
      html += '<div class="penalty-grid">';

      for (const slice of periodData.slices) {
        const kickNum = Math.floor(slice.sliceIndex / 2) + 1;
        const team = slice.sliceIndex % 2 === 0 ? 'T1' : 'T2';
        const emoji = getSliceEmoji(PERIOD.PENALTIES, slice.sliceIndex);
        const hasData = emoji !== '';

        let classes = 'penalty-cell';
        if (hasData) classes += ' has-data';
        classes += team === 'T1' ? ' team1' : ' team2';

        const displayLabel = `${team}-${kickNum}`;
        const content = hasData
          ? `<span class="cell-emoji">${emoji}</span><span class="cell-label">${displayLabel}</span>`
          : `<span class="cell-label">${displayLabel}</span>`;

        html += `<div class="${classes}" data-period="PEN" data-slice="${slice.sliceIndex}">${content}</div>`;
      }

      html += '</div></div>';
      return html;
    };

    // Build complete replay timeline
    let html = '';

    // First half
    if (periods[PERIOD.FIRST_HALF]) {
      html += buildReplayPeriodSection(PERIOD.FIRST_HALF, 1, 45, '1st Half');
    }

    // HT marker
    html += '<div class="ht-marker">HT</div>';

    // Second half
    if (periods[PERIOD.SECOND_HALF]) {
      html += buildReplayPeriodSection(PERIOD.SECOND_HALF, 46, 45, '2nd Half');
    }

    // Extra time
    if (hasExtraTime || periods[PERIOD.EXTRA_TIME_1] || periods[PERIOD.EXTRA_TIME_2]) {
      html += '<div class="et-marker">Extra Time</div>';

      if (periods[PERIOD.EXTRA_TIME_1]) {
        html += buildReplayPeriodSection(PERIOD.EXTRA_TIME_1, 91, 15, 'ET 1st');
      }

      html += '<div class="et-ht-marker">ET HT</div>';

      if (periods[PERIOD.EXTRA_TIME_2]) {
        html += buildReplayPeriodSection(PERIOD.EXTRA_TIME_2, 106, 15, 'ET 2nd');
      }
    }

    // Penalties
    if (hasPenalties || periods[PERIOD.PENALTIES]) {
      html += '<div class="pen-marker">Shootout</div>';
      html += buildReplayPenaltySection();
    }

    replayPulsemapTimeline.innerHTML = html;
  }

  function renderReplayStats(data) {
    if (!data || !data.periods) {
      replayStats.innerHTML = '<p class="empty-msg">No data</p>';
      return;
    }

    const { periods, meta } = data;

    // Calculate totals across all periods
    let totalTaps = 0;
    const emotionCounts = {};
    let peakSliceInfo = null;

    for (const [period, periodData] of Object.entries(periods)) {
      if (!periodData.slices) continue;
      for (const s of periodData.slices) {
        totalTaps += s.total;
        if (s.dominant && s.dominant.key) {
          emotionCounts[s.dominant.key] = (emotionCounts[s.dominant.key] || 0) + 1;
        }
      }
    }

    // Get peak slice from meta
    if (meta?.peakSlice) {
      peakSliceInfo = meta.peakSlice;
    }

    const topEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0];

    replayStats.innerHTML = `
      <div class="stat-row">
        <span>Total Taps</span>
        <span class="stat-value">${totalTaps}</span>
      </div>
      <div class="stat-row">
        <span>Peak Moment</span>
        <span class="stat-value">${peakSliceInfo?.label ? peakSliceInfo.label + ' (' + peakSliceInfo.total + ' taps)' : '—'}</span>
      </div>
      <div class="stat-row">
        <span>Dominant Emotion</span>
        <span class="stat-value">${topEmotion ? emotionEmoji(topEmotion[0]) : '—'}</span>
      </div>
    `;
  }

  function renderReplayScrubber(data) {
    if (!data || !data.periods) {
      replayScrubber.innerHTML = '';
      return;
    }

    replayScrubber.innerHTML = '';
    const { periods, hasExtraTime, hasPenalties } = data;

    // Calculate max total across all periods for intensity
    let maxTotal = 1;
    for (const periodData of Object.values(periods)) {
      if (periodData.slices) {
        for (const s of periodData.slices) {
          if (s.total > maxTotal) maxTotal = s.total;
        }
      }
    }

    // Build flat list of all slices for scrubber with markers
    const allSlices = [];

    // First half
    if (periods[PERIOD.FIRST_HALF]) {
      for (const s of periods[PERIOD.FIRST_HALF].slices) {
        allSlices.push({ ...s, period: PERIOD.FIRST_HALF });
      }
    }

    // HT marker
    allSlices.push({ isMarker: true, markerType: 'HT', label: 'HT' });

    // Second half
    if (periods[PERIOD.SECOND_HALF]) {
      for (const s of periods[PERIOD.SECOND_HALF].slices) {
        allSlices.push({ ...s, period: PERIOD.SECOND_HALF });
      }
    }

    // Extra time
    if ((hasExtraTime || periods[PERIOD.EXTRA_TIME_1]) && periods[PERIOD.EXTRA_TIME_1]) {
      // ET marker before extra time
      allSlices.push({ isMarker: true, markerType: 'ET', label: 'ET' });

      for (const s of periods[PERIOD.EXTRA_TIME_1].slices) {
        allSlices.push({ ...s, period: PERIOD.EXTRA_TIME_1 });
      }

      if (periods[PERIOD.EXTRA_TIME_2]) {
        for (const s of periods[PERIOD.EXTRA_TIME_2].slices) {
          allSlices.push({ ...s, period: PERIOD.EXTRA_TIME_2 });
        }
      }
    }

    // FT marker (before penalties or at end)
    if (hasPenalties || periods[PERIOD.PENALTIES]) {
      allSlices.push({ isMarker: true, markerType: 'FT', label: 'FT' });

      // Penalties
      if (periods[PERIOD.PENALTIES]) {
        allSlices.push({ isMarker: true, markerType: 'PEN', label: 'PEN' });
        for (const s of periods[PERIOD.PENALTIES].slices) {
          allSlices.push({ ...s, period: PERIOD.PENALTIES });
        }
      }
    }

    // Store only actual slices (not markers) for updateScrubberCenter
    const actualSlices = allSlices.filter(s => !s.isMarker);
    replayScrubber._allSlices = actualSlices;

    // Render scrubber ticks and markers
    let tickIdx = 0;
    allSlices.forEach((s) => {
      if (s.isMarker) {
        // Render marker
        const marker = document.createElement('div');
        marker.className = `scrubber-marker marker-${s.markerType.toLowerCase()}`;
        marker.innerHTML = `<span>${s.label}</span>`;
        replayScrubber.appendChild(marker);
        return;
      }

      const tick = document.createElement('div');
      tick.className = 'minute-tick';
      tick.dataset.idx = tickIdx;
      tick.dataset.period = s.period;
      tick.dataset.slice = s.sliceIndex;
      tickIdx++;

      const intensity = intensityLevel(s.total, maxTotal);
      tick.setAttribute('data-intensity', intensity);

      const bar = document.createElement('div');
      bar.className = 'bar';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = s.label;

      tick.appendChild(bar);
      tick.appendChild(label);

      tick.addEventListener('click', () => scrollScrubberToIdx(idx));

      replayScrubber.appendChild(tick);
    });

    // Setup scroll listener
    replayScrubber.removeEventListener('scroll', onScrubberScroll);
    replayScrubber.addEventListener('scroll', onScrubberScroll, { passive: true });

    // Initial position
    requestAnimationFrame(() => {
      scrollScrubberToIdx(0, false);
      updateScrubberCenter();
    });
  }

  function scrollScrubberToIdx(idx, smooth = true) {
    const tick = replayScrubber.querySelector(`.minute-tick[data-idx="${idx}"]`);
    if (!tick) return;
    const containerWidth = replayScrubber.clientWidth;
    const scrollTarget = tick.offsetLeft - (containerWidth / 2) + (tick.offsetWidth / 2);
    replayScrubber.scrollTo({ left: scrollTarget, behavior: smooth ? 'smooth' : 'auto' });
  }

  let lastScrubberEmoji = null;
  function onScrubberScroll() {
    requestAnimationFrame(updateScrubberCenter);
  }

  function updateScrubberCenter() {
    const rect = replayScrubber.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const ticks = replayScrubber.querySelectorAll('.minute-tick');

    let closestTick = null;
    let closestDist = Infinity;
    ticks.forEach(tick => {
      tick.classList.remove('in-zone');
      const tickRect = tick.getBoundingClientRect();
      const dist = Math.abs(tickRect.left + tickRect.width / 2 - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closestTick = tick;
      }
    });

    if (!closestTick) return;

    // Highlight current tick
    closestTick.classList.add('in-zone');

    // Get slice data from stored allSlices
    const idx = parseInt(closestTick.dataset.idx, 10);
    const allSlices = replayScrubber._allSlices || [];
    const slice = allSlices[idx];

    if (!slice) return;

    // Update time range
    if (replayTimeRange) {
      replayTimeRange.innerHTML = `<span class="range">${slice.label}</span>`;
    }

    // Update emoji popup
    const emojiKey = slice.dominant?.key || null;
    if (emojiKey !== lastScrubberEmoji) {
      lastScrubberEmoji = emojiKey;
      if (replayEmojiPopup) {
        replayEmojiPopup.textContent = emojiKey ? emotionEmoji(emojiKey) : '–';
        replayEmojiPopup.classList.remove('bounce');
        void replayEmojiPopup.offsetWidth;
        replayEmojiPopup.classList.add('bounce');
      }
    }

    // Update info
    if (replayInfo) {
      replayInfo.innerHTML = `
        <div class="dominant-row">
          <span class="replay-emoji">${emojiKey ? emotionEmoji(emojiKey) : '–'}</span>
        </div>
        <div class="taps">${slice.total} taps</div>
      `;
    }
  }

  // ============================================
  // EXPORT FUNCTIONALITY
  // ============================================

  function exportTimeline(title, data, isUserPicks = false) {
    if (!data || !data.periods) {
      showNotice('No data to export');
      return;
    }

    const { periods, hasExtraTime, hasPenalties } = data;
    const scale = 2; // 2x for high quality

    // Layout settings
    const cellSize = 28 * scale; // Slightly larger to fit minute labels
    const gap = 3 * scale;
    const padding = 32 * scale;
    const headerHeight = 80 * scale;
    const markerHeight = 28 * scale;
    const cellsPerRow = 15; // 15 cells per row = 3 rows per half

    // Get actual slice counts including stoppage time
    const slices1H = periods[PERIOD.FIRST_HALF]?.slices?.length || 45;
    const slices2H = periods[PERIOD.SECOND_HALF]?.slices?.length || 45;
    const slicesET1 = periods[PERIOD.EXTRA_TIME_1]?.slices?.length || 15;
    const slicesET2 = periods[PERIOD.EXTRA_TIME_2]?.slices?.length || 15;
    const penaltyCells = hasPenalties && periods[PERIOD.PENALTIES] ? periods[PERIOD.PENALTIES].slices.length : 0;

    // Calculate dimensions using actual slice counts
    const rowWidth = cellsPerRow * (cellSize + gap) - gap;
    const rowsFor1H = Math.ceil(slices1H / cellsPerRow);
    const rowsFor2H = Math.ceil(slices2H / cellsPerRow);
    const rowsForET1 = hasExtraTime ? Math.ceil(slicesET1 / cellsPerRow) : 0;
    const rowsForET2 = hasExtraTime ? Math.ceil(slicesET2 / cellsPerRow) : 0;
    const rowsForPen = penaltyCells > 0 ? Math.ceil(penaltyCells / 10) : 0;

    let totalHeight = headerHeight + padding * 2;
    totalHeight += rowsFor1H * (cellSize + gap);
    totalHeight += markerHeight; // HT
    totalHeight += rowsFor2H * (cellSize + gap);
    if (hasExtraTime) {
      totalHeight += markerHeight; // ET
      totalHeight += rowsForET1 * (cellSize + gap);
      totalHeight += rowsForET2 * (cellSize + gap);
    }
    if (hasPenalties) {
      totalHeight += markerHeight; // PEN
      totalHeight += rowsForPen * (cellSize + gap);
    }
    totalHeight += 20 * scale; // footer padding

    const canvas = document.createElement('canvas');
    canvas.width = rowWidth + padding * 2;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    // Light theme background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title
    ctx.fillStyle = '#1e293b';
    ctx.font = `bold ${18 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(title, canvas.width / 2, padding + 24 * scale);

    ctx.font = `${12 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(isUserPicks ? 'My Picks' : 'PulseMap', canvas.width / 2, padding + 44 * scale);

    let y = padding + headerHeight;
    const startX = padding;

    // Helper: get minute label for a slice
    const getMinuteLabel = (periodKey, sliceIndex) => {
      const config = PERIOD_CONFIG[periodKey];
      if (!config) return `${sliceIndex + 1}`;

      const { regularSlices, baseMinute } = config;
      if (sliceIndex < regularSlices) {
        return `${baseMinute + sliceIndex}`;
      } else {
        // Stoppage time
        const stoppageMin = sliceIndex - regularSlices + 1;
        const lastRegularMin = baseMinute + regularSlices - 1;
        return `${lastRegularMin}+${stoppageMin}`;
      }
    };

    // Helper: draw cells for a period (uses actual slices from data)
    const drawPeriodCells = (periodKey) => {
      const periodData = periods[periodKey];
      if (!periodData) return;

      const slices = periodData.slices || [];
      if (slices.length === 0) return;

      const sliceMap = new Map(slices.map(s => [s.sliceIndex, s]));
      const maxSliceIndex = Math.max(...slices.map(s => s.sliceIndex));

      for (let i = 0; i <= maxSliceIndex; i++) {
        const row = Math.floor(i / cellsPerRow);
        const col = i % cellsPerRow;
        const x = startX + col * (cellSize + gap);
        const cellY = y + row * (cellSize + gap);

        const slice = sliceMap.get(i);
        let emoji = '';
        let hasData = false;

        if (isUserPicks) {
          const pick = getUserPickForSlice(currentMatchId, periodKey, i);
          if (pick) {
            emoji = emotionEmoji(pick);
            hasData = true;
          }
        } else {
          if (slice?.dominant?.key) {
            emoji = emotionEmoji(slice.dominant.key);
            hasData = true;
          }
        }

        // Cell background
        if (hasData) {
          ctx.fillStyle = '#e0f2fe';
          ctx.strokeStyle = '#7dd3fc';
        } else {
          ctx.fillStyle = '#f1f5f9';
          ctx.strokeStyle = '#e2e8f0';
        }

        ctx.beginPath();
        ctx.roundRect(x, cellY, cellSize, cellSize, 4 * scale);
        ctx.fill();
        ctx.lineWidth = scale;
        ctx.stroke();

        // Minute label (subtle, at bottom of cell)
        const minuteLabel = getMinuteLabel(periodKey, i);
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${7 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(minuteLabel, x + cellSize / 2, cellY + cellSize - 2 * scale);

        // Emoji (slightly higher to make room for minute label)
        if (emoji) {
          ctx.font = `${cellSize * 0.5}px Apple Color Emoji, Segoe UI Emoji`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, x + cellSize / 2, cellY + cellSize * 0.4);
        }
      }

      // Update y for next section
      const rows = Math.ceil((maxSliceIndex + 1) / cellsPerRow);
      y += rows * (cellSize + gap);
    };

    // Helper: draw marker
    const drawMarker = (text, color, bgColor) => {
      ctx.fillStyle = bgColor;
      const markerWidth = 50 * scale;
      ctx.beginPath();
      ctx.roundRect(canvas.width / 2 - markerWidth / 2, y + 4 * scale, markerWidth, markerHeight - 8 * scale, 4 * scale);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.font = `bold ${10 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvas.width / 2, y + markerHeight / 2);
      y += markerHeight;
    };

    // Draw 1H
    drawPeriodCells(PERIOD.FIRST_HALF);

    // HT marker
    drawMarker('HT', '#b45309', '#fef3c7');

    // Draw 2H
    drawPeriodCells(PERIOD.SECOND_HALF);

    // Extra time
    if (hasExtraTime) {
      drawMarker('ET', '#b91c1c', '#fee2e2');
      drawPeriodCells(PERIOD.EXTRA_TIME_1);
      drawPeriodCells(PERIOD.EXTRA_TIME_2);
    }

    // Penalties
    if (hasPenalties && periods[PERIOD.PENALTIES]) {
      drawMarker('PEN', '#047857', '#d1fae5');
      const penSlices = periods[PERIOD.PENALTIES].slices || [];
      const penSliceMap = new Map(penSlices.map(s => [s.sliceIndex, s]));

      // Center align penalty boxes (10 per row vs 15 for regular)
      const penCellsPerRow = 10;
      const penRowWidth = penCellsPerRow * (cellSize + gap) - gap;
      const penStartX = padding + (rowWidth - penRowWidth) / 2;

      for (let i = 0; i < penSlices.length; i++) {
        const row = Math.floor(i / 10);
        const col = i % 10;
        const x = penStartX + col * (cellSize + gap);
        const cellY = y + row * (cellSize + gap);

        const slice = penSliceMap.get(i);
        const isTeam1 = i % 2 === 0;
        let emoji = '';
        let hasData = false;

        if (isUserPicks) {
          const pick = getUserPickForSlice(currentMatchId, PERIOD.PENALTIES, i);
          if (pick) {
            emoji = emotionEmoji(pick);
            hasData = true;
          }
        } else {
          if (slice?.dominant?.key) {
            emoji = emotionEmoji(slice.dominant.key);
            hasData = true;
          }
        }

        // Penalty cell background
        ctx.fillStyle = isTeam1 ? '#ecfdf5' : '#fef2f2';
        ctx.strokeStyle = isTeam1 ? '#059669' : '#dc2626';
        ctx.lineWidth = 2 * scale;
        ctx.setLineDash(isTeam1 ? [] : [4 * scale, 2 * scale]);

        ctx.beginPath();
        ctx.roundRect(x, cellY, cellSize, cellSize, 4 * scale);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Kick label (T1-1, T2-1, T1-2, etc.)
        const kickNum = Math.floor(i / 2) + 1;
        const kickLabel = isTeam1 ? `T1-${kickNum}` : `T2-${kickNum}`;
        ctx.fillStyle = isTeam1 ? '#059669' : '#dc2626';
        ctx.font = `${6 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(kickLabel, x + cellSize / 2, cellY + cellSize - 2 * scale);

        // Emoji (slightly higher to make room for label)
        if (emoji) {
          ctx.font = `${cellSize * 0.5}px Apple Color Emoji, Segoe UI Emoji`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, x + cellSize / 2, cellY + cellSize * 0.4);
        }
      }
    }

    // Watermark
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${10 * scale}px -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('SoccerPulse', canvas.width / 2, canvas.height - 12 * scale);

    // Download
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `soccerpulse-${isUserPicks ? 'my-picks' : 'pulsemap'}-${currentMatchId}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showNotice('Image exported!');
  }

  function exportLiveTimeline(title, isUserPicks = false) {
    exportTimeline(title, currentSlicesData, isUserPicks);
  }

  function exportReplayTimeline(title) {
    exportTimeline(title, replaySlicesData, false);
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function setupListeners() {
    // Back buttons
    backBtn.addEventListener('click', () => {
      if (matchSSE) { try { matchSSE.close(); } catch (_) {} matchSSE = null; }
      showView(homeView);
      loadMatches();
    });

    replayBackBtn.addEventListener('click', () => {
      showView(homeView);
      loadMatches();
    });

    // Timeline tabs (live match)
    tabMyPicks.addEventListener('click', () => showTimelineTab('my-picks'));
    tabPulsemap.addEventListener('click', () => showTimelineTab('pulsemap'));

    // Replay tabs (archived match)
    tabReplayScrub.addEventListener('click', () => showReplayTab('scrub'));
    tabReplayPulsemap.addEventListener('click', () => showReplayTab('pulsemap'));

    // Room selectors
    roomSelector.querySelectorAll('.room-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        roomSelector.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRoomKey = btn.dataset.room;
        await loadAndRenderTimelines();
      });
    });

    replayRoomSelector.querySelectorAll('.room-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        replayRoomSelector.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        replayRoomKey = btn.dataset.room;
        loadReplayData(currentMatchId, replayRoomKey);
      });
    });

    // Export button (live timeline)
    exportTimelineBtn?.addEventListener('click', () => {
      const title = `${homeName.textContent} vs ${awayName.textContent}`;
      exportLiveTimeline(title, currentViewMode === 'my-picks');
    });

    // Export button (replay)
    exportReplayPulsemap?.addEventListener('click', () => {
      const title = `${replayHomeName.textContent} vs ${replayAwayName.textContent}`;
      exportReplayTimeline(title);
    });

    // Emoji pad taps
    emojiPad.addEventListener('click', async (e) => {
      const btn = e.target.closest('.emo');
      if (!btn || btn.classList.contains('disabled')) return;

      // Check if emoji pad is disabled (already tapped for this slice)
      if (emojiPad.classList.contains('disabled')) return;

      const emotion = btn.dataset.emotion;
      hapticTap();

      btn.classList.add('tapped');
      setTimeout(() => btn.classList.remove('tapped'), 300);

      // Get current period and sliceIndex from match state
      const period = currentMatchState?.period || PERIOD.FIRST_HALF;
      const sliceIndex = currentMatchState?.sliceIndex || 0;

      // Save user pick locally with period + sliceIndex
      saveUserPick(currentMatchId, period, sliceIndex, emotion);

      // Immediately disable the pad
      emojiPad.classList.add('disabled');

      // Send to server with period and sliceIndex
      const resp = await API.tap(currentMatchId, emotion, currentRoomKey, period, sliceIndex);
      if (resp.ok) {
        const label = currentMatchState?.sliceLabel || `${sliceIndex + 1}'`;
        showNotice(`${emotionEmoji(emotion)} recorded for ${label}`);
        await loadAndRenderTimelines();
      } else {
        showNotice(resp.error || 'Could not record tap');
        // Re-enable if there was an error
        emojiPad.classList.remove('disabled');
      }
    });

    // Dev mode toggle
    devModeToggle?.addEventListener('change', (e) => {
      setDevMode(e.target.checked);
    });

    // Dev controls
    devCreateBtn.addEventListener('click', async () => {
      const matchId = devMatchIdInput.value.trim() || 'test-1';
      const home = devHomeInput.value.trim() || 'Team A';
      const away = devAwayInput.value.trim() || 'Team B';
      const resp = await API.createMock(matchId, home, away);
      if (resp.ok) {
        showNotice('Mock match created');
        loadMatches();
      } else {
        showNotice(resp.error || 'Failed');
      }
    });

    devAdvance1m?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.advanceTime(currentMatchId, 60);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Advanced 1 minute');
      }
    });

    devAdvance2m?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.advanceTime(currentMatchId, 120);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Advanced 2 minutes');
      }
    });

    devAdvance10m.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.advanceTime(currentMatchId, 600);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Advanced 10 minutes');
      }
    });

    devHalftime?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      // Set to half time (45 minutes elapsed)
      const resp = await API.setPeriod(currentMatchId, PERIOD.HALF_TIME, 45 * 60);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Half time!');
      }
    });

    devSecondHalf?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      // Set to second half (46 minutes)
      const resp = await API.setPeriod(currentMatchId, PERIOD.SECOND_HALF, 46 * 60);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Second half started!');
      }
    });

    // ET and Penalty dev controls
    const devET1 = $('#dev-et1');
    const devET2 = $('#dev-et2');
    const devPen = $('#dev-pen');
    const devKick = $('#dev-kick');

    devET1?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.setPeriod(currentMatchId, PERIOD.EXTRA_TIME_1);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Extra Time 1st Half started!');
      }
    });

    devET2?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.setPeriod(currentMatchId, PERIOD.EXTRA_TIME_2);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Extra Time 2nd Half started!');
      }
    });

    devPen?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.setPeriod(currentMatchId, PERIOD.PENALTIES);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        await loadAndRenderTimelines();
        showNotice('Penalty Shootout started!');
      }
    });

    devKick?.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.recordPenalty(currentMatchId);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        await loadAndRenderTimelines();
        showNotice('Penalty kick recorded!');
      } else {
        showNotice(resp.error || 'Could not record penalty');
      }
    });

    devRefresh.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.refreshState(currentMatchId);
      if (resp.ok) {
        currentMatchState = { ...currentMatchState, ...resp };
        updateMatchHeader(resp);
        showNotice('State refreshed');
      }
    });

    devEnd.addEventListener('click', async () => {
      if (!currentMatchId) return;
      const resp = await API.endMatch(currentMatchId);
      if (resp.ok) {
        showNotice('Match ended');
        setTimeout(() => openReplay(currentMatchId), 1000);
      }
    });
  }

  // Load matches
  async function loadMatches() {
    const resp = await API.matches();
    if (resp.ok) {
      if (resp.emotions && Array.isArray(resp.emotions)) {
        EMOTIONS = resp.emotions;
        EMO_MAP = new Map(EMOTIONS.map(e => [e.key, e]));
        renderEmojiPad();
      }
      renderMatchList(resp.matches || []);
    } else {
      noMatchesMsg.classList.remove('hidden');
    }
  }

  // Init
  async function init() {
    initDevMode();
    setupListeners();
    renderEmojiPad();
    await loadMatches();
  }

  init();
})();
