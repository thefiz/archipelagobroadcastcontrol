import { WebSocketServer, WebSocket } from "ws";
import { safeCompare } from "./config.js";
import { connectedPlayerSockets, reassignPlayerConnection } from "./connections.js";
import { buildCompanionFields } from "./companion.js";

export function attachWebSocket({ server, wsPath, stateManager, adminKey, snapshot }) {
  const wss = new WebSocketServer({ server, path: wsPath });
  const companionFields = () => buildCompanionFields(stateManager.state.players);

  function send(ws, type, data = {}, requestId = undefined) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const message = { type, data, ...companionFields() };
    if (requestId !== undefined) message.requestId = requestId;
    ws.send(JSON.stringify(message));
  }
  const ack = (ws, id, data = {}) => send(ws, "ack", { ok: true, ...data }, id);
  const fail = (ws, id, error) => send(ws, "ack", { ok: false, error }, id);

  function broadcast(type, data = {}) {
    const payload = JSON.stringify({ type, data, ...companionFields() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
  const broadcastSnapshot = () => broadcast("state.snapshot", snapshot());

  function refreshConnected(playerId) {
    if (stateManager.state.players[playerId]) {
      stateManager.state.players[playerId].connected =
        connectedPlayerSockets(wss.clients, playerId, WebSocket.OPEN) > 0;
    }
  }

  function restoreState(previousState) {
    for (const key of Object.keys(stateManager.state)) delete stateManager.state[key];
    Object.assign(stateManager.state, previousState);
  }

  // State-changing commands are transactional in memory: if persistence fails,
  // restore the prior state and report failure instead of leaving a half-committed change.
  function runMutation(ws, requestId, mutate, successData, afterCommit) {
    const previousState = structuredClone(stateManager.state);
    const result = mutate();
    if (result && result.ok === false) return fail(ws, requestId, result.error);
    try {
      stateManager.persist();
    } catch (error) {
      restoreState(previousState);
      console.error(error.message);
      return fail(ws, requestId, "Could not persist server state.");
    }
    afterCommit?.();
    broadcastSnapshot();
    return ack(ws, requestId, successData());
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
  function authenticatePlayer(playerId, token) {
    const definition = stateManager.playerDefinitions.get(playerId);
    return Boolean(definition && safeCompare(token, definition.token));
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
        reassignPlayerConnection({
          ws, newPlayerId: playerId, clients: wss.clients,
          state: stateManager.state, openState: WebSocket.OPEN
        });
        stateManager.state.players[playerId].updatedAt = new Date().toISOString();
        broadcastSnapshot();
        return ack(ws, requestId, { player: stateManager.safePlayerState(playerId), config: stateManager.publicConfig() });
      }
      case "auth.admin": {
        if (!safeCompare(data.key, adminKey)) return fail(ws, requestId, "Invalid production key.");
        ws.meta.isAdmin = true;
        return ack(ws, requestId, { state: snapshot(), config: stateManager.publicConfig() });
      }
      case "player.game": {
        const playerId = requirePlayer(ws, requestId); if (!playerId) return;
        return runMutation(ws, requestId,
          () => stateManager.setPlayerGame(playerId, data.game),
          () => ({ player: stateManager.safePlayerState(playerId) }));
      }
      case "player.status": {
        const playerId = requirePlayer(ws, requestId); if (!playerId) return;
        return runMutation(ws, requestId,
          () => stateManager.setPlayerStatus(playerId, data.status),
          () => ({ player: stateManager.safePlayerState(playerId) }));
      }
      case "admin.player.air": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.setPlayerAirState(data.playerId, data.airState),
          () => ({ player: stateManager.safePlayerState(data.playerId) }));
      }
      case "admin.player.status": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.setPlayerStatus(data.playerId, data.status),
          () => ({ player: stateManager.safePlayerState(data.playerId) }));
      }
      case "admin.player.game": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.setPlayerGame(data.playerId, data.game),
          () => ({ player: stateManager.safePlayerState(data.playerId) }));
      }
      case "admin.player.update": {
        if (!requireAdmin(ws, requestId)) return;
        const { playerId, ...updates } = data;
        return runMutation(ws, requestId,
          () => stateManager.updatePlayer(playerId, updates),
          () => ({ player: stateManager.safePlayerState(playerId) }));
      }
      case "admin.player.clear": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.clearPlayerStatus(data.playerId),
          () => ({ player: stateManager.safePlayerState(data.playerId) }));
      }
      case "admin.player.panic": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.panicResetPlayer(data.playerId),
          () => ({ player: stateManager.safePlayerState(data.playerId) }));
      }
      case "admin.event.reset": {
        if (!requireAdmin(ws, requestId)) return;
        return runMutation(ws, requestId,
          () => stateManager.resetEventState(),
          () => ({ state: snapshot() }),
          () => broadcast("compact.mode", { mode: stateManager.state.compactMode }));
      }
      case "admin.compact.mode": {
        if (!requireAdmin(ws, requestId)) return;
        const mode = stateManager.resolveCompactMode(data.mode);
        if (!mode) return fail(ws, requestId, "Unknown compact mode. Use priority, normal, bk, or all.");
        return runMutation(ws, requestId,
          () => { stateManager.state.compactMode = mode; return { ok: true }; },
          () => ({ mode }),
          () => broadcast("compact.mode", { mode }));
      }
      case "state.get":
        return send(ws, "state.snapshot", snapshot(), requestId);
      default:
        return fail(ws, requestId, `Unknown message type: ${type}`);
    }
  }

  wss.on("connection", (ws) => {
    ws.meta = { isAdmin: false, playerId: null, isAlive: true };
    ws.on("pong", () => { ws.meta.isAlive = true; });
    send(ws, "state.snapshot", snapshot());
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return fail(ws, undefined, "Binary messages are not supported.");
      let message;
      try { message = JSON.parse(raw.toString("utf8")); }
      catch { return fail(ws, undefined, "Message must be valid JSON."); }
      handleMessage(ws, message);
    });
    ws.on("close", () => {
      const playerId = ws.meta?.playerId;
      if (!playerId) return;
      setTimeout(() => { refreshConnected(playerId); broadcastSnapshot(); }, 1000);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.meta?.isAlive === false) { ws.terminate(); continue; }
      ws.meta.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on("close", () => clearInterval(heartbeat));

  return { wss, broadcast, broadcastSnapshot, close: () => { clearInterval(heartbeat); wss.close(); } };
}
