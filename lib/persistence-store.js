class PersistenceStore {
  constructor() {
    this.databaseUrl = process.env.DATABASE_URL || '';
    this.enabled = Boolean(this.databaseUrl);
    this.pool = null;
  }

  async init() {
    if (!this.enabled) {
      console.log('[PersistenceStore] DATABASE_URL not set, using local archive fallback only.');
      return;
    }

    let Pool;
    try {
      ({ Pool } = require('pg'));
    } catch (err) {
      console.error('[PersistenceStore] pg dependency missing; disabling Postgres persistence.');
      this.enabled = false;
      return;
    }

    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: this.databaseUrl.includes('render.com')
        ? { rejectUnauthorized: false }
        : undefined,
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS archive_snapshots (
        match_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tap_events (
        id BIGSERIAL PRIMARY KEY,
        match_id TEXT NOT NULL,
        room_key TEXT NOT NULL,
        period TEXT NOT NULL,
        slice_index INTEGER NOT NULL,
        emotion TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS tap_events_match_idx
      ON tap_events (match_id, created_at);
    `);

    console.log('[PersistenceStore] Postgres persistence initialized.');
  }

  async saveArchiveSnapshot(matchId, name, payloadObj) {
    if (!this.pool) return false;
    const createdAt = Date.now();
    await this.pool.query(
      `
      INSERT INTO archive_snapshots (match_id, name, payload, created_at)
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (match_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        payload = EXCLUDED.payload,
        created_at = EXCLUDED.created_at;
      `,
      [String(matchId), String(name), JSON.stringify(payloadObj), createdAt]
    );
    return true;
  }

  async getArchiveSnapshot(matchId) {
    if (!this.pool) return null;
    const { rows } = await this.pool.query(
      'SELECT name, payload, created_at FROM archive_snapshots WHERE match_id = $1',
      [String(matchId)]
    );
    if (!rows.length) return null;
    return {
      name: rows[0].name,
      payload: rows[0].payload,
      created_at: Number(rows[0].created_at),
    };
  }

  async listArchiveSnapshots() {
    if (!this.pool) return [];
    const { rows } = await this.pool.query(
      'SELECT match_id AS id, name, created_at FROM archive_snapshots ORDER BY created_at DESC'
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      created_at: Number(r.created_at),
    }));
  }

  async deleteArchiveSnapshot(matchId) {
    if (!this.pool) return false;
    await this.pool.query('DELETE FROM archive_snapshots WHERE match_id = $1', [String(matchId)]);
    return true;
  }

  async recordTapEvent({ matchId, roomKey, period, sliceIndex, emotion }) {
    if (!this.pool) return false;
    await this.pool.query(
      `
      INSERT INTO tap_events (match_id, room_key, period, slice_index, emotion, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        String(matchId),
        String(roomKey),
        String(period),
        Number(sliceIndex),
        String(emotion),
        Date.now(),
      ]
    );
    return true;
  }

  async listTapEvents(matchId) {
    if (!this.pool) return [];
    const { rows } = await this.pool.query(
      `
      SELECT room_key, period, slice_index, emotion, created_at
      FROM tap_events
      WHERE match_id = $1
      ORDER BY id ASC
      `,
      [String(matchId)]
    );
    return rows.map((r) => ({
      roomKey: r.room_key,
      period: r.period,
      sliceIndex: Number(r.slice_index),
      emotion: r.emotion,
      createdAt: Number(r.created_at),
    }));
  }
}

module.exports = { PersistenceStore };
