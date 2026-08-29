export function createStateManager({ config, persistedState, onPersist, runtimeDefaults = {} }) {
  const playerDefinitions = new Map(config.players.map((player) => [player.id, player]));
  let lastPersistAt = null;

  function initialRuntimeSettings() {
    return {
      rotationSeconds: Number(runtimeDefaults.rotationSeconds ?? 300),
      asapOverrideSeconds: Number(runtimeDefaults.asapOverrideSeconds ?? 180),
      statuses: Object.fromEntries(Object.entries(config.statuses).map(([key, definition]) => [key, {
        label: definition.label,
        expiresSeconds: definition.expiresSeconds
      }]))
    };
  }

  function effectiveStatusDefinition(status) {
    const base = config.statuses[status];
    if (!base) return null;
    const override = state.runtimeSettings?.statuses?.[status] || {};
    return {
      ...base,
      label: override.label ?? base.label,
      expiresSeconds: Number.isFinite(Number(override.expiresSeconds))
        ? Number(override.expiresSeconds)
        : base.expiresSeconds
    };
  }

  function effectiveStatuses() {
    return Object.fromEntries(Object.keys(config.statuses).map((key) => [key, effectiveStatusDefinition(key)]));
  }

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
        rotationActive: true,
        updatedAt: new Date().toISOString(),
        connected: false
      };
    }
    return {
      eventName: config.eventName,
      compactMode: "priority",
      unattendedMode: false,
      unattendedTarget: "",
      unattendedTargetReason: "",
      runtimeSettings: initialRuntimeSettings(),
      players
    };
  }

  const state = initialState();
  const persisted = persistedState || initialState();
  state.compactMode = ["priority", "normal", "bk", "all"].includes(persisted.compactMode)
    ? persisted.compactMode : "priority";
  state.unattendedMode = false;
  state.unattendedTarget = "";
  state.unattendedTargetReason = "";

  if (persisted.runtimeSettings && typeof persisted.runtimeSettings === "object") {
    const defaults = initialRuntimeSettings();
    const savedStatuses = persisted.runtimeSettings.statuses || {};
    state.runtimeSettings = {
      rotationSeconds: Number.isFinite(Number(persisted.runtimeSettings.rotationSeconds))
        ? Number(persisted.runtimeSettings.rotationSeconds) : defaults.rotationSeconds,
      asapOverrideSeconds: Number.isFinite(Number(persisted.runtimeSettings.asapOverrideSeconds))
        ? Number(persisted.runtimeSettings.asapOverrideSeconds) : defaults.asapOverrideSeconds,
      statuses: Object.fromEntries(Object.keys(config.statuses).map((key) => [key, {
        label: typeof savedStatuses[key]?.label === "string" ? savedStatuses[key].label : defaults.statuses[key].label,
        expiresSeconds: Number.isFinite(Number(savedStatuses[key]?.expiresSeconds))
          ? Number(savedStatuses[key].expiresSeconds) : defaults.statuses[key].expiresSeconds
      }]))
    };
  }

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
      rotationActive: playerState.rotationActive !== false,
      connected: false
    };
  }

  for (const player of Object.values(state.players)) {
    if (!player.statusSetAt || player.status === "normal") continue;
    const definition = effectiveStatusDefinition(player.status);
    player.statusExpiresAt = definition.expiresSeconds > 0
      ? new Date(Date.parse(player.statusSetAt) + definition.expiresSeconds * 1000).toISOString()
      : null;
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
      statuses: effectiveStatuses(),
      players: config.players.map(({ token, ...player }) => player)
    };
  }

  function safePlayerState(playerId) {
    const player = state.players[playerId];
    const definition = playerDefinitions.get(playerId);
    if (!player || !definition) return null;
    return { ...player, games: definition.games, statusDefinition: effectiveStatusDefinition(player.status) };
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
    const definition = effectiveStatusDefinition(status);
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

  function setPlayerRotationActive(playerId, enabled) {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Unknown player." };
    if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
    player.rotationActive = enabled;
    player.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  function setUnattendedMode(enabled) {
    if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
    state.unattendedMode = enabled;
    if (!enabled) {
      state.unattendedTarget = "";
      state.unattendedTargetReason = "";
    }
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
    const allowed = new Set(["currentGame", "status", "airState", "rotationActive"]);
    const fields = Object.keys(updates);
    const unknown = fields.filter((field) => !allowed.has(field));
    if (unknown.length) return { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` };
    if (!fields.length) return { ok: false, error: "Supply at least one supported player field." };
    if (Object.hasOwn(updates, "currentGame") && !definition.games.includes(updates.currentGame)) return { ok: false, error: "That game is not assigned to this player." };
    if (Object.hasOwn(updates, "status") && !config.statuses[updates.status]) return { ok: false, error: "Unknown status." };
    if (Object.hasOwn(updates, "airState") && !["off", "standby", "live"].includes(updates.airState)) return { ok: false, error: "Unknown air state." };
    if (Object.hasOwn(updates, "rotationActive") && typeof updates.rotationActive !== "boolean") return { ok: false, error: "rotationActive must be true or false." };
    if (Object.hasOwn(updates, "currentGame")) setPlayerGame(playerId, updates.currentGame);
    if (Object.hasOwn(updates, "status")) setPlayerStatus(playerId, updates.status);
    if (Object.hasOwn(updates, "airState")) setPlayerAirState(playerId, updates.airState);
    if (Object.hasOwn(updates, "rotationActive")) setPlayerRotationActive(playerId, updates.rotationActive);
    return { ok: true };
  }

  function runtimeSettingsSnapshot() {
    return structuredClone(state.runtimeSettings);
  }

  function updateRuntimeSettings(updates) {
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return { ok: false, error: "Settings must be a JSON object." };
    }

    const next = runtimeSettingsSnapshot();
    if (Object.hasOwn(updates, "rotationSeconds")) {
      const value = Number(updates.rotationSeconds);
      if (!Number.isInteger(value) || value < 10 || value > 86400) return { ok: false, error: "rotationSeconds must be an integer from 10 to 86400." };
      next.rotationSeconds = value;
    }
    if (Object.hasOwn(updates, "asapOverrideSeconds")) {
      const value = Number(updates.asapOverrideSeconds);
      if (!Number.isInteger(value) || value < 10 || value > 86400) return { ok: false, error: "asapOverrideSeconds must be an integer from 10 to 86400." };
      next.asapOverrideSeconds = value;
    }
    if (Object.hasOwn(updates, "statuses")) {
      if (!updates.statuses || typeof updates.statuses !== "object" || Array.isArray(updates.statuses)) return { ok: false, error: "statuses must be an object." };
      for (const [key, statusUpdate] of Object.entries(updates.statuses)) {
        if (!config.statuses[key]) return { ok: false, error: `Unknown status: ${key}` };
        if (!statusUpdate || typeof statusUpdate !== "object" || Array.isArray(statusUpdate)) return { ok: false, error: `Status ${key} must be an object.` };
        if (Object.hasOwn(statusUpdate, "label")) {
          const label = String(statusUpdate.label).trim();
          if (!label || label.length > 80) return { ok: false, error: `Label for ${key} must be 1-80 characters.` };
          next.statuses[key].label = label;
        }
        if (Object.hasOwn(statusUpdate, "expiresSeconds")) {
          const value = Number(statusUpdate.expiresSeconds);
          if (!Number.isInteger(value) || value < 0 || value > 86400) return { ok: false, error: `Timeout for ${key} must be an integer from 0 to 86400.` };
          next.statuses[key].expiresSeconds = value;
        }
      }
    }

    state.runtimeSettings = next;

    // Apply new timeout values immediately to calls already in progress.
    for (const player of Object.values(state.players)) {
      if (!player.statusSetAt || player.status === "normal") continue;
      const definition = effectiveStatusDefinition(player.status);
      player.statusExpiresAt = definition.expiresSeconds > 0
        ? new Date(Date.parse(player.statusSetAt) + definition.expiresSeconds * 1000).toISOString()
        : null;
    }
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
    setPlayerGame, setPlayerStatus, setPlayerAirState, setPlayerRotationActive, setUnattendedMode,
    clearPlayerStatus, panicResetPlayer, resetEventState, updatePlayer, runtimeSettingsSnapshot, updateRuntimeSettings,
    effectiveStatusDefinition, effectiveStatuses, expireStatuses, resolveCompactMode
  };
}
