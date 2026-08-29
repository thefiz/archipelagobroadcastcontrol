import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, requireSecureAdminKey } from "./src/config.js";
import { readPersistedState, writeJsonAtomic } from "./src/persistence.js";
import { createStateManager } from "./src/state.js";
import { createHttpServer } from "./src/http.js";
import { attachWebSocket } from "./src/websocket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname,"config.json");
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname,"data","state.json");
const PUBLIC_DIR = path.join(__dirname,"public");
const WS_PATH = "/ws";
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const APP_VERSION = packageJson.version;
const STARTED_AT = new Date();

let adminKey;
let config;
try {
  adminKey = requireSecureAdminKey(process.env.ADMIN_KEY);
  config = loadConfig(CONFIG_PATH);
} catch (error) {
  console.error(`Startup error: ${error.message}`);
  process.exit(1);
}

const initialPersisted = readPersistedState(STATE_PATH,null);
const stateManager = createStateManager({
  config,
  persistedState: initialPersisted,
  runtimeDefaults: {
    rotationSeconds: Math.max(10, Number(process.env.UNATTENDED_ROTATION_SECONDS || 300)),
    asapOverrideSeconds: Math.max(10, Number(process.env.UNATTENDED_ASAP_SECONDS || 180)),
    fallbackRotationSeconds: Math.max(10, Number(process.env.UNATTENDED_FALLBACK_SECONDS || 120)),
    fallbackTargets: ["fallback-1", "fallback-2"]
  },
  onPersist: (safeState) => writeJsonAtomic(STATE_PATH,safeState)
});
if (fs.existsSync(STATE_PATH)) stateManager.setLastPersistAt(fs.statSync(STATE_PATH).mtime.toISOString());

let websocketApi;
function systemStatus() {
  const players=Object.values(stateManager.state.players);
  const live=players.find((p)=>p.airState === "live");
  return {
    version:APP_VERSION, startedAt:STARTED_AT.toISOString(), uptimeSeconds:Math.floor(process.uptime()),
    configuredPlayers:players.length, connectedPlayers:players.filter((p)=>p.connected).length,
    websocketClients:websocketApi?.wss?.clients?.size ?? 0,
    currentLivePlayerId:live?.id || null, currentLivePlayerName:live?.name || null,
    compactMode:stateManager.state.compactMode,
    unattendedMode:stateManager.state.unattendedMode,
    unattendedTarget:stateManager.state.unattendedTarget || null,
    unattendedTargetReason:stateManager.state.unattendedTargetReason || null,
    eligibleRotationPlayers:players.filter((p)=>p.connected && p.rotationActive && (stateManager.state.runtimeSettings.rotationValidStatuses || []).includes(p.status)).length,
    lastPersistAt:stateManager.getLastPersistAt()
  };
}
function snapshot() {
  return {
    eventName:stateManager.state.eventName,
    generatedAt:new Date().toISOString(),
    compactMode:stateManager.state.compactMode,
    unattendedMode:stateManager.state.unattendedMode,
    unattendedTarget:stateManager.state.unattendedTarget || null,
    unattendedTargetReason:stateManager.state.unattendedTargetReason || null,
    runtimeSettings:stateManager.runtimeSettingsSnapshot(),
    system:systemStatus(),
    players:Object.keys(stateManager.state.players).map(stateManager.safePlayerState)
  };
}

const server=createHttpServer({
  publicDir:PUBLIC_DIR, stateManager, snapshot, appVersion:APP_VERSION, wsPath:WS_PATH, adminKey,
  onStateChanged: () => websocketApi?.broadcastSnapshot()
});
websocketApi=attachWebSocket({server,wsPath:WS_PATH,stateManager,adminKey,snapshot});


let rotationIndex = -1;
let rotationTargetSince = 0;
let fallbackIndex = -1;
let fallbackTargetSince = 0;
let asapOverride = null;
let lastAsapStamp = "";

function setUnattendedTarget(playerId, reason) {
  const nextTarget = playerId || "fallback";
  if (
    stateManager.state.unattendedTarget === nextTarget &&
    stateManager.state.unattendedTargetReason === reason
  ) return false;

  stateManager.state.unattendedTarget = nextTarget;
  stateManager.state.unattendedTargetReason = reason;
  websocketApi.broadcastSnapshot();
  return true;
}

