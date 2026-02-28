# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SoccerPulse** is a real-time soccer emotion tracking app that lets fans express their emotions during live matches. Users tap emoji reactions for each minute of play, and the app aggregates these into a visual "PulseMap" heatmap showing collective fan emotions throughout the match.

### Key Features
- Real-time emotion tracking per minute of play
- Support for all match phases: Regular time, Extra time, Penalty shootouts
- Period-based data storage with stoppage time support
- Interactive replay scrubber for archived matches
- High-quality image export of PulseMaps
- Optional HOME/AWAY fan rooms for international matches

## Commands

```bash
# Start the server (default port 3000)
npm start

# Or directly
node server.js

# With custom port
PORT=8080 node server.js

# With Sportmonks API (required for live soccer data)
SPORTMONKS_API_TOKEN=your-token node server.js

# With debug logging
DEBUG_SPORTMONKS=1 SPORTMONKS_API_TOKEN=your-token node server.js
```

No test or lint commands are currently configured.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `ADMIN_TOKEN` | (none) | Admin endpoint auth token |
| `SPORTMONKS_API_TOKEN` | (none) | Sportmonks API v3 token for live soccer |
| `SPORTMONKS_BASE_URL` | `https://api.sportmonks.com/v3/football` | Sportmonks API base |
| `SOCCER_SLICE_SECONDS` | 60 | Time slice duration (1 minute) |
| `SOCCER_POLL_SECONDS` | 30 | Sportmonks polling interval |
| `DEBUG_SPORTMONKS` | (none) | Enable debug logging for API |

## Architecture

### Tech Stack
- **Backend:** Node.js + Express.js (~460 lines)
- **Frontend:** Vanilla JavaScript SPA (no build step)
- **Real-time:** Server-Sent Events (SSE)
- **Storage:** SQLite (preferred) or JSON file fallback
- **API Provider:** Sportmonks Football API v3

### Data Persistence
- **Live matches:** In-memory aggregation (lost on restart)
- **Archived matches:** SQLite (`data/soccerpulse.db`) or JSON (`data/archive.json`)
- **World Cup rooms:** JSON file (`data/soccer/worldcupRooms.json`)
- **User picks:** Browser localStorage (client-side only)

### Project Structure

```
SoccerPulse/
├── server.js                    # Express backend (~460 lines)
├── package.json                 # Dependencies
├── .env                         # Environment variables
│
├── lib/
│   ├── soccer-engine.js         # Core match engine & aggregation
│   └── sportmonks-provider.js   # Sportmonks API client
│
├── public/
│   ├── index.html               # Frontend HTML (served at /)
│   ├── soccer.js                # Frontend JavaScript SPA
│   └── soccer.css               # Styles (light theme)
│
├── config/
│   └── emotions.json            # 16 emoji emotions
│
└── data/
    ├── soccerpulse.db           # SQLite database (if available)
    ├── archive.json             # JSON fallback for archives
    └── soccer/
        └── worldcupRooms.json   # World Cup rooms config
```

### Data Model

**Period-Based Storage:**
```
matchId -> roomKey -> period -> sliceIndex -> { counts, total }
```

**Periods:**
| Period | Key | Minutes | Slices |
|--------|-----|---------|--------|
| First Half | `1H` | 1-45 | 0-44 (+ stoppage) |
| Half Time | `HT` | - | (break, no taps) |
| Second Half | `2H` | 46-90 | 0-44 (+ stoppage) |
| Extra Time 1 | `ET1` | 91-105 | 0-14 (+ stoppage) |
| Extra Time 2 | `ET2` | 106-120 | 0-14 (+ stoppage) |
| Penalties | `PEN` | - | 0+ (kick-based) |
| Full Time | `FT` | - | (match ended) |

**Slice Labels:**
- Regular time: `1'`, `2'`, ... `45'`
- Stoppage: `45+1'`, `45+2'`, `90+3'`
- Penalties: `T1-1`, `T2-1`, `T1-2`, `T2-2` (alternating teams)

**Room Keys:**
- `GLOBAL` - Default room for all users
- `HOME` - Home team fans (World Cup mode)
- `AWAY` - Away team fans (World Cup mode)

### Sportmonks Integration

**State Mapping:**
| Sportmonks State | Internal Status | Period |
|------------------|-----------------|--------|
| `1H`, `FIRST_HALF` | LIVE | 1H |
| `HT`, `BREAK` | HALFTIME | HT |
| `2H`, `SECOND_HALF` | LIVE | 2H |
| `ET`, `ET_1H` | LIVE | ET1 |
| `ET_2H` | LIVE | ET2 |
| `PEN_LIVE`, `PENALTIES` | LIVE | PEN |
| `FT`, `AET`, `FT_PEN` | ENDED | FT |

