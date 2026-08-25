import { formatAge, priorityClass, sortPlayers, statusClass } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const login = document.querySelector("#login");
const keyInput = document.querySelector("#key");
const loginButton = document.querySelector("#loginButton");
const loginNotice = document.querySelector("#loginNotice");
const dashboard = document.querySelector("#dashboard");
const modeControls = document.querySelector("#modeControls");
const healthPanel = document.querySelector("#healthPanel");
const healthSummary = document.querySelector("#healthSummary");
const healthBadge = document.querySelector("#healthBadge");
const controlNotice = document.querySelector("#controlNotice");
const resetEventButton = document.querySelector("#resetEvent");
const serverAlert = document.querySelector("#serverAlert");

let authenticated = false;
let adminKey = "";
let latestSnapshot = null;
let websocketConnected = false;

const socket = new BroadcastSocket({
  onOpen: async () => {
    websocketConnected = true;
    serverAlert.classList.add("hidden");
    document.body.classList.remove("server-unreachable");
    if (!authenticated || !adminKey) return;
    const result = await socket.request("auth.admin", { key: adminKey });
    if (!result.ok) {
      authenticated = false;
      login.classList.remove("hidden");
      dashboard.classList.add("hidden");
      modeControls.classList.add("hidden");
      healthPanel.classList.add("hidden");
      loginNotice.textContent = result.error;
      return;
    }
    render(result.state);
  },
  onClose: () => {
    websocketConnected = false;
    serverAlert.classList.remove("hidden");
    document.body.classList.add("server-unreachable");
    renderHealth(latestSnapshot);
  },
  onMessage: (message) => {
    if (message.type === "state.snapshot") render(message.data);
  }
});

async function sendAdmin(type, data) {
  const result = await socket.request(type, data);
  if (!result.ok) alert(result.error);
  return result;
}

function airButton(playerId, state, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-button";
  button.textContent = label;
  button.addEventListener("click", () => sendAdmin("admin.player.air", { playerId, airState: state }));
  return button;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function ageFromIso(iso) {
  if (!iso) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  return `${formatDuration(seconds)} ago`;
}

function renderHealth(snapshot) {
  if (!authenticated || !snapshot) return;
  const system = snapshot.system || {};
  const configured = system.configuredPlayers ?? snapshot.players?.length ?? 0;
  const connected = system.connectedPlayers ?? snapshot.players?.filter((p) => p.connected).length ?? 0;

  document.querySelector("#healthVersion").textContent = system.version ? `v${system.version}` : "—";
  const uptime = system.startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(system.startedAt)) / 1000))
    : system.uptimeSeconds;
  document.querySelector("#healthUptime").textContent = formatDuration(uptime);
  document.querySelector("#healthPlayers").textContent = `${connected} / ${configured}`;
  document.querySelector("#healthSockets").textContent = system.websocketClients ?? "—";
  document.querySelector("#healthLive").textContent = system.currentLivePlayerName || "None";
  document.querySelector("#healthCompact").textContent = String(system.compactMode || snapshot.compactMode || "—").toUpperCase();
  document.querySelector("#healthSaved").textContent = ageFromIso(system.lastPersistAt);
  document.querySelector("#healthConnection").textContent = websocketConnected ? "CONNECTED" : "DISCONNECTED";

  const healthy = websocketConnected && connected === configured;
  healthBadge.textContent = !websocketConnected ? "SERVER OFFLINE" : healthy ? "OK" : "ATTENTION";
  healthBadge.className = `badge ${!websocketConnected ? "health-critical" : healthy ? "health-ok" : "health-warning"}`;
  healthSummary.textContent = !websocketConnected
    ? "Dashboard WebSocket is disconnected. Automatic reconnect is active."
    : connected === configured
      ? `All ${configured} configured player control pages are connected.`
      : `${configured - connected} of ${configured} player control page${configured - connected === 1 ? " is" : "s are"} disconnected.`;
}

