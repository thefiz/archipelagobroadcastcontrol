import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY || "change-me-before-the-event";
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "config.json");
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname, "data", "state.json");
const WS_PATH = "/ws";

function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Missing config.json. Copy config.example.json to config.json and edit it.");
  process.exit(1);
}

const config = loadJson(CONFIG_PATH);
const playerDefinitions = new Map(config.players.map((player) => [player.id, player]));

function initialState() {
  const players = {};
  for (const player of config.players) {
    players[player.id] = {
      id: player.id,
      name: player.name,
      currentGame: player.startingGame || player.games[0] || "",
      status: "normal",
      statusSetAt: null,
      statusExpiresAt: null,
      asapTakenLiveAt: null,
      airState: "off",
      updatedAt: new Date().toISOString(),
      connected: false
    };
  }
  return { eventName: config.eventName, compactMode: "priority", players };
}

const persisted = loadJson(STATE_PATH, initialState());
const state = initialState();
state.compactMode = ["priority", "normal", "bk", "all"].includes(persisted.compactMode)
  ? persisted.compactMode
  : "priority";

for (const [playerId, playerState] of Object.entries(persisted.players || {})) {
  if (!state.players[playerId]) continue;
  state.players[playerId] = {
    ...state.players[playerId],
    currentGame: playerState.currentGame || state.players[playerId].currentGame,
    status: config.statuses[playerState.status] ? playerState.status : "normal",
    statusSetAt: playerState.statusSetAt || null,
    statusExpiresAt: playerState.statusExpiresAt || null,
    asapTakenLiveAt: playerState.asapTakenLiveAt || null,
    airState: ["off", "standby", "live"].includes(playerState.airState) ? playerState.airState : "off",
    connected: false
  };
}

function persistState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const safeState = structuredClone(state);
  for (const player of Object.values(safeState.players)) player.connected = false;
  fs.writeFileSync(STATE_PATH, JSON.stringify(safeState, null, 2));
}

function publicConfig() {
  return {
    eventName: config.eventName,
    statuses: config.statuses,
    players: config.players.map(({ token, ...player }) => player)
  };
}

function safePlayerState(playerId) {
  const player = state.players[playerId];
  const definition = playerDefinitions.get(playerId);
  return {
    ...player,
    games: definition.games,
    statusDefinition: config.statuses[player.status]
  };
}

function snapshot() {
  return {
    eventName: state.eventName,
    generatedAt: new Date().toISOString(),
    compactMode: state.compactMode,
    players: Object.keys(state.players).map(safePlayerState)
  };
}

function lowerThirdPlayer(playerId) {
  const player = state.players[playerId];
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    game: player.currentGame,
    currentGame: player.currentGame,
    airState: player.airState,
    live: player.airState === "live",
    status: player.status,
    connected: player.connected
  };
}

function lowerThirdSnapshot() {
  const players = {};
  for (const playerId of Object.keys(state.players)) {
    players[playerId] = lowerThirdPlayer(playerId);
  }
  return {
    eventName: state.eventName,
    generatedAt: new Date().toISOString(),
    players
  };
}

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authenticatePlayer(playerId, token) {
  const definition = playerDefinitions.get(playerId);
  return Boolean(definition && safeCompare(token, definition.token));
}

function authenticateAdmin(key) {
  return safeCompare(key, ADMIN_KEY);
}

function setPlayerGame(playerId, game) {
  const player = state.players[playerId];
  const definition = playerDefinitions.get(playerId);
  if (!player) return { ok: false, error: "Unknown player." };
  if (!definition.games.includes(game)) {
    return { ok: false, error: "That game is not assigned to this player." };
  }

  player.currentGame = game;
  // A game switch starts a fresh production context, matching player.game behavior.
  player.status = "normal";
  player.statusSetAt = null;
  player.statusExpiresAt = null;
  player.asapTakenLiveAt = null;
  player.updatedAt = new Date().toISOString();
  return { ok: true };
}

function setPlayerStatus(playerId, status) {
  const player = state.players[playerId];
  const definition = config.statuses[status];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!definition) return { ok: false, error: "Unknown status." };

  const now = Date.now();
  player.status = status;
  player.asapTakenLiveAt = null;
  player.statusSetAt = status === "normal" ? null : new Date(now).toISOString();
  player.statusExpiresAt = definition.expiresSeconds > 0
    ? new Date(now + definition.expiresSeconds * 1000).toISOString()
    : null;
  player.updatedAt = new Date().toISOString();
  return { ok: true };
}

function setPlayerAirState(playerId, airState) {
  const player = state.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!["off", "standby", "live"].includes(airState)) {
    return { ok: false, error: "Unknown air state." };
  }

  if (airState === "live") {
    for (const otherPlayer of Object.values(state.players)) {
      if (otherPlayer.id !== playerId && otherPlayer.airState === "live") {
        otherPlayer.airState = "off";
        otherPlayer.updatedAt = new Date().toISOString();
      }
    }
  }

  player.airState = airState;
  if (airState === "live" && player.status === "asap") {
    player.asapTakenLiveAt = new Date().toISOString();
  }
  player.updatedAt = new Date().toISOString();
  return { ok: true };
}

