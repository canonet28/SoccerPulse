# SoccerPulse Knowledgebase

Last updated: 2026-03-01

## 1) Repository Map
- Root repo (`SoccerPulse/`): Node/Express backend + web UI.
- Mobile app lives in `SoccerPulseApp/` and is a separate git repo.
- Backend entrypoint: `server.js`
- Core engine: `lib/soccer-engine.js`
- Postgres persistence: `lib/persistence-store.js`
- DB migration: `migrations/001_postgres_persistence.sql`

## 2) Production Topology
- Backend hosted on Render: `https://soccerpulse.onrender.com`
- Mobile app (Expo/React Native) points to backend via `EXPO_PUBLIC_API_URL`.
- SSE endpoint used by app: `/api/matches/:matchId/stream`

## 3) Persistence Model (Current)
- Live aggregation remains in-memory for real-time behavior.
- Durable storage uses Postgres when `DATABASE_URL` is set:
  - `archive_snapshots` (archived match payloads)
  - `tap_events` (tap history for rehydration)
- Local fallback still exists (SQLite/JSON) for non-Postgres/dev paths.
- On server boot, archived matches are restored from persistence.

## 4) Important Backend Behavior
- Archived delete route for production/admin:
  - `DELETE /api/admin/archive/:matchId`
- Dev delete route still exists:
  - `DELETE /api/dev/match/:matchId` (disabled in production)
- Web UI delete button visibility is intentionally tied to `dev-mode` CSS.
- Delete path now removes archive from memory + local fallback + Postgres.

## 5) Environment Variables
Backend (`.env.example` at root):
- Required: `SPORTMONKS_API_TOKEN`, `DATABASE_URL`
- Recommended: `ADMIN_TOKEN`
- Runtime tuning: `SOCCER_SLICE_SECONDS`, `SOCCER_POLL_SECONDS`

Mobile (`SoccerPulseApp/.env.example`):
- Required for device/test/prod: `EXPO_PUBLIC_API_URL=https://soccerpulse.onrender.com`
- Never use localhost on physical devices.

## 6) Deploy Workflow (Backend)
1. Push backend changes to GitHub.
2. Render auto-deploys connected branch.
3. Ensure migration has been run once:
   - `psql "$DATABASE_URL" -f migrations/001_postgres_persistence.sql`
4. Verify live matches, taps, archive creation, and persistence across restart.

## 7) Mobile Build Workflow (EAS)
- EAS project is configured (`SoccerPulseApp/eas.json`).
- iOS app config includes `ITSAppUsesNonExemptEncryption: false`.
- Build commands:
  - `eas build --platform ios --profile production`
  - `eas build --platform android --profile production`

## 8) EAS / Dependency Gotchas Encountered
- EAS env visibility must be one of: `plaintext`, `sensitive`, `secret`.
- For `EXPO_PUBLIC_*` vars, use `plaintext`.
- Old `eas secret:create` entries can conflict with `eas env:create`; remove old secret first if needed.
- A prior build failed due to `react@19.1.0` vs `react-dom@19.2.4` lockfile mismatch. Keep React family versions aligned for EAS `npm ci`.

## 9) UX/Product Decisions Captured
- Live Match screen default mode is `Pulse` (not `My Picks`).
- Home uses tabbed sections for live vs archived matches.
- Archive deletion capability is required and retained.

## 10) Quick Smoke Test Checklist
Backend/Web:
1. `/api/matches` returns live/ended data.
2. Tap on live match increments totals.
3. Ended match appears in archived list.
4. Restart backend; archived/tap data still present.

Mobile:
1. App loads matches on real iPhone over Expo/TestFlight.
2. SSE reconnects after transient network loss.
3. Replay and timeline render without clipped content.
