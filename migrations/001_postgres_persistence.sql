-- SoccerPulse Postgres persistence migration
-- Run this once against your production DATABASE_URL.

CREATE TABLE IF NOT EXISTS archive_snapshots (
  match_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tap_events (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,
  room_key TEXT NOT NULL,
  period TEXT NOT NULL,
  slice_index INTEGER NOT NULL,
  emotion TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS tap_events_match_idx
ON tap_events (match_id, created_at);

