# Repository Guidelines

## Project Structure & Module Organization
This repository has two runnable parts:
- `server.js` + `lib/` + `public/`: Express backend and web client served at `http://localhost:3000`.
- `SoccerPulseApp/`: Expo React Native app (`app/` routes, `components/`, `hooks/`, `services/`, `stores/`, `constants/`).

Configuration and runtime data live in:
- `config/emotions.json` for emoji definitions.
- `data/` for archive storage (`archive.json` or `soccerpulse.db`) and room data.

## Build, Test, and Development Commands
Backend (repo root):
- `npm install`: install Node dependencies.
- `npm start`: start Express server.
- `SPORTMONKS_API_TOKEN=... npm start`: run with live match polling enabled.

Mobile app (`SoccerPulseApp/`):
- `npm install`: install Expo app dependencies.
- `npm run start`: start Expo dev server.
- `npm run ios` / `npm run android`: run native builds locally.
- `npm run web`: run Expo app in browser.

## Coding Style & Naming Conventions
- Use 2-space indentation in both JS and TS/TSX files.
- Prefer `camelCase` for variables/functions, `PascalCase` for React components, and descriptive file names like `useMatchState.ts`.
- Keep modules focused: API logic in `services/`, state in `stores/`, reusable UI in `components/`.
- No enforced lint/format config is committed yet; match existing style before introducing tooling changes.

## Testing Guidelines
There is no automated test suite committed yet. For now:
- Validate backend endpoints manually (for example `GET /api/matches`, `POST /api/matches/:id/tap`).
- Verify SSE updates from `/api/matches/:id/stream` during live/dev match flow.
- For `SoccerPulseApp`, smoke-test `index`, `match/[id]`, and `replay/[id]` routes on at least one platform (`ios`, `android`, or `web`).

## Commit & Pull Request Guidelines
Git history in this workspace is minimal (`Initial commit`), so follow a simple standard:
- Write short, imperative commit subjects (<= 72 chars), e.g. `Add SSE reconnect handling`.
- Keep commits scoped to one logical change.

PRs should include:
- What changed and why.
- How to run/verify locally.
- Screenshots or short recordings for UI changes (web or mobile).
- Linked issue/task when available.

## Security & Configuration Tips
- Keep secrets in `.env` (`SPORTMONKS_API_TOKEN`, `ADMIN_TOKEN`); never commit real tokens.
- Treat `data/` as runtime state; avoid committing transient archive churn unless intentional.
