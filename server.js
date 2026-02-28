require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Static frontend (served from /public)
app.use(express.static(path.join(__dirname, 'public')));

// --- Emotions config ---
function defaultEmotions() {
  return [
    { key: 'excited', emoji: '🥳', label: 'Excited' },
    { key: 'happy', emoji: '😃', label: 'Happy' },
    { key: 'thrilled', emoji: '🤩', label: 'Thrilled' },
    { key: 'frustrated', emoji: '😤', label: 'Frustrated' },
    { key: 'angry', emoji: '😠', label: 'Angry' },
  ];
}

function loadEmotions() {
  try {
    const p = path.join(__dirname, 'config', 'emotions.json');
    if (!fs.existsSync(p)) return defaultEmotions();
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return defaultEmotions();
    return arr.map(e => ({ key: String(e.key), emoji: String(e.emoji || ''), label: String(e.label || e.key) }));
  } catch (_) {
    return defaultEmotions();
  }
}

const EMOTIONS = loadEmotions();

// --- Persistence: SQLite (preferred) with JSON fallback ---
let db = null;
let useSqlite = false;

function dbInit() {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const dataDir = path.join(__dirname, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    db = new BetterSqlite3(path.join(dataDir, 'soccerpulse.db'));
    db.pragma('journal_mode = WAL');
    db.prepare(
      'CREATE TABLE IF NOT EXISTS archive (match_id TEXT PRIMARY KEY, name TEXT, payload TEXT, created_at INTEGER)'
    ).run();
    useSqlite = true;
  } catch (e) {
    const dataDir = path.join(__dirname, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const f = path.join(dataDir, 'archive.json');
    if (!fs.existsSync(f)) fs.writeFileSync(f, '{}', 'utf8');
  }
}
dbInit();

function saveArchiveSnapshot(matchId, name, payloadObj) {
  const created = Date.now();
  if (useSqlite) {
    db.prepare('INSERT OR REPLACE INTO archive (match_id, name, payload, created_at) VALUES (?,?,?,?)')
      .run(matchId, name, JSON.stringify(payloadObj), created);
  } else {
    const f = path.join(__dirname, 'data', 'archive.json');
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    obj[matchId] = { name, payload: payloadObj, created_at: created };
    fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  }
}

function getArchiveSnapshot(matchId) {
  if (useSqlite) {
    const row = db.prepare('SELECT name, payload, created_at FROM archive WHERE match_id = ?').get(matchId);
    if (!row) return null;
    return { name: row.name, payload: JSON.parse(row.payload || '{}'), created_at: row.created_at };
  } else {
    const f = path.join(__dirname, 'data', 'archive.json');
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!obj[matchId]) return null;
    return { name: obj[matchId].name, payload: obj[matchId].payload, created_at: obj[matchId].created_at };
  }
}

function deleteArchiveSnapshot(matchId) {
  if (useSqlite) {
    db.prepare('DELETE FROM archive WHERE match_id = ?').run(matchId);
  } else {
    const f = path.join(__dirname, 'data', 'archive.json');
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete obj[matchId];
    fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  }
}

function listArchiveSnapshots() {
  if (useSqlite) {
    const rows = db.prepare('SELECT match_id as id, name, created_at FROM archive ORDER BY created_at DESC').all();
    return rows;
  } else {
    const f = path.join(__dirname, 'data', 'archive.json');
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Object.entries(obj).map(([id, v]) => ({ id, name: v.name, created_at: v.created_at })).sort((a, b) => b.created_at - a.created_at);
  }
}

