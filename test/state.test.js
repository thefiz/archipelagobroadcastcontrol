import test from "node:test";
import assert from "node:assert/strict";
import { createStateManager } from "../src/state.js";
const testConfig = {
  eventName: "Test Event",
  statuses: {
    normal: { label: "Normal", priority: 0, expiresSeconds: 0 },
    soon: { label: "Soon", priority: 2, expiresSeconds: 120 },
    asap: { label: "ASAP", priority: 3, expiresSeconds: 60 },
    downtime: { label: "Downtime", priority: -1, expiresSeconds: 600 }
  },
  players: [
    { id: "alice", name: "Alice", token: "alice-token", games: ["Game A", "Game B"], startingGame: "Game A" },
    { id: "bob", name: "Bob", token: "bob-token", games: ["Game C"], startingGame: "Game C" }
  ]
};

function manager() {
  const writes = [];
  const m = createStateManager({ config: structuredClone(testConfig), persistedState: null, onPersist: (value) => writes.push(value) });
  return { m, writes };
}

test("game changes reset stale production status", () => {
  const { m } = manager();
  m.setPlayerStatus("alice", "asap");
  assert.equal(m.state.players.alice.status, "asap");
  assert.equal(m.setPlayerGame("alice", "Game B").ok, true);
  assert.equal(m.state.players.alice.currentGame, "Game B");
  assert.equal(m.state.players.alice.status, "normal");
  assert.equal(m.state.players.alice.asapTakenLiveAt, null);
});

test("only one player can be live", () => {
  const { m } = manager();
  m.setPlayerAirState("alice", "live");
  m.setPlayerAirState("bob", "live");
  assert.equal(m.state.players.alice.airState, "off");
  assert.equal(m.state.players.bob.airState, "live");
});

test("taking an ASAP player live acknowledges that request", () => {
  const { m } = manager();
  m.setPlayerStatus("alice", "asap");
  assert.equal(m.state.players.alice.asapTakenLiveAt, null);
  m.setPlayerAirState("alice", "live");
  assert.ok(m.state.players.alice.asapTakenLiveAt);
});

test("atomic update validates all fields before mutation", () => {
  const { m } = manager();
  const before = structuredClone(m.state.players.alice);
  const result = m.updatePlayer("alice", { currentGame: "Game B", status: "not-real" });
  assert.equal(result.ok, false);
  assert.deepEqual(m.state.players.alice, before);
});

test("panic reset preserves current game", () => {
  const { m } = manager();
  m.setPlayerGame("alice", "Game B");
  m.setPlayerStatus("alice", "asap");
  m.setPlayerAirState("alice", "live");
  m.panicResetPlayer("alice");
  assert.equal(m.state.players.alice.currentGame, "Game B");
  assert.equal(m.state.players.alice.status, "normal");
  assert.equal(m.state.players.alice.airState, "off");
});

test("event reset preserves games and returns compact mode to priority", () => {
  const { m } = manager();
  m.setPlayerGame("alice", "Game B");
  m.state.compactMode = "all";
  m.setPlayerStatus("alice", "soon");
  m.setPlayerAirState("alice", "live");
  m.resetEventState();
  assert.equal(m.state.players.alice.currentGame, "Game B");
  assert.equal(m.state.players.alice.status, "normal");
  assert.equal(m.state.players.alice.airState, "off");
  assert.equal(m.state.compactMode, "priority");
});

test("persisted state always records players as disconnected", () => {
  const { m, writes } = manager();
  m.state.players.alice.connected = true;
  m.persist();
  assert.equal(writes.at(-1).players.alice.connected, false);
  assert.equal(m.state.players.alice.connected, true);
});
