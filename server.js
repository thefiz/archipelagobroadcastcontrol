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
    compactMode:stateManager.state.compactMode, lastPersistAt:stateManager.getLastPersistAt()
  };
}
function snapshot() {
  return {
    eventName:stateManager.state.eventName, generatedAt:new Date().toISOString(), compactMode:stateManager.state.compactMode,
    system:systemStatus(), players:Object.keys(stateManager.state.players).map(stateManager.safePlayerState)
  };
}

const server=createHttpServer({publicDir:PUBLIC_DIR,stateManager,snapshot,appVersion:APP_VERSION,wsPath:WS_PATH});
websocketApi=attachWebSocket({server,wsPath:WS_PATH,stateManager,adminKey,snapshot});

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