function clearPlayerStatus(playerId) {
  const player = state.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  player.status = "normal";
  player.statusSetAt = null;
  player.statusExpiresAt = null;
  player.asapTakenLiveAt = null;
  player.updatedAt = new Date().toISOString();
  return { ok: true };
}

function updatePlayer(playerId, updates) {
  const player = state.players[playerId];
  const definition = playerDefinitions.get(playerId);
  if (!player) return { ok: false, error: "Unknown player." };
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return { ok: false, error: "Updates must be a JSON object." };
  }

  const allowed = new Set(["currentGame", "status", "airState"]);
  const fields = Object.keys(updates);
  const unknown = fields.filter((field) => !allowed.has(field));
  if (unknown.length) return { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` };
  if (!fields.length) return { ok: false, error: "Supply at least one of currentGame, status, or airState." };

  // Validate the entire update before changing anything, so this command is atomic.
  if (Object.hasOwn(updates, "currentGame") && !definition.games.includes(updates.currentGame)) {
    return { ok: false, error: "That game is not assigned to this player." };
  }
  if (Object.hasOwn(updates, "status") && !config.statuses[updates.status]) {
    return { ok: false, error: "Unknown status." };
  }
  if (Object.hasOwn(updates, "airState") && !["off", "standby", "live"].includes(updates.airState)) {
    return { ok: false, error: "Unknown air state." };
  }

  // Apply in a deterministic order. A game change resets status first; an explicitly
  // supplied status then becomes the final status for this atomic update.
  if (Object.hasOwn(updates, "currentGame")) setPlayerGame(playerId, updates.currentGame);
  if (Object.hasOwn(updates, "status")) setPlayerStatus(playerId, updates.status);
  if (Object.hasOwn(updates, "airState")) setPlayerAirState(playerId, updates.airState);
  return { ok: true };
}

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, data, { cors = false, head = false } = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (cors) headers["Access-Control-Allow-Origin"] = "*";
  res.writeHead(statusCode, headers);
  res.end(head ? undefined : JSON.stringify(data));
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(resolved, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = MIME_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const pathname = new URL(req.url, "http://localhost").pathname;
  const isHead = req.method === "HEAD";
  if (pathname === "/api/config") return sendJson(res, 200, publicConfig(), { head: isHead });
  if (pathname === "/api/state") return sendJson(res, 200, snapshot(), { head: isHead });

  if (pathname === "/api/lower-thirds") {
    return sendJson(res, 200, lowerThirdSnapshot(), { cors: true, head: isHead });
  }

  if (pathname === "/api/lower-thirds/live") {
    const livePlayer = Object.values(state.players).find((player) => player.airState === "live");
    return sendJson(
      res,
      200,
      {
        eventName: state.eventName,
        generatedAt: new Date().toISOString(),
        player: livePlayer ? lowerThirdPlayer(livePlayer.id) : null
      },
      { cors: true, head: isHead }
    );
  }

  const lowerThirdMatch = pathname.match(/^\/api\/lower-thirds\/([^/]+)$/);
  if (lowerThirdMatch) {
    const playerId = decodeURIComponent(lowerThirdMatch[1]);
    const player = lowerThirdPlayer(playerId);
    if (!player) {
      return sendJson(res, 404, { ok: false, error: "Unknown player." }, { cors: true, head: isHead });
    }
    return sendJson(
      res,
      200,
      {
        eventName: state.eventName,
        generatedAt: new Date().toISOString(),
        player
      },
      { cors: true, head: isHead }
    );
  }

  if (pathname === "/health") {
    return sendJson(
      res,
      200,
      { ok: true, players: Object.keys(state.players).length, websocketPath: WS_PATH },
      { head: isHead }
    );
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: WS_PATH });

function send(ws, type, data = {}, requestId = undefined) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const message = { type, data };
  if (requestId !== undefined) message.requestId = requestId;
  ws.send(JSON.stringify(message));
}

function ack(ws, requestId, data = {}) {
  send(ws, "ack", { ok: true, ...data }, requestId);
}

function fail(ws, requestId, error) {
  send(ws, "ack", { ok: false, error }, requestId);
}

function broadcast(type, data = {}) {
  const payload = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function broadcastSnapshot() {
  broadcast("state.snapshot", snapshot());
}

function connectedPlayerSockets(playerId) {
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.meta?.playerId === playerId) count += 1;
  }
  return count;
}

function resolveCompactMode(mode) {
  const aliases = {
    priority: "priority",
    calls: "priority",
    normal: "normal",
    bk: "bk",
    downtime: "bk",
    all: "all"
  };
  return aliases[String(mode || "").toLowerCase()] || null;
}

function requirePlayer(ws, requestId) {
  if (!ws.meta?.playerId) {
    fail(ws, requestId, "Not authenticated as a player.");
    return null;
  }
  return ws.meta.playerId;
}

function requireAdmin(ws, requestId) {
  if (!ws.meta?.isAdmin) {
    fail(ws, requestId, "Not authenticated as production/admin.");
    return false;
  }
  return true;
}

function handleMessage(ws, message) {
  const type = message?.type;
  const data = message?.data || {};
  const requestId = message?.requestId;

  if (typeof type !== "string") return fail(ws, requestId, "Message requires a string 'type'.");

  switch (type) {
    case "auth.player": {
      const { playerId, token } = data;
      if (!authenticatePlayer(playerId, token)) return fail(ws, requestId, "Invalid player link.");
      ws.meta.playerId = playerId;
      state.players[playerId].connected = true;
      state.players[playerId].updatedAt = new Date().toISOString();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId), config: publicConfig() });
    }

    case "auth.admin": {
      if (!authenticateAdmin(data.key)) return fail(ws, requestId, "Invalid production key.");
      ws.meta.isAdmin = true;
      return ack(ws, requestId, { state: snapshot(), config: publicConfig() });
    }

    case "player.game": {
      const playerId = requirePlayer(ws, requestId);
      if (!playerId) return;
      const result = setPlayerGame(playerId, data.game);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "player.status": {
      const playerId = requirePlayer(ws, requestId);
      if (!playerId) return;
      const result = setPlayerStatus(playerId, data.status);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.player.air": {
      if (!requireAdmin(ws, requestId)) return;
      const { playerId, airState } = data;
      const result = setPlayerAirState(playerId, airState);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.player.status": {
      if (!requireAdmin(ws, requestId)) return;
      const { playerId, status } = data;
      const result = setPlayerStatus(playerId, status);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.player.game": {
      if (!requireAdmin(ws, requestId)) return;
      const { playerId, game } = data;
      const result = setPlayerGame(playerId, game);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.player.update": {
      if (!requireAdmin(ws, requestId)) return;
      const { playerId, ...updates } = data;
      const result = updatePlayer(playerId, updates);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.player.clear": {
      if (!requireAdmin(ws, requestId)) return;
      const { playerId } = data;
      const result = clearPlayerStatus(playerId);
      if (!result.ok) return fail(ws, requestId, result.error);
      persistState();
      broadcastSnapshot();
      return ack(ws, requestId, { player: safePlayerState(playerId) });
    }

    case "admin.compact.mode": {
      if (!requireAdmin(ws, requestId)) return;
      const resolvedMode = resolveCompactMode(data.mode);
      if (!resolvedMode) return fail(ws, requestId, "Unknown compact mode. Use priority, normal, bk, or all.");
      state.compactMode = resolvedMode;
      persistState();
      broadcast("compact.mode", { mode: resolvedMode });
      broadcastSnapshot();
      return ack(ws, requestId, { mode: resolvedMode });
    }

    case "state.get": {
      send(ws, "state.snapshot", snapshot(), requestId);
      return;
    }

    default:
      return fail(ws, requestId, `Unknown message type: ${type}`);
  }
}

wss.on("connection", (ws) => {
  ws.meta = { isAdmin: false, playerId: null, isAlive: true };

  ws.on("pong", () => {
    ws.meta.isAlive = true;
  });

  send(ws, "state.snapshot", snapshot());

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return fail(ws, undefined, "Binary messages are not supported.");
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return fail(ws, undefined, "Message must be valid JSON.");
    }
    handleMessage(ws, message);
  });

  ws.on("close", () => {
    const playerId = ws.meta?.playerId;
    if (!playerId) return;
    setTimeout(() => {
      if (connectedPlayerSockets(playerId) === 0 && state.players[playerId]) {
        state.players[playerId].connected = false;
        broadcastSnapshot();
      }
    }, 1000);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.meta?.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.meta.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const player of Object.values(state.players)) {
    if (player.statusExpiresAt && Date.parse(player.statusExpiresAt) <= now) {
      player.status = "normal";
      player.statusSetAt = null;
      player.statusExpiresAt = null;
      player.asapTakenLiveAt = null;
      player.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    persistState();
    broadcastSnapshot();
  }
}, 1000);

server.listen(PORT, HOST, () => {
  console.log(`Archipelago Broadcast Control v3 running at http://${HOST}:${PORT}`);
  console.log(`Plain WebSocket endpoint: ws://${HOST}:${PORT}${WS_PATH}`);
  if (ADMIN_KEY === "change-me-before-the-event") {
    console.warn("WARNING: Set a strong ADMIN_KEY before using this at an event.");
  }
});