function updateUnattendedTarget(now = Date.now()) {
  if (!stateManager.state.unattendedMode) {
    if (stateManager.state.unattendedTarget || stateManager.state.unattendedTargetReason) {
      stateManager.state.unattendedTarget = "";
      stateManager.state.unattendedTargetReason = "";
      websocketApi.broadcastSnapshot();
    }
    asapOverride = null;
    lastAsapStamp = "";
    rotationTargetSince = 0;
    fallbackIndex = -1;
    fallbackTargetSince = 0;
    return;
  }

  const players = Object.values(stateManager.state.players);

  const newestAsap = players
    .filter((player) => player.connected && player.status === "asap" && player.statusSetAt)
    .sort((a, b) => Date.parse(b.statusSetAt) - Date.parse(a.statusSetAt))[0];

  if (newestAsap && newestAsap.statusSetAt !== lastAsapStamp) {
    lastAsapStamp = newestAsap.statusSetAt;
    asapOverride = {
      playerId: newestAsap.id,
      startedAt: now,
      expiresAt: now + stateManager.state.runtimeSettings.asapOverrideSeconds * 1000
    };
  }

  if (asapOverride && now < asapOverride.startedAt + stateManager.state.runtimeSettings.asapOverrideSeconds * 1000) {
    return setUnattendedTarget(asapOverride.playerId, "asap");
  }
  asapOverride = null;

  const eligible = players.filter((player) => player.connected && player.rotationActive && (stateManager.state.runtimeSettings.rotationValidStatuses || []).includes(player.status));
  if (!eligible.length) {
    rotationIndex = -1;
    rotationTargetSince = 0;

    const fallbackTargets = stateManager.state.runtimeSettings.fallbackTargets || [];
    if (!fallbackTargets.length) {
      fallbackIndex = -1;
      fallbackTargetSince = now;
      return setUnattendedTarget("fallback", "fallback");
    }

    const currentTarget = stateManager.state.unattendedTarget;
    const currentIndex = fallbackTargets.indexOf(currentTarget);
    const currentStillFallback = currentIndex >= 0 && stateManager.state.unattendedTargetReason === "fallback";

    if (!currentStillFallback || !fallbackTargetSince) {
      fallbackIndex = currentIndex >= 0 ? currentIndex : (fallbackIndex + 1) % fallbackTargets.length;
      if (fallbackIndex < 0 || fallbackIndex >= fallbackTargets.length) fallbackIndex = 0;
      fallbackTargetSince = now;
      return setUnattendedTarget(fallbackTargets[fallbackIndex], "fallback");
    }

    if (now - fallbackTargetSince >= stateManager.state.runtimeSettings.fallbackRotationSeconds * 1000) {
      fallbackIndex = (currentIndex + 1) % fallbackTargets.length;
      fallbackTargetSince = now;
      return setUnattendedTarget(fallbackTargets[fallbackIndex], "fallback");
    }
    return;
  }

  fallbackIndex = -1;
  fallbackTargetSince = 0;

  const currentTarget = stateManager.state.unattendedTarget;
  const currentIndex = eligible.findIndex((player) => player.id === currentTarget);
  const currentStillEligible = currentIndex >= 0 && stateManager.state.unattendedTargetReason === "rotation";

  if (!currentStillEligible || !rotationTargetSince) {
    rotationIndex = currentIndex >= 0 ? currentIndex : (rotationIndex + 1) % eligible.length;
    if (rotationIndex < 0 || rotationIndex >= eligible.length) rotationIndex = 0;
    rotationTargetSince = now;
    return setUnattendedTarget(eligible[rotationIndex].id, "rotation");
  }

  if (now - rotationTargetSince >= stateManager.state.runtimeSettings.rotationSeconds * 1000) {
    rotationIndex = (currentIndex + 1) % eligible.length;
    rotationTargetSince = now;
    return setUnattendedTarget(eligible[rotationIndex].id, "rotation");
  }
}

setInterval(() => updateUnattendedTarget(), 1000);

setInterval(()=>{
  if(stateManager.expireStatuses()) {
    try { stateManager.persist(); websocketApi.broadcastSnapshot(); }
    catch(error) { console.error(error.message); }
  }
},1000);

server.on("error",(error)=>console.error(`Server error: ${error.message}`));

server.listen(PORT,HOST,()=>{
  console.log(`Archipelago Broadcast Control v${APP_VERSION} running at http://${HOST}:${PORT}`);
  console.log(`Plain WebSocket endpoint: ws://${HOST}:${PORT}${WS_PATH}`);
});
