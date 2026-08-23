# Archipelago Broadcast Control

A lightweight production-coordination system for large [Archipelago](https://archipelago.gg/) multiworld broadcasts.

Players use a browser interface to report their current game and production priority. The broadcast team receives real-time player status, air-state feedback, compact monitoring, graphics data, and automation controls. The application runs independently of the video signal path.

## Screenshots

### Player Controls

![Player controls](docs/images/player-controls.png)

### Compact Monitor

![Compact production monitor](docs/images/compact-monitor.png)

### Production Dashboard

![Production dashboard](docs/images/production-dashboard.png)

## Features

- Player-selectable current game
- Normal, Soon, ASAP, and Downtime / No Progression statuses
- Automatic status expiration
- Stand By, Live, and Off Air feedback to players
- Production dashboard with connection and system-health monitoring
- 640×360 compact production call monitor
- Per-player panic reset and event-state reset
- HTTP lower-third API and JSON WebSocket API
- Bitfocus Companion-compatible production control
- Persistent runtime state across server restarts

## Installation

### Windows Portable Release

Download the Windows x64 portable package from the repository's **Releases** page and extract it.

The portable release includes the Node.js runtime and application dependencies. Node.js, npm, and Git do not need to be installed on the event computer.

1. Copy `config.example.json` to `config.json`.
2. Edit `config.json` with the event roster, game assignments, and player tokens.
3. Run `start-event.cmd`.
4. Enter the production admin key when prompted.

The launcher starts the server and opens the production dashboard.

### Running from Source

Node.js 18 or newer is required.

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

Set the admin key and start the server:

**Windows PowerShell**

```powershell
$env:ADMIN_KEY="your-production-key"
npm start
```

**macOS / Linux**

```bash
ADMIN_KEY="your-production-key" npm start
```

The server listens on port `3000` by default. The production dashboard is available at:

```text
http://localhost:3000/dashboard.html
```

## Configuration

`config.json` defines the player roster, game assignments, player tokens, status labels, priorities, and expiration times.

A template is provided in `config.example.json`.

```json
{
  "id": "john",
  "name": "John",
  "token": "replace-with-a-long-random-token",
  "games": ["Super Metroid", "Celeste", "TUNIC"],
  "startingGame": "Super Metroid"
}
```

`config.json` is excluded from Git because it may contain player authentication tokens.

## Interfaces

| Path | Purpose |
| --- | --- |
| `/player.html?id=PLAYER_ID&token=PLAYER_TOKEN` | Player controls |
| `/dashboard.html` | Production control dashboard |
| `/compact.html` | Compact production call monitor |
| `/multiview.html` | Status-aware multiview |
| `/overlay.html?id=PLAYER_ID&status=0` | Transparent player/game overlay |

The server also provides read-only HTTP endpoints for graphics and monitoring and a JSON WebSocket API for real-time integrations and production control.

## Documentation

- [Complete API Reference](docs/api-reference.html)
- [Application Pages Reference](docs/application-pages.html)

## Security

The application is designed for use on a trusted production network and is not configured for direct public-internet exposure.

Read-only state and graphics endpoints are unauthenticated. State-changing player and admin WebSocket commands require authentication.

Player-page URLs contain authentication tokens and should be treated as credentials.

## License

Archipelago Broadcast Control is licensed under the GNU General Public License v3.0.

See [LICENSE](LICENSE) for the full license text.