function render(snapshot) {
  latestSnapshot = snapshot;
  if (!authenticated) return;

  renderHealth(snapshot);
  dashboard.replaceChildren();
  for (const player of sortPlayers(snapshot.players)) {
    const card = document.createElement("article");
    card.className = `card player-card ${priorityClass(player.statusDefinition.priority)}${player.connected ? "" : " disconnected"}`;

    const top = document.createElement("div");
    top.className = "card-top";

    const identity = document.createElement("div");
    identity.className = "player-identity";
    const heading = document.createElement("h2");
    heading.textContent = player.name;
    const game = document.createElement("div");
    game.textContent = player.currentGame;
    game.className = "muted player-current-game";
    identity.append(heading, game);

    const badges = document.createElement("div");
    badges.className = "player-badges";

    if (!player.connected) {
      const disconnected = document.createElement("span");
      disconnected.className = "badge disconnected-badge";
      disconnected.textContent = "DISCONNECTED";
      badges.append(disconnected);
    }

    const status = document.createElement("span");
    status.className = `badge ${statusClass(player.status)}`;
    status.textContent = player.statusDefinition.label;
    badges.append(status);
    top.append(identity, badges);

    const details = document.createElement("p");
    details.className = player.connected ? "muted" : "offline-detail";
    details.dataset.playerDetailsId = player.id;
    details.style.margin = "12px 0 0";
    details.textContent = [
      player.connected ? "Player page connected" : "PLAYER PAGE OFFLINE",
      player.statusSetAt ? `status age ${formatAge(player.statusSetAt)}` : null,
      player.airState !== "off" ? player.airState.toUpperCase() : null
    ].filter(Boolean).join(" • ");

    const gameControl = document.createElement("div");
    gameControl.className = "game-control";

    const gameSelect = document.createElement("select");
    gameSelect.className = "game-select";
    gameSelect.setAttribute("aria-label", `Current game for ${player.name}`);
    for (const assignedGame of player.games) {
      const option = document.createElement("option");
      option.value = assignedGame;
      option.textContent = assignedGame;
      option.selected = assignedGame === player.currentGame;
      gameSelect.append(option);
    }

    const changeGame = document.createElement("button");
    changeGame.type = "button";
    changeGame.className = "small-button";
    changeGame.textContent = "Change game";
    changeGame.disabled = player.games.length < 2;
    changeGame.addEventListener("click", async () => {
      if (gameSelect.value === player.currentGame) return;
      const result = await sendAdmin("admin.player.game", { playerId: player.id, game: gameSelect.value });
      if (result.ok) controlNotice.textContent = `${player.name} changed to ${gameSelect.value}.`;
    });
    gameControl.append(gameSelect, changeGame);

    const controls = document.createElement("div");
    controls.className = "controls";
    controls.append(
      airButton(player.id, "standby", "Stand by"),
      airButton(player.id, "live", "Take live"),
      airButton(player.id, "off", "Off air")
    );

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "small-button";
    clear.textContent = "Clear status";
    clear.addEventListener("click", () => sendAdmin("admin.player.clear", { playerId: player.id }));
    controls.append(clear);

    const panic = document.createElement("button");
    panic.type = "button";
    panic.className = "small-button danger-button";
    panic.textContent = "Panic reset";
    panic.title = "Set this player off-air and return their status to Normal. Current game is preserved.";
    panic.addEventListener("click", async () => {
      if (!confirm(`Panic reset ${player.name}?\n\nThis will set them OFF AIR and return their status to Normal. Their current game will be preserved.`)) return;
      const result = await sendAdmin("admin.player.panic", { playerId: player.id });
      if (result.ok) controlNotice.textContent = `${player.name} panic reset completed.`;
    });
    controls.append(panic);

    card.append(top, details, gameControl, controls);
    dashboard.append(card);
  }
}

async function authenticate() {
  const key = keyInput.value;
  const result = await socket.request("auth.admin", { key });
  if (!result.ok) {
    loginNotice.textContent = result.error;
    return;
  }

  adminKey = key;
  authenticated = true;
  login.classList.add("hidden");
  dashboard.classList.remove("hidden");
  modeControls.classList.remove("hidden");
  healthPanel.classList.remove("hidden");
  render(result.state);
}

loginButton.addEventListener("click", authenticate);
keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") authenticate();
});

for (const button of document.querySelectorAll(".compact-mode")) {
  button.addEventListener("click", async () => {
    const result = await sendAdmin("admin.compact.mode", { mode: button.dataset.mode });
    if (result.ok) controlNotice.textContent = `Compact monitor changed to ${result.mode.toUpperCase()}.`;
  });
}

resetEventButton.addEventListener("click", async () => {
  if (!confirm(
    "Reset event state for ALL players?\n\n" +
    "This will:\n" +
    "• Set every player OFF AIR\n" +
    "• Return every status to Normal\n" +
    "• Clear ASAP acknowledgements/timers\n" +
    "• Return the compact monitor to Calls\n\n" +
    "Current game selections will be preserved."
  )) return;

  const result = await sendAdmin("admin.event.reset", {});
  if (result.ok) controlNotice.textContent = "Event state reset completed.";
});


function refreshDashboardTimers() {
  if (!latestSnapshot) return;

  renderHealth(latestSnapshot);

  const playersById = new Map(latestSnapshot.players.map((player) => [player.id, player]));
  document.querySelectorAll("[data-player-details-id]").forEach((element) => {
    const player = playersById.get(element.dataset.playerDetailsId);
    if (!player) return;

    element.textContent = [
      player.connected ? "Player page connected" : "PLAYER PAGE OFFLINE",
      player.statusSetAt ? `status age ${formatAge(player.statusSetAt)}` : null,
      player.airState !== "off" ? player.airState.toUpperCase() : null
    ].filter(Boolean).join(" • ");
  });
}

setInterval(refreshDashboardTimers, 1000);