**API Includes:**
- `participants` - Team names
- `periods` - Current minute (ticking period)
- `state` - Match phase
- `events` - Penalty kick detection

### SSE Events

Stream endpoint: `GET /api/matches/:matchId/stream`

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{matchId}` | Initial connection |
| `state` | Full match state | Current state on connect |
| `slice_advance` | `{period, sliceIndex, label}` | Minute changed |
| `status_change` | `{status, period}` | Period/status changed |
| `tap` | `{period, sliceIndex, counts, total}` | New tap recorded |
| `penalty_kick` | `{kickNumber, sliceIndex}` | Penalty kick detected |
| `match_ended` | `{matchId, archived}` | Match finished |

## API Reference

All API endpoints are at `/api/...` (no `/soccer` prefix).

### Public Endpoints

```
GET  /api/matches
     Returns list of all matches with status, period, totalTaps

GET  /api/matches/:matchId/state
     Returns current match state

POST /api/matches/:matchId/tap
     Body: { emotion, roomKey?, period?, sliceIndex? }
     Records an emotion tap

GET  /api/matches/:matchId/heatmap/slices?roomKey=GLOBAL
     Returns period-based heatmap data

GET  /api/matches/:matchId/replay/slices?roomKey=GLOBAL
     Returns replay data (archived matches only, 409 if live)

GET  /api/matches/:matchId/stream
     SSE stream for real-time updates
```

### Dev Endpoints (non-production)

```
POST /api/dev/mock-match
     Body: { matchId, home, away }
     Creates a test match

POST /api/dev/advance-time
     Body: { matchId, seconds }
     Advances match clock

POST /api/dev/set-period
     Body: { matchId, period }
     Sets match period (1H, 2H, ET1, ET2, PEN)

POST /api/dev/record-penalty
     Body: { matchId }
     Advances to next penalty kick

POST /api/dev/end-match
     Body: { matchId }
     Ends and archives match

POST /api/dev/refresh-state
     Body: { matchId }
     Force refresh from Sportmonks
```

### Admin Endpoints

```
POST /api/admin/worldcup-rooms
     Header: Authorization: Bearer <ADMIN_TOKEN>
     Body: { matchId, enabled }
     Enables HOME/AWAY rooms for a match
```

## Frontend Architecture

### Views
1. **Home View** - Match list (live, upcoming, finished)
2. **Match View** - Live match with emoji pad + timeline
3. **Replay View** - Archived match with scrubber + PulseMap

### Key Functions
- `renderLiveTimeline()` - Renders minute grid for current match
- `renderReplayPulsemap()` - Renders full match heatmap
- `renderReplayScrubber()` - Interactive timeline with markers
- `exportTimeline()` - Canvas-based high-quality image export
- `updateEmojiPadState()` - One tap per minute enforcement

### Local Storage
User picks stored as: `soccerpulse-picks-{matchId}`
Format: `{ "period|sliceIndex": "emotionKey" }`

### Export Image Features
- 2x scale for retina quality
- Minute labels on each cell
- Stoppage time included
- Period markers (HT, ET, PEN)
- Center-aligned penalty boxes
- Team-colored penalty labels

## Emotions

16 emotions defined in `config/emotions.json`:

| Emoji | Key | Label |
|-------|-----|-------|
| 🥳 | excited | Excited |
| 😃 | happy | Happy |
| 🤩 | thrilled | Thrilled |
| 😎 | smug | Smug |
| 🫡 | salute | Appreciative |
| 😬 | tense | Tense |
| 😴 | bored | Bored |
| 🤔 | confused | Confused |
| 😂 | amused | Amused |
| 🫤 | meh | Meh |
| 🤯 | mindblown | Mindblown |
| 🤦🏽‍♂️ | facepalm | Perplexed |
| 😔 | disappointed | Disappointed |
| 😤 | frustrated | Frustrated |
| 😠 | angry | Angry |
| 🤬 | enraged | Enraged |

## Deployment

Server binds to `0.0.0.0` on configured PORT.

Access at: `http://localhost:3000/`

### Production Checklist
- Set `NODE_ENV=production` (disables dev endpoints)
- Set `SPORTMONKS_API_TOKEN` for live match data
- Set `ADMIN_TOKEN` for admin endpoints
- Ensure `data/` directory is writable for archives
