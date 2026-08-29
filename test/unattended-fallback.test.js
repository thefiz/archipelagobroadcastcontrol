import test from "node:test";
import assert from "node:assert/strict";
import { createStateManager } from "../src/state.js";

function config() {
  return {
    eventName:"Test",
    statuses:{
      normal:{label:"Normal",priority:0,expiresSeconds:0},
      soon:{label:"Soon",priority:2,expiresSeconds:120},
      asap:{label:"ASAP",priority:3,expiresSeconds:60},
      downtime:{label:"Down",priority:-1,expiresSeconds:600}
    },
    players:[{id:"andy",name:"Andy",token:"x",games:["Game"],startingGame:"Game"}]
  };
}

test("runtime fallback settings default and validate", () => {
  const manager = createStateManager({config:config(),persistedState:null,onPersist:()=>{}});
  const defaults = manager.runtimeSettingsSnapshot();
  assert.equal(defaults.fallbackRotationSeconds,120);
  assert.deepEqual(defaults.fallbackTargets,["fallback-1","fallback-2"]);

  assert.deepEqual(manager.updateRuntimeSettings({
    fallbackRotationSeconds:45,
    fallbackTargets:["room-cam","wide_cam"]
  }), {ok:true});

  const updated = manager.runtimeSettingsSnapshot();
  assert.equal(updated.fallbackRotationSeconds,45);
  assert.deepEqual(updated.fallbackTargets,["room-cam","wide_cam"]);
});

test("runtime fallback settings reject duplicate and invalid target ids", () => {
  const manager = createStateManager({config:config(),persistedState:null,onPersist:()=>{}});
  assert.equal(manager.updateRuntimeSettings({fallbackTargets:["room","room"]}).ok,false);
  assert.equal(manager.updateRuntimeSettings({fallbackTargets:["bad target"]}).ok,false);
});
