# Archipelago Broadcast Control

A lightweight starter system for:

- Player selection of their current game
- Player-reported `Normal`, `Interesting Soon`, `Please Show Me ASAP`, and `Downtime` states
- Automatic status expiration
- A production dashboard sorted by relevance
- Manual `Stand By`, `Live`, and `Off Air` feedback to player pages
- A status-aware multiview mockup
- A transparent per-player browser overlay for OBS, vMix, or another HTML graphics system
- Local-network hosting with a path toward internet deployment

## Requirements

Install a current Node.js LTS release. The server requires Node.js 18 or newer and uses the `ws` package for standard WebSocket support.

## Setup

1. Copy `config.example.json` to `config.json`.
2. Replace the sample players, game assignments, and tokens.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Set a production key and start the server.

   PowerShell:

   ```powershell
   $env:ADMIN_KEY="use-a-long-random-production-key"
   npm start
   ```

   Windows Command Prompt:

   ```cmd
   set ADMIN_KEY=use-a-long-random-production-key
   npm start
   ```

5. From the host computer, open:

   ```text
   http://localhost:3000/dashboard.html
   ```

6. From another device on the same network, use the host computer's LAN IP:

   ```text
   http://192.168.1.50:3000/player.html?id=alan&token=PLAYER_TOKEN
   ```

Allow inbound TCP port 3000 through the host firewall if required.

## Important URLs

Player page:

```text
/player.html?id=PLAYER_ID&token=PLAYER_TOKEN
```

Production dashboard:

```text
/dashboard.html
```

Status-aware multiview mockup:

```text
/multiview.html
```

Transparent lower-third/browser overlay:

```text
/overlay.html?id=PLAYER_ID
```

Hide player status on the overlay:

```text
/overlay.html?id=PLAYER_ID&status=0
```

Health check:

```text
/health
```

## Event-day behavior

- Selecting a different game automatically clears a stale player status.
- `Interesting Soon`, `Please Show Me ASAP`, and `Downtime` expire based on `config.json`.
- The production dashboard can manually put a player into `Stand By`, `Live`, or `Off Air`.
- The player page receives those changes immediately.
- State persists in `data/state.json` across server restarts.

## Local versus internet deployment

The application listens on `0.0.0.0`, so it works on a local network by default. The same application can later be deployed behind HTTPS on a conventional Node.js host.

Before exposing it to the internet:

- Set a strong `ADMIN_KEY`.
- Use long random player tokens.
- Put the server behind HTTPS.
- Add rate limiting.
- Add proper production-user accounts or single sign-on.
- Restrict administrative routes and WebSocket events.
- Consider Redis if running multiple server instances.
- Store secrets outside `config.json`.

## Switcher integration

The starter version uses manual production buttons because the exact switcher is not yet known. The primary switcher integration point is the `admin.player.air` WebSocket command.

A switcher adapter can translate program/preview events from OBS, vMix, an ATEM control bridge, or another automation system into:

an authenticated WebSocket command that updates:

- `off`
- `standby`
- `live`

The player-facing interface does not need to change.

## Recommended next steps

1. Replace sample players and games with the real event roster.
2. Test the player workflow with two or three computers.
3. Decide whether game selection should use a dropdown or large game buttons.
4. Identify the production switcher and automate preview/program feedback.
5. Determine how the real video multiview is generated and layer the status metadata into it.
6. Add Archipelago event ingestion after the manual workflow is proven.


## Compact 640×360 Production Status Window

Open `/compact.html`. The default `priority` mode shows only `Please Show Me ASAP` and `Interesting Soon`. If there are no active requests, it displays `NO CALLS`.

The compact view shows up to five large rows. If more than five players match, it displays `+N MORE` instead of shrinking the text.

Production can switch modes from the full dashboard or over an authenticated plain WebSocket connection:

```json
{"type":"admin.compact.mode","data":{"mode":"priority"}}
{"type":"admin.compact.mode","data":{"mode":"normal"}}
{"type":"admin.compact.mode","data":{"mode":"bk"}}
{"type":"admin.compact.mode","data":{"mode":"all"}}
```

Aliases: `calls -> priority`, `downtime -> bk`. BK currently maps to the existing downtime / No Progression status. If BK should be a distinct player state, add it to config rather than using the alias.

### Compact call monitor attention behavior

- A new `Interesting Soon` request flashes briefly when the compact display first sees that request, then becomes static.
- `Please Show Me ASAP` flashes continuously until that specific request is taken live.
- When production sets that player to `live`, the server records `asapTakenLiveAt`; the ASAP row stops flashing and is marked `LIVE`.
- Returning the player off-air does not restart the flash for the same request. A new ASAP button press creates a new request and starts flashing again.

