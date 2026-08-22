export function createStateManager({ config, persistedState, onPersist }) {
  const playerDefinitions = new Map(config.players.map((player) => [player.id, player]));
  let lastPersistAt = null;

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

  const state = initialState();
  const persisted = persistedState || initialState();
  state.compactMode = ["priority", "normal", "bk", "all"].includes(persisted.compactMode)
    ? persisted.compactMode : "priority";

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

  function persist() {
    const safeState = structuredClone(state);
    for (const player of Object.values(safeState.players)) player.connected = false;
    onPersist(safeState);
    lastPersistAt = new Date().toISOString();
    return lastPersistAt;
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
    if (!player || !definition) return null;
    return { ...player, games: definition.games, statusDefinition: config.statuses[player.status] };
  }

  function lowerThirdPlayer(playerId) {
    const player = state.players[playerId];
    if (!player) return null;
    return {
      id: player.id, name: player.name, game: player.currentGame, currentGame: player.currentGame,
      airState: player.airState, live: player.airState === "live", status: player.status, connected: player.connected
    };
  }

  function lowerThirdSnapshot() {
    return {
      eventName: state.eventName,
      generatedAt: new Date().toISOString(),
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, lowerThirdPlayer(id)]))
    };
  }

  function setPlayerGame(playerId, game) {
    const player = state.players[playerId];
    const definition = playerDefinitions.get(playerId);
    if (!player) return { ok: false, error: "Unknown player." };
    if (!definition.games.includes(game)) return { ok: false, error: "That game is not assigned to this player." };
    player.currentGame = game;
    clearStatusFields(player);
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function clearStatusFields(player) {
    player.status = "normal";
    player.statusSetAt = null;
    player.statusExpiresAt = null;
    player.asapTakenLiveAt = null;
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
    player.statusExpiresAt = definition.expiresSeconds > 0 ? new Date(now + definition.expiresSeconds * 1000).toISOString() : null;
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function setPlayerAirState(playerId, airState) {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Unknown player." };
    if (!["off", "standby", "live"].includes(airState)) return { ok: false, error: "Unknown air state." };
    if (airState === "live") {
      for (const other of Object.values(state.players)) {
        if (other.id !== playerId && other.airState === "live") {
          other.airState = "off";
          other.updatedAt = new Date().toISOString();
        }
      }
    }
    player.airState = airState;
    if (airState === "live" && player.status === "asap") player.asapTakenLiveAt = new Date().toISOString();
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function clearPlayerStatus(playerId) {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Unknown player." };
    clearStatusFields(player);
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function panicResetPlayer(playerId) {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Unknown player." };
    clearStatusFields(player);
    player.airState = "off";
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function resetEventState() {
    const now = new Date().toISOString();
    for (const player of Object.values(state.players)) {
      clearStatusFields(player);
      player.airState = "off";
      player.updatedAt = now;
    }
    state.compactMode = "priority";
    return { ok: true };
  }

  function updatePlayer(playerId, updates) {
    const player = state.players[playerId];
    const definition = playerDefinitions.get(playerId);
    if (!player) return { ok: false, error: "Unknown player." };
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) return { ok: false, error: "Updates must be a JSON object." };
    const allowed = new Set(["currentGame", "status", "airState"]);
    const fields = Object.keys(updates);
    const unknown = fields.filter((field) => !allowed.has(field));
    if (unknown.length) return { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` };
    if (!fields.length) return { ok: false, error: "Supply at least one of currentGame, status, or airState." };
    if (Object.hasOwn(updates, "currentGame") && !definition.games.includes(updates.currentGame)) return { ok: false, error: "That game is not assigned to this player." };
    if (Object.hasOwn(updates, "status") && !config.statuses[updates.status]) return { ok: false, error: "Unknown status." };
    if (Object.hasOwn(updates, "airState") && !["off", "standby", "live"].includes(updates.airState)) return { ok: false, error: "Unknown air state." };
    if (Object.hasOwn(updates, "currentGame")) setPlayerGame(playerId, updates.currentGame);
    if (Object.hasOwn(updates, "status")) setPlayerStatus(playerId, updates.status);
    if (Object.hasOwn(updates, "airState")) setPlayerAirState(playerId, updates.airState);
    return { ok: true };
  }

  function expireStatuses(now = Date.now()) {
    let changed = false;
    for (const player of Object.values(state.players)) {
      if (player.statusExpiresAt && Date.parse(player.statusExpiresAt) <= now) {
        clearStatusFields(player);
        player.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    return changed;
  }

  function resolveCompactMode(mode) {
    const aliases = { priority: "priority", calls: "priority", normal: "normal", bk: "bk", downtime: "bk", all: "all" };
    return aliases[String(mode || "").toLowerCase()] || null;
  }

  return {
    state, playerDefinitions, publicConfig, safePlayerState, lowerThirdPlayer, lowerThirdSnapshot,
    persist, getLastPersistAt: () => lastPersistAt, setLastPersistAt: (value) => { lastPersistAt = value; },
    setPlayerGame, setPlayerStatus, setPlayerAirState, clearPlayerStatus, panicResetPlayer,
    resetEventState, updatePlayer, expireStatuses, resolveCompactMode
  };
}
