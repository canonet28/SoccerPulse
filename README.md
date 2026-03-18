# SoccerPulse ⚽

Real-time emotion tracking for live soccer matches. Express how you feel during every minute of the game and see the collective pulse of fans worldwide.

## Features

- **Minute-by-minute tracking** - Tap an emoji for each minute of play
- **All match phases** - Regular time, extra time, and penalty shootouts
- **Stoppage time support** - Captures those crucial added minutes
- **Live PulseMap** - Visual heatmap of fan emotions
- **Interactive replay** - Scrub through archived matches
- **Export & share** - High-quality image export of your match experience
- **Fan rooms** - Optional HOME/AWAY rooms for international matches

## Project Notes

For up-to-date architecture, deployment workflow, EAS build notes, and known gotchas, see `KNOWLEDGEBASE.md`.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open http://localhost:3000/

## Live Match Data (Sportmonks)

To get real live soccer matches, you need a [Sportmonks](https://www.sportmonks.com/) API token:

```bash
SPORTMONKS_API_TOKEN=your-token npm start
```

The server polls Sportmonks every 30 seconds for live match updates.

## Development Mode

Without an API token, you can use dev controls to test the app:

1. Start server: `npm start`
2. Open http://localhost:3000/
3. Use the **Dev Controls** panel at the bottom to:
   - Create a mock match
   - Advance time (+1 min, +2 min, +10 min)
   - Switch periods (HT, 2H, ET1, ET2, PEN)
   - Record penalty kicks
   - End match to test replay view

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `SPORTMONKS_API_TOKEN` | - | Sportmonks API v3 token |
| `ADMIN_TOKEN` | - | Admin endpoint auth |
| `SOCCER_SLICE_SECONDS` | 60 | Slice duration (seconds) |
| `SOCCER_POLL_SECONDS` | 30 | API polling interval |
| `DEBUG_SPORTMONKS` | - | Enable API debug logs |

## How It Works

1. **Live Match** - Server fetches live matches from Sportmonks
2. **Tap Emotions** - Users tap one of 16 emoji reactions per minute
3. **Aggregation** - Taps are aggregated in real-time via SSE
4. **PulseMap** - Dominant emotion per minute shown as a heatmap
5. **Archive** - Finished matches are archived for replay

## Emotions

16 emotions to express how you feel:

| | | | |
|---|---|---|---|
| 🥳 Excited | 😃 Happy | 🤩 Thrilled | 😎 Smug |
| 🫡 Appreciative | 😬 Tense | 😴 Bored | 🤔 Confused |
| 😂 Amused | 🫤 Meh | 🤯 Mindblown | 🤦🏽‍♂️ Perplexed |
| 😔 Disappointed | 😤 Frustrated | 😠 Angry | 🤬 Enraged |

## Tech Stack

- **Backend**: Node.js + Express (~460 lines)
- **Frontend**: Vanilla JavaScript (no build step)
- **Real-time**: Server-Sent Events (SSE)
- **Storage**: SQLite (preferred) or JSON fallback
- **Live Data**: Sportmonks Football API v3

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/matches` | List all matches |
| GET | `/api/matches/:id/state` | Get match state |
| POST | `/api/matches/:id/tap` | Record emotion tap |
| GET | `/api/matches/:id/heatmap/slices` | Get live heatmap |
| GET | `/api/matches/:id/replay/slices` | Get replay data |
| GET | `/api/matches/:id/stream` | SSE real-time updates |

Dev endpoints available at `/api/dev/...` (disabled in production).

## Project Structure

```
SoccerPulse/
├── server.js                  # Express server (~460 lines)
├── package.json
├── .env                       # Environment variables
├── lib/
│   ├── soccer-engine.js       # Core match engine
│   └── sportmonks-provider.js # Sportmonks API client
├── public/
│   ├── index.html             # Main HTML (served at /)
│   ├── soccer.js              # Frontend SPA
│   └── soccer.css             # Styles
├── config/
│   └── emotions.json          # 16 emoji definitions
└── data/
    ├── archive.json           # Match archives (JSON fallback)
    ├── soccerpulse.db         # Match archives (SQLite)
    └── soccer/
        └── worldcupRooms.json # Nation rooms config
```

## Native Apps (Capacitor)

For mobile apps using Capacitor:

```bash
npm install @capacitor/core @capacitor/ios @capacitor/android
npx cap init
npx cap add ios
npx cap sync
npx cap open ios
```

## License

MIT
