import test from "node:test";
import assert from "node:assert/strict";
import { createStateManager } from "../src/state.js";
import { createHttpServer } from "../src/http.js";

const config = {
  eventName: "Test Event",
  statuses: {
    normal: { label: "Normal", priority: 0, expiresSeconds: 0 },
    soon: { label: "Soon", priority: 2, expiresSeconds: 120 },
    asap: { label: "ASAP", priority: 3, expiresSeconds: 60 },
    downtime: { label: "Downtime", priority: -1, expiresSeconds: 600 }
  },
  players: [{ id: "john", name: "John", token: "john-token", games: ["Game A"], startingGame: "Game A" }]
};

async function withServer({ onPersist = () => {}, onStateChanged = () => {} } = {}, fn) {
  const stateManager = createStateManager({ config: structuredClone(config), persistedState: null, onPersist });
  const server = createHttpServer({
    publicDir: new URL("../public", import.meta.url).pathname,
    stateManager,
    snapshot: () => ({ players: [] }),
    appVersion: "test",
    wsPath: "/ws",
    onStateChanged
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try { await fn({ stateManager, baseUrl: `http://127.0.0.1:${port}` }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("player HTTP status endpoint accepts a valid bearer token", async () => {
  let broadcasts = 0;
  await withServer({ onStateChanged: () => broadcasts++ }, async ({ stateManager, baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/player/status`, {
      method: "POST",
      headers: { "Authorization": "Bearer john-token", "Content-Type": "application/json" },
      body: JSON.stringify({ status: "asap" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.player.id, "john");
    assert.equal(body.player.status, "asap");
    assert.equal(stateManager.state.players.john.status, "asap");
    assert.equal(broadcasts, 1);
  });
});

test("player HTTP status endpoint rejects invalid tokens and statuses", async () => {
  await withServer({}, async ({ stateManager, baseUrl }) => {
    const unauthorized = await fetch(`${baseUrl}/api/player/status`, {
      method: "POST",
      headers: { "Authorization": "Bearer wrong-token", "Content-Type": "application/json" },
      body: JSON.stringify({ status: "asap" })
    });
    assert.equal(unauthorized.status, 401);

    const invalidStatus = await fetch(`${baseUrl}/api/player/status`, {
      method: "POST",
      headers: { "Authorization": "Bearer john-token", "Content-Type": "application/json" },
      body: JSON.stringify({ status: "not-real" })
    });
    assert.equal(invalidStatus.status, 400);
    assert.equal(stateManager.state.players.john.status, "normal");
  });
});

test("player HTTP status endpoint rolls back if persistence fails", async () => {
  await withServer({ onPersist: () => { throw new Error("disk full"); } }, async ({ stateManager, baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/player/status`, {
      method: "POST",
      headers: { "Authorization": "Bearer john-token", "Content-Type": "application/json" },
      body: JSON.stringify({ status: "soon" })
    });
    assert.equal(response.status, 500);
    assert.equal(stateManager.state.players.john.status, "normal");
  });
});