// --- Admin auth middleware ---
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) { next(); return; }
  const tok = req.headers['x-admin-token'] || req.query.admin_token;
  if (tok !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// =============================================================================
// SOCCER ENGINE
// =============================================================================

const { SoccerEngine, ROOM_GLOBAL, ROOM_HOME, ROOM_AWAY, STATUS: SOCCER_STATUS, PERIOD, PERIOD_CONFIG, SLICE_SECONDS } = require('./lib/soccer-engine');

// Initialize Soccer Engine
const soccerEngine = new SoccerEngine(
  () => EMOTIONS,
  saveArchiveSnapshot,
  getArchiveSnapshot,
  deleteArchiveSnapshot
);

// Start ticker if API token is configured
if (process.env.SPORTMONKS_API_TOKEN) {
  soccerEngine.startTicker();
} else {
  console.log('[SoccerPulse] SPORTMONKS_API_TOKEN not set. Use dev endpoints to create mock matches.');
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

// GET /api/matches - List all matches
app.get('/api/matches', (req, res) => {
  const matches = soccerEngine.listMatches();
  res.json({ ok: true, matches, emotions: EMOTIONS });
});

// GET /api/matches/:matchId/state - Get match state
app.get('/api/matches/:matchId/state', (req, res) => {
  const state = soccerEngine.getMatchState(req.params.matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }
  res.json({ ok: true, ...state });
});

// POST /api/matches/:matchId/tap - Record emotion tap
app.post('/api/matches/:matchId/tap', (req, res) => {
  const { matchId } = req.params;
  const { emotion, roomKey, period, sliceIndex: clientSliceIndex, minute } = req.body || {};

  // Validate emotion
  const emotionValid = EMOTIONS.find(e => e.key === emotion);
  if (!emotionValid) {
    return res.status(400).json({ ok: false, error: 'Invalid emotion' });
  }

  // Get match state
  const state = soccerEngine.getMatchState(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }

  if (state.archived) {
    return res.status(400).json({ ok: false, error: 'Match has ended' });
  }

  // Validate room key
  let validRoomKey = ROOM_GLOBAL;
  if (roomKey) {
    if (roomKey === ROOM_HOME || roomKey === ROOM_AWAY) {
      if (!state.worldCupRoomsEnabled) {
        return res.status(400).json({ ok: false, error: 'Nation rooms not enabled for this match' });
      }
      validRoomKey = roomKey;
    } else if (roomKey !== ROOM_GLOBAL) {
      return res.status(400).json({ ok: false, error: 'Invalid roomKey' });
    }
  }

  // Determine period and sliceIndex
  let tapPeriod = period || state.period;
  let tapSliceIndex;

  if (clientSliceIndex !== undefined) {
    tapSliceIndex = parseInt(clientSliceIndex, 10);
  } else if (minute) {
    // Legacy: convert absolute minute to period + sliceIndex
    const absMinute = parseInt(minute, 10);
    if (absMinute <= 45) {
      tapPeriod = PERIOD.FIRST_HALF;
      tapSliceIndex = absMinute - 1;
    } else if (absMinute <= 90) {
      tapPeriod = PERIOD.SECOND_HALF;
      tapSliceIndex = absMinute - 46;
    } else if (absMinute <= 105) {
      tapPeriod = PERIOD.EXTRA_TIME_1;
      tapSliceIndex = absMinute - 91;
    } else {
      tapPeriod = PERIOD.EXTRA_TIME_2;
      tapSliceIndex = absMinute - 106;
    }
  } else {
    tapSliceIndex = state.sliceIndex;
  }

  // Record tap with period info
  const result = soccerEngine.recordTap(matchId, validRoomKey, tapPeriod, tapSliceIndex, emotion);

  // Debug log
  if (process.env.DEBUG_SPORTMONKS) {
    const label = soccerEngine.sliceToLabel(tapPeriod, tapSliceIndex);
    console.log(`[Tap] Match ${matchId}, room ${validRoomKey}, period ${tapPeriod}, slice ${tapSliceIndex} (${label}): ${emotion} (total=${result.total})`);
  }

  // Broadcast to SSE clients
  soccerEngine.broadcastToMatch(matchId, 'tap_update', {
    matchId,
    roomKey: validRoomKey,
    period: tapPeriod,
    sliceIndex: tapSliceIndex,
    label: soccerEngine.sliceToLabel(tapPeriod, tapSliceIndex),
    emotion,
    counts: result.counts,
    total: result.total,
    dominant: result.dominant
  });

  res.json({ ok: true, period: tapPeriod, sliceIndex: tapSliceIndex, ...result });
});

// GET /api/matches/:matchId/heatmap/slices - Get heatmap slices
app.get('/api/matches/:matchId/heatmap/slices', (req, res) => {
  const { matchId } = req.params;
  const roomKey = req.query.roomKey || ROOM_GLOBAL;

  const state = soccerEngine.getMatchState(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }

  if (roomKey !== ROOM_GLOBAL && roomKey !== ROOM_HOME && roomKey !== ROOM_AWAY) {
    return res.status(400).json({ ok: false, error: 'Invalid roomKey' });
  }

  const heatmap = soccerEngine.getHeatmapSlices(matchId, roomKey);

  if (process.env.DEBUG_SPORTMONKS && heatmap.periods) {
    for (const [period, data] of Object.entries(heatmap.periods)) {
      const slicesWithData = (data.slices || []).filter(s => s.total > 0);
      if (slicesWithData.length > 0) {
        console.log(`[Heatmap] Match ${matchId}, room ${roomKey}, period ${period}: ${slicesWithData.length} slices with data`);
      }
    }
  }

  res.json({ ok: true, ...heatmap });
});

// GET /api/matches/:matchId/replay/slices - Get replay slices (archived only)
app.get('/api/matches/:matchId/replay/slices', (req, res) => {
  const { matchId } = req.params;
  const roomKey = req.query.roomKey || ROOM_GLOBAL;

  const state = soccerEngine.getMatchState(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }

  if (!state.archived) {
    return res.status(409).json({ ok: false, error: 'Replay available after match ends' });
  }

  if (roomKey !== ROOM_GLOBAL && roomKey !== ROOM_HOME && roomKey !== ROOM_AWAY) {
    return res.status(400).json({ ok: false, error: 'Invalid roomKey' });
  }

  const replay = soccerEngine.getReplaySlices(matchId, roomKey);
  res.json({ ok: true, ...replay });
});

// SSE stream for match updates
app.get('/api/matches/:matchId/stream', (req, res) => {
  const { matchId } = req.params;
  const state = soccerEngine.getMatchState(matchId);
  if (!state) {
    return res.status(404).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const clients = soccerEngine.getSseClients(matchId);
  clients.add(res);
  res.write('retry: 5000\n\n');

  // Send initial state
  soccerEngine.sseWrite(res, 'init', state);

  req.on('close', () => {
    clients.delete(res);
    try { res.end(); } catch (_) {}
  });
});

// SSE heartbeat
setInterval(() => {
  for (const [matchId, clients] of soccerEngine.sseClients.entries()) {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch (_) {}
    }
  }
}, 25000);

// =============================================================================
// DEV ENDPOINTS (disabled in production)
// =============================================================================

// POST /api/dev/mock-match - Create a mock match for testing
app.post('/api/dev/mock-match', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId, home, away } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }
  const match = soccerEngine.devCreateMockMatch(matchId, home || 'Home Team', away || 'Away Team');
  res.json({ ok: true, match: soccerEngine.getMatchState(matchId) });
});

