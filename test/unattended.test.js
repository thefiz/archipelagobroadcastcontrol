import test from "node:test";
import assert from "node:assert/strict";
import { createStateManager } from "../src/state.js";

function config() {
  return {
    eventName: "Test",
    statuses: {
      normal: { label:"Normal", priority:0, expiresSeconds:0 },
      soon: { label:"Soon", priority:2, expiresSeconds:120 },
      asap: { label:"ASAP", priority:3, expiresSeconds:60 },
      downtime: { label:"Down", priority:-1, expiresSeconds:600 }
    },
    players: [{ id:"andy", name:"Andy", token:"x", games:["Game"], startingGame:"Game" }]
  };
}

test("unattended mode defaults off and player rotation can be toggled", () => {
  const manager = createStateManager({ config: config(), persistedState: null, onPersist: () => {} });
  assert.equal(manager.state.unattendedMode, false);
  assert.equal(manager.state.players.andy.rotationActive, true);
  assert.deepEqual(manager.setPlayerRotationActive("andy", true), { ok:true });
  assert.equal(manager.state.players.andy.rotationActive, true);
  assert.deepEqual(manager.setUnattendedMode(true), { ok:true });
  assert.equal(manager.state.unattendedMode, true);
});

test("unattended mode is forced off after restart while rotation opt-in persists", () => {
  const persistedState = {
    eventName:"Test",
    compactMode:"priority",
    unattendedMode:true,
    unattendedTarget:"andy",
    players:{
      andy:{
        currentGame:"Game",status:"normal",airState:"off",
        rotationActive:true
      }
    }
  };
  const manager = createStateManager({ config: config(), persistedState, onPersist: () => {} });
  assert.equal(manager.state.unattendedMode, false);
  assert.equal(manager.state.unattendedTarget, "");
  assert.equal(manager.state.players.andy.rotationActive, true);
});
