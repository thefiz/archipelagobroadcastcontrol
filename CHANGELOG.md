# Changelog

## 0.3.6

- Add `package-lock.json` for reproducible installs.
- Update `ws` to 8.21.0.
- Add Node test suite covering credentials, state transitions, resets, persistence, and player re-authentication.
- Refuse startup when `ADMIN_KEY` is unset or left at the insecure default.
- Persist state using temporary-file + rename atomic writes with error handling.
- Roll back in-memory mutations if persistence fails.
- Fix stale player connection state when one WebSocket authenticates as a different player.
- Split the server into configuration, persistence, state, HTTP, connection, and WebSocket modules.
- Add GitHub Actions CI across Node 18, 20, and 22.

## 0.3.5

- Add dashboard health metadata and production recovery controls.
- Add per-player panic reset and event-state reset.