## Read-only lower-third HTTP API

For graphics systems that prefer polling JSON instead of maintaining a WebSocket connection, v3.4 exposes a small read-only lower-third API. Responses use `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`.

### All players

```text
GET /api/lower-thirds
```

Example:

```json
{
  "eventName": "Archipelago Multiworld",
  "generatedAt": "2026-08-10T22:45:00.000Z",
  "players": {
    "alan": {
      "id": "alan",
      "name": "Alan",
      "game": "Super Metroid",
      "currentGame": "Super Metroid",
      "airState": "live",
      "live": true,
      "status": "asap",
      "connected": true
    }
  }
}
```

### One player

```text
GET /api/lower-thirds/PLAYER_ID
```

Example:

```text
GET /api/lower-thirds/alan
```

Response:

```json
{
  "eventName": "Archipelago Multiworld",
  "generatedAt": "2026-08-10T22:45:00.000Z",
  "player": {
    "id": "alan",
    "name": "Alan",
    "game": "Super Metroid",
    "currentGame": "Super Metroid",
    "airState": "live",
    "live": true,
    "status": "asap",
    "connected": true
  }
}
```

Unknown player IDs return HTTP 404 with:

```json
{ "ok": false, "error": "Unknown player." }
```

### Currently live player

```text
GET /api/lower-thirds/live
```

If a player is currently live, `player` contains that player's graphics data. If nobody is live, the response contains:

```json
{
  "eventName": "Archipelago Multiworld",
  "generatedAt": "2026-08-10T22:45:00.000Z",
  "player": null
}
```

### Field reference

- `id`: stable machine-readable player ID.
- `name`: display name for on-air graphics.
- `game`: short alias of `currentGame`, convenient for graphics systems.
- `currentGame`: game currently selected by the player.
- `airState`: `off`, `standby`, or `live`.
- `live`: boolean convenience field derived from `airState === "live"`.
- `status`: production status such as `normal`, `soon`, `asap`, or `downtime`.
- `connected`: whether the player's authenticated control page is currently connected.

No authentication is required because these endpoints are read-only and intentionally omit player tokens, admin credentials, timestamps related to production acknowledgements, and full configuration data.

## v3.4 admin WebSocket player-control commands

Version 3.4 expands the authenticated admin WebSocket API so production automation can change a player's game, production status, air state, or several fields atomically.

Authenticate first on the same WebSocket connection:

```json
{"type":"auth.admin","data":{"key":"YOUR_ADMIN_KEY"}}
```

### Set air state

```json
{"type":"admin.player.air","data":{"playerId":"alan","airState":"live"}}
```

Valid values: `off`, `standby`, `live`.

Taking a player live automatically takes any other live player off-air. If the player has an active ASAP request, taking them live acknowledges that request and stops its compact-monitor flashing.

### Set player status

```json
{"type":"admin.player.status","data":{"playerId":"alan","status":"asap"}}
```

Valid status values are the keys configured under `statuses` in `config.json` (normally `normal`, `soon`, `asap`, and `downtime`). Setting a status creates a fresh request and clears any prior ASAP-live acknowledgement.

### Set current game

```json
{"type":"admin.player.game","data":{"playerId":"alan","game":"Super Metroid"}}
```

The game must be assigned to that player in `config.json`. This intentionally mirrors the player's own game-selection behavior: changing games resets production status to `normal` and clears status timers and ASAP acknowledgement.

### Atomically update multiple player fields

```json
{
  "type":"admin.player.update",
  "data":{
    "playerId":"alan",
    "currentGame":"Celeste",
    "status":"soon",
    "airState":"standby"
  }
}
```

`currentGame`, `status`, and `airState` are all optional, but at least one must be supplied. The entire update is validated before any state is changed. If `currentGame` and `status` are both supplied, the game change resets the old status first, then the explicitly supplied status becomes the final status.

### Clear production status

```json
{"type":"admin.player.clear","data":{"playerId":"alan"}}
```

This resets the player to `normal` and clears status timers and ASAP acknowledgement without changing the current game or air state.

### Acknowledgements

All admin commands can include a `requestId` and return an `ack` message:

```json
{
  "type":"admin.player.status",
  "requestId":"companion-42",
  "data":{"playerId":"alan","status":"soon"}
}
```

Success:

```json
{"type":"ack","requestId":"companion-42","data":{"ok":true,"player":{}}}
```

Failure:

```json
{"type":"ack","requestId":"companion-42","data":{"ok":false,"error":"Unknown player."}}
```

Every successful player change is persisted and followed by a broadcast `state.snapshot`.