// POST /api/dev/advance-time - Advance match time
app.post('/api/dev/advance-time', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId, seconds } = req.body || {};
  if (!matchId || typeof seconds !== 'number') {
    return res.status(400).json({ ok: false, error: 'matchId and seconds required' });
  }
  const state = soccerEngine.devAdvanceTime(matchId, seconds);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }
  res.json({ ok: true, ...state });
});

// POST /api/dev/end-match - End a match
app.post('/api/dev/end-match', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }
  const state = soccerEngine.devEndMatch(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }
  res.json({ ok: true, ...state });
});

// POST /api/dev/refresh-state - Force refresh from provider
app.post('/api/dev/refresh-state', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }
  const match = await soccerEngine.refreshMatchState(matchId);
  if (!match) {
    return res.status(404).json({ ok: false, error: 'Could not fetch match state' });
  }
  res.json({ ok: true, ...soccerEngine.getMatchState(matchId) });
});

// POST /api/dev/set-period - Set match period (for testing ET, penalties)
app.post('/api/dev/set-period', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId, period, elapsedSeconds } = req.body || {};
  if (!matchId || !period) {
    return res.status(400).json({ ok: false, error: 'matchId and period required' });
  }
  const validPeriods = Object.values(PERIOD);
  if (!validPeriods.includes(period)) {
    return res.status(400).json({ ok: false, error: `Invalid period. Valid: ${validPeriods.join(', ')}` });
  }
  const state = soccerEngine.devSetPeriod(matchId, period, elapsedSeconds);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }
  res.json({ ok: true, ...state });
});

// POST /api/dev/record-penalty - Record a penalty kick
app.post('/api/dev/record-penalty', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }
  const state = soccerEngine.devRecordPenalty(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found or not in penalty shootout' });
  }
  res.json({ ok: true, ...state });
});

// DELETE /api/dev/match/:matchId - Delete a finished match
app.delete('/api/dev/match/:matchId', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Not available in production' });
  }
  const { matchId } = req.params;
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }

  // Check if match exists and is archived
  const state = soccerEngine.getMatchState(matchId);
  if (!state) {
    return res.status(404).json({ ok: false, error: 'Match not found' });
  }
  if (!state.archived) {
    return res.status(400).json({ ok: false, error: 'Can only delete finished matches' });
  }

  // Delete from archive (archiveId is prefixed with 'soccer-')
  const archiveId = `soccer-${matchId}`;
  deleteArchiveSnapshot(archiveId);

  // Remove from matches map
  soccerEngine.matches.delete(String(matchId));

  // Clear aggregates for this match
  soccerEngine.aggregates.delete(String(matchId));

  res.json({ ok: true, deleted: matchId });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

// POST /api/admin/worldcup-rooms - Enable/disable nation rooms
app.post('/api/admin/worldcup-rooms', requireAdmin, (req, res) => {
  const { matchId, enabled } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'matchId required' });
  }
  soccerEngine.setWorldCupRoomsEnabled(matchId, !!enabled);
  const match = soccerEngine.matches.get(String(matchId));
  if (match) {
    match.worldCupRoomsEnabled = !!enabled;
  }
  res.json({ ok: true, matchId, worldCupRoomsEnabled: soccerEngine.isWorldCupRoomsEnabled(matchId) });
});

// GET /api/config/emotions - Get emotions config
app.get('/api/config/emotions', (req, res) => {
  res.json({ ok: true, emotions: EMOTIONS });
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SoccerPulse running on http://localhost:${PORT}/`);
});
