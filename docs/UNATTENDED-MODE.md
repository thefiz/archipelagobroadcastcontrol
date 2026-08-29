# Unattended Mode Prototype

This is an experimental branch feature and is not part of the locked main v0.3.7 release.

## Player participation

Players default to being opted into the overnight rotation and can join or leave it from `player.html`.
Production can override the same `rotationActive` state from the dashboard.

A player is eligible for the normal rotation only when:

- `rotationActive` is true
- their player page is connected

## Rotation

When unattended mode is enabled, the server exposes an `unattendedTarget` for Companion.

Default timings:

- normal rotation: 300 seconds
- ASAP override: 180 seconds

Environment overrides:

- `UNATTENDED_ROTATION_SECONDS`
- `UNATTENDED_ASAP_SECONDS`

If no eligible player exists, `unattendedTarget` becomes `fallback`.

A newly received ASAP request immediately becomes the target, even if that player is not opted into the normal rotation. The newest ASAP wins. After the override period expires, normal rotation resumes.

The server only chooses the target. Companion remains responsible for actually switching video/scene routing.

## WebSocket commands

Player:

```json
{"type":"player.rotation","data":{"enabled":true}}
```

Admin:

```json
{"type":"admin.player.rotation","data":{"playerId":"andy","enabled":true}}
```

```json
{"type":"admin.unattended.mode","data":{"enabled":true}}
```

## HTTP

Read state:

`GET /api/unattended`

Set unattended mode:

`POST /api/admin/unattended`

Header:

`Authorization: Bearer ADMIN_KEY`

Body:

```json
{"enabled":true}
```

## Companion flat fields

Global:

- `unattendedMode`
- `unattendedTarget`
- `unattendedTargetReason`

Per player:

- `<playerId>_rotationActive`
- `<playerId>_live`

Suggested Companion logic:

- when `unattendedTarget == andy`, run Andy routing workflow
- when `unattendedTarget == fallback`, switch to the room camera


## Runtime configuration page

`/config.html` is linked from the production dashboard and requires the production admin key.

Runtime-editable and persisted settings:

- unattended rotation duration
- ASAP override duration
- each status display label
- each status timeout

The backend status keys remain `normal`, `soon`, `asap`, and `downtime`. Renaming a label does not change API/Companion status values. Timer changes apply immediately, including calls/rotations already in progress.

Protected API:

- `GET /api/admin/runtime-config`
- `POST /api/admin/runtime-config`

Both require `Authorization: Bearer ADMIN_KEY`.


## Configurable fallback rotation

When no normal rotation players are eligible, the server cycles through the configured fallback target IDs.

The defaults are:

- `fallback-1`
- `fallback-2`

The fallback scene duration defaults to 120 seconds.

Both the fallback duration and target list are editable at `/config.html` and persist as runtime settings. Companion should map each logical fallback ID to an OBS scene.

If the fallback target list is empty, the server emits the legacy target `fallback`.

Companion flat fields include:

- `fallbackRotationSeconds`
- `fallbackTargetCount`

## Rotation status eligibility

A player is eligible only when connected, `rotationActive` is true, and their backend status is selected in `rotationValidStatuses`. Defaults are all configured statuses except `downtime`. This is editable on `/config.html`.
