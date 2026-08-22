import test from "node:test";
import assert from "node:assert/strict";
import { reassignPlayerConnection } from "../src/connections.js";

const OPEN = 1;

test("re-authenticating a socket as another player clears stale connection state", () => {
  const state = { players: { alice: { connected: true }, bob: { connected: false } } };
  const ws = { readyState: OPEN, meta: { playerId: "alice" } };
  const clients = new Set([ws]);
  reassignPlayerConnection({ ws, newPlayerId: "bob", clients, state, openState: OPEN });
  assert.equal(ws.meta.playerId, "bob");
  assert.equal(state.players.alice.connected, false);
  assert.equal(state.players.bob.connected, true);
});

test("re-auth leaves old player connected when another socket remains", () => {
  const state = { players: { alice: { connected: true }, bob: { connected: false } } };
  const ws = { readyState: OPEN, meta: { playerId: "alice" } };
  const other = { readyState: OPEN, meta: { playerId: "alice" } };
  const clients = new Set([ws, other]);
  reassignPlayerConnection({ ws, newPlayerId: "bob", clients, state, openState: OPEN });
  assert.equal(state.players.alice.connected, true);
  assert.equal(state.players.bob.connected, true);
});
