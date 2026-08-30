import test from "node:test";
import assert from "node:assert/strict";
import { createStateManager } from "../src/state.js";
const config={eventName:"T",statuses:{normal:{label:"Normal",priority:0,expiresSeconds:0}},players:[{id:"andy",name:"Andy",token:"x",games:["G"],startingGame:"G"},{id:"bird",name:"Bird",token:"y",games:["G"],startingGame:"G"}]};
test("focus is mutually exclusive and clearable",()=>{const m=createStateManager({config,persistedState:null,onPersist:()=>{}});assert.equal(m.state.unattendedFocusPlayerId,null);assert.deepEqual(m.setUnattendedFocus("andy"),{ok:true});assert.equal(m.state.unattendedFocusPlayerId,"andy");m.setUnattendedFocus("bird");assert.equal(m.state.unattendedFocusPlayerId,"bird");m.setUnattendedFocus(null);assert.equal(m.state.unattendedFocusPlayerId,null);});
test("focus is not restored from persisted state",()=>{const persisted={compactMode:"priority",unattendedFocusPlayerId:"andy",players:{},runtimeSettings:null};const m=createStateManager({config,persistedState:persisted,onPersist:()=>{}});assert.equal(m.state.unattendedFocusPlayerId,null);});
test("unknown focus player rejected",()=>{const m=createStateManager({config,persistedState:null,onPersist:()=>{}});assert.equal(m.setUnattendedFocus("nope").ok,false);});
