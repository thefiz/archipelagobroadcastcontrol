import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("WebSocket messages expose flat global Companion fields", () => {
  const source = fs.readFileSync(new URL("../src/websocket.js", import.meta.url), "utf8");
  assert.match(source, /compactMode:\s*state\.compactMode/);
  assert.match(source, /currentLivePlayerId:\s*state\.system\?\.currentLivePlayerId/);
  assert.match(source, /currentLivePlayerName:\s*state\.system\?\.currentLivePlayerName/);
});
