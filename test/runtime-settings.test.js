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

test("runtime settings change labels and future status timeout behavior", () => {
  const manager=createStateManager({config:config(),persistedState:null,onPersist:()=>{},runtimeDefaults:{rotationSeconds:300,asapOverrideSeconds:180}});
  assert.deepEqual(manager.updateRuntimeSettings({rotationSeconds:90,asapOverrideSeconds:45,statuses:{asap:{label:"Show Me Now",expiresSeconds:30}}}),{ok:true});
  assert.equal(manager.state.runtimeSettings.rotationSeconds,90);
  assert.equal(manager.effectiveStatusDefinition("asap").label,"Show Me Now");
  manager.setPlayerStatus("andy","asap");
  assert.equal(Date.parse(manager.state.players.andy.statusExpiresAt)-Date.parse(manager.state.players.andy.statusSetAt),30000);
  assert.equal(manager.safePlayerState("andy").statusDefinition.label,"Show Me Now");
});

test("runtime timeout changes are applied to active calls", () => {
  const manager=createStateManager({config:config(),persistedState:null,onPersist:()=>{}});
  manager.setPlayerStatus("andy","soon");
  const started=manager.state.players.andy.statusSetAt;
  manager.updateRuntimeSettings({statuses:{soon:{expiresSeconds:15}}});
  assert.equal(Date.parse(manager.state.players.andy.statusExpiresAt)-Date.parse(started),15000);
});

test("persisted runtime settings are restored", () => {
  const first=createStateManager({config:config(),persistedState:null,onPersist:()=>{}});
  first.updateRuntimeSettings({rotationSeconds:42,statuses:{soon:{label:"Soon-ish"}}});
  const second=createStateManager({config:config(),persistedState:structuredClone(first.state),onPersist:()=>{}});
  assert.equal(second.state.runtimeSettings.rotationSeconds,42);
  assert.equal(second.effectiveStatusDefinition("soon").label,"Soon-ish");
});
