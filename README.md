# Archipelago Broadcast Control

A lightweight production-coordination system for large [Archipelago](https://archipelago.gg/) multiworld broadcasts.

Players use a simple browser interface to report their current game and whether production should prioritize their feed. The broadcast team gets a real-time dashboard, compact call monitor, air-state feedback, lower-third data, and a WebSocket API for automation.

The application is designed for a trusted local production network and intentionally stays outside the video signal path.

## Screenshots

### Player Controls

Players select their current game, set their production status, and receive standby/live feedback.

![Player controls](docs/images/player-controls.png)

### Compact Monitor

A 640×360 distance-readable priority monitor designed for a production multiview.

![Compact production monitor](docs/images/compact-monitor.png)

### Production Dashboard

The full production view provides system health, event controls, player status, and air-state controls.

![Production dashboard](docs/images/production-dashboard.png)

## Features

- Player-selectable current game
- Normal, Soon, ASAP, and Downtime / No Progression statuses
- Automatic status expiration
- Stand By / Live / Off Air feedback to players
- Production dashboard and 640×360 compact call monitor
- Per-player and event-wide recovery controls
- HTTP lower-third API and JSON WebSocket API
- Bitfocus Companion-compatible control
- Persistent state across server restarts
- Production health and connection monitoring

## Requirements

- Node.js 18 or newer
- npm
- Network connectivity between the server, player stations, and production systems

## Quick Start

Install dependencies:

```bash
npm ci
```

Create the event configuration:

**Windows PowerShell**
```powershell
Copy-Item config.example.json config.json
```

**macOS / Linux**
```bash
cp config.example.json config.json
```

Edit `config.json` with the player roster, assigned games, starting games, and unique player tokens.

Set the production admin key and start the server:

**Windows PowerShell**
```powershell
$env:ADMIN_KEY="your-production-key"
npm start
```

**macOS / Linux**
```bash
ADMIN_KEY="your-production-key" npm start
```

Then open:

```text
http://localhost:3000/dashboard.html
```

Other systems on the network should use the server's LAN address, for example `http://192.168.1.50:3000/`.

## Configuration

```json
{
  "id": "alan",
  "name": "Alan",
  "token": "replace-with-a-long-random-token",
  "games": ["Super Metroid", "Celeste", "TUNIC"],
  "startingGame": "Super Metroid"
}
```

## Interfaces

| Path | Purpose |
| --- | --- |
| `/player.html?id=PLAYER_ID&token=PLAYER_TOKEN` | Player controls |
| `/dashboard.html` | Production control dashboard |
| `/compact.html` | Compact production call monitor |
| `/multiview.html` | Status-aware multiview |
| `/overlay.html?id=PLAYER_ID&status=0` | Transparent player/game overlay |

The server also exposes read-only HTTP endpoints for graphics and monitoring, plus a standard JSON WebSocket API for real-time integrations and production control.

## Documentation

- [Complete API Reference](https://thefiz.github.io/archipelagobroadcastcontrol/api-reference.html)
- [Application Pages Reference](https://thefiz.github.io/archipelagobroadcastcontrol/application-pages.html)

## Security

The default deployment model assumes a trusted production LAN. Read-only state and graphics endpoints are unauthenticated; state-changing player and admin commands require WebSocket authentication.

Player-page URLs contain authentication tokens and should be treated as credentials. Additional hardening is recommended before exposing the server to the public internet.

## License

See [LICENSE](LICENSE) for licensing terms.
