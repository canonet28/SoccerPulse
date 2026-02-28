# Deployment Runbook

## Overview
This project has:
- Backend + Web UI at repo root (`server.js`, `public/`)
- Mobile app in `SoccerPulseApp/` (Expo)

Production backend is expected to run on Render with Postgres persistence enabled.

## 1) Required Environment Variables (Backend)
Set these in Render service environment:
- `NODE_ENV=production`
- `SPORTMONKS_API_TOKEN=<your token>`
- `DATABASE_URL=<render postgres url>`
- `ADMIN_TOKEN=<strong random string>` (recommended)
- `SOCCER_SLICE_SECONDS=60` (optional tuning)
- `SOCCER_POLL_SECONDS=30` (optional tuning)

Reference: `.env.example`

## 2) One-time Database Migration
Run once against your Render Postgres DB:

```bash
psql "$DATABASE_URL" -f migrations/001_postgres_persistence.sql
```

This creates `archive_snapshots` and `tap_events`.

## 3) Deploy Workflow
1. Make code changes locally.
2. Commit and push to GitHub.
3. Render auto-deploys from your connected branch.
4. Check Render logs for startup success and DB connection messages.

## 4) Verify After Deploy
1. Open web app and confirm live matches load.
2. Create taps on a live match.
3. End/archive a match and verify it appears under archived.
4. Restart/redeploy service; verify taps/archive still persist.

## 5) Admin Operations
- Delete archived match endpoint: `DELETE /api/admin/archive/:matchId`
- If `ADMIN_TOKEN` is set, send it as `x-admin-token` header (or `?admin_token=`).

## 6) Mobile App Production Endpoint
Set app API base URL to your backend host in `SoccerPulseApp` env/config (for example, `EXPO_PUBLIC_API_BASE_URL=https://soccerpulse.onrender.com`).
