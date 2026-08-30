import { qs } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const STORAGE_PLAYER_ID = "archipelagoBroadcastPlayerId";
const STORAGE_PLAYER_TOKEN = "archipelagoBroadcastPlayerToken";

let activePlayerId = qs("id") || localStorage.getItem(STORAGE_PLAYER_ID);
let activeToken = qs("token") || localStorage.getItem(STORAGE_PLAYER_TOKEN);

const app = document.querySelector("#app");
const errorBox = document.querySelector("#error");
const title = document.querySelector("#title");
const gameSelect = document.querySelector("#game");
const statuses = document.querySelector("#statuses");
const gameNotice = document.querySelector("#gameNotice");
const statusNotice = document.querySelector("#statusNotice");
const air = document.querySelector("#air");
const rotationState = document.querySelector("#rotationState");
const rotationButton = document.querySelector("#rotationButton");
const rotationNotice = document.querySelector("#rotationNotice");
const focusState = document.querySelector("#focusState");
const focusButton = document.querySelector("#focusButton");
const focusNotice = document.querySelector("#focusNotice");

const login = document.querySelector("#playerLogin");
const loginPlayer = document.querySelector("#loginPlayer");
const loginToken = document.querySelector("#loginToken");
const loginButton = document.querySelector("#loginButton");
const loginNotice = document.querySelector("#loginNotice");
const logoutButton = document.querySelector("#logoutButton");

let currentPlayer = null;
let statusDefinitions = {};
let socketConnected = false;
let rosterLoaded = false;
let unattendedFocusPlayerId = null;

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function showLogin(message = "") {
  app.classList.add("hidden");
  login.classList.remove("hidden");
  title.textContent = "Player Broadcast Controls";
  loginNotice.textContent = message;
}

function hideLogin() {
  login.classList.add("hidden");
  loginNotice.textContent = "";
}

function clearCredentialQueryString() {
  if (!location.search) return;
  history.replaceState(null, "", location.pathname + location.hash);
}

function saveCredentials(playerId, token) {
  localStorage.setItem(STORAGE_PLAYER_ID, playerId);
  localStorage.setItem(STORAGE_PLAYER_TOKEN, token);
}

function clearSavedCredentials() {
  localStorage.removeItem(STORAGE_PLAYER_ID);
  localStorage.removeItem(STORAGE_PLAYER_TOKEN);
}

function resetPlayerSession() {
  activePlayerId = "";
  activeToken = "";
  currentPlayer = null;
  statusDefinitions = {};
  clearSavedCredentials();

  gameSelect.replaceChildren();
  gameSelect.removeAttribute("data-player-id");
  statuses.replaceChildren();
  app.classList.add("hidden");
  logoutButton.classList.add("hidden");
  loginToken.value = "";

  showLogin("Logged out.");
}

async function loadRoster() {
  if (rosterLoaded) return;

  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();

    loginPlayer.replaceChildren();
    for (const player of config.players || []) {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      loginPlayer.append(option);
    }

    if (activePlayerId && [...loginPlayer.options].some((option) => option.value === activePlayerId)) {
      loginPlayer.value = activePlayerId;
    }

    rosterLoaded = true;
  } catch {
    showError("Could not load the player list from the server.");
  }
}

function renderPlayer(player) {
  currentPlayer = player;
  title.textContent = `${player.name} — Broadcast Controls`;

  if (
    gameSelect.options.length === 0 ||
    gameSelect.dataset.playerId !== player.id
  ) {
    gameSelect.replaceChildren();
    for (const game of player.games) {
      const option = document.createElement("option");
      option.value = game;
      option.textContent = game;
      gameSelect.append(option);
    }
    gameSelect.dataset.playerId = player.id;
  }

  gameSelect.value = player.currentGame;

  for (const button of statuses.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.status === player.status);
    button.setAttribute("aria-pressed", String(button.dataset.status === player.status));
  }

  rotationState.textContent = player.rotationActive
    ? "You are in the overnight rotation."
    : "You are not in the overnight rotation.";
  rotationButton.textContent = player.rotationActive
    ? "Leave Overnight Rotation"
    : "Join Overnight Rotation";
  rotationButton.classList.toggle("active", player.rotationActive);

  const hasFocus = unattendedFocusPlayerId === player.id;
  focusState.textContent = hasFocus
    ? "Your feed has persistent unattended focus."
    : (unattendedFocusPlayerId ? "Another player currently has persistent focus." : "No player has persistent focus.");
  focusButton.textContent = hasFocus ? "Release Focus" : "Hold My Feed";
  focusButton.classList.toggle("active", hasFocus);

  air.className = `air ${player.airState}`;
  air.textContent =
    player.airState === "live"
      ? "YOU’RE LIVE"
      : player.airState === "standby"
        ? "STAND BY"
        : "NOT ON AIR";
}

function renderStatusButtons(socket) {
  statuses.replaceChildren();
  for (const [key, definition] of Object.entries(statusDefinitions)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.dataset.status = key;
    button.textContent = definition.label;
    button.addEventListener("click", async () => {
      const result = await socket.request("player.status", { status: key });
      statusNotice.textContent = result.ok
        ? (key === "normal" ? "Status cleared." : "Production has been notified.")
        : result.error;
    });
    statuses.append(button);
  }
}

async function authenticate(playerId, token, { clearUrl = false } = {}) {
  if (!socketConnected) {
    showLogin("Connecting to server…");
    return false;
  }

  if (!playerId || !token) {
    showLogin("Choose your player name and enter your token.");
    return false;
  }

  loginButton.disabled = true;
  loginNotice.textContent = "Logging in…";

  const result = await socket.request("auth.player", { playerId, token });

  if (!result.ok) {
    loginButton.disabled = false;

    if (playerId === activePlayerId && token === activeToken) {
      activePlayerId = "";
      activeToken = "";
      currentPlayer = null;
      clearSavedCredentials();
    }

    showLogin(result.error);
    loginToken.focus();
    loginToken.select();
    return false;
  }

  activePlayerId = playerId;
  activeToken = token;
  saveCredentials(playerId, token);
  statusDefinitions = result.config.statuses;

  renderStatusButtons(socket);
  renderPlayer(result.player);

  clearError();
  hideLogin();
  app.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  statusNotice.textContent = "";
  loginButton.disabled = false;

  if (clearUrl) clearCredentialQueryString();
  return true;
}

const socket = new BroadcastSocket({
  onOpen: async () => {
    socketConnected = true;
    loginButton.disabled = false;

    await loadRoster();

    if (activePlayerId && activeToken) {
      await authenticate(activePlayerId, activeToken, { clearUrl: Boolean(location.search) });
      return;
    }

    showLogin();
  },

  onClose: () => {
    socketConnected = false;
    loginButton.disabled = true;

    if (currentPlayer) {
      statusNotice.textContent = "Connection interrupted. Reconnecting…";
    } else {
      showLogin("Connection interrupted. Reconnecting…");
    }
  },

  onMessage: (message) => {
    if (message.type !== "state.snapshot" || !activePlayerId) return;

    if (message.data.runtimeSettings?.statuses) {
      for (const [key, definition] of Object.entries(message.data.runtimeSettings.statuses)) {
        if (statusDefinitions[key]) statusDefinitions[key] = { ...statusDefinitions[key], ...definition };
        const button = statuses.querySelector(`[data-status="${key}"]`);
        if (button) button.textContent = definition.label;
      }
    }

    unattendedFocusPlayerId = message.data.unattendedFocusPlayerId || null;
    const player = message.data.players.find((entry) => entry.id === activePlayerId);
    if (player && currentPlayer) renderPlayer(player);
  }
});

loginButton.addEventListener("click", async () => {
  await authenticate(loginPlayer.value, loginToken.value);
});

loginToken.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await authenticate(loginPlayer.value, loginToken.value);
  }
});

logoutButton.addEventListener("click", () => {
  resetPlayerSession();
});

focusButton.addEventListener("click", async () => {
  if (!currentPlayer) return;
  const enabled = unattendedFocusPlayerId !== currentPlayer.id;
  const result = await socket.request("player.unattended.focus", { enabled });
  focusNotice.textContent = result.ok
    ? (enabled ? "Persistent focus requested." : "Persistent focus released.")
    : result.error;
});

rotationButton.addEventListener("click", async () => {
  if (!currentPlayer) return;
  const result = await socket.request("player.rotation", { enabled: !currentPlayer.rotationActive });
  rotationNotice.textContent = result.ok
    ? (result.player.rotationActive ? "Joined overnight rotation." : "Left overnight rotation.")
    : result.error;
});

gameSelect.addEventListener("change", async () => {
  const result = await socket.request("player.game", { game: gameSelect.value });
  gameNotice.textContent = result.ok ? "Current game updated." : result.error;
});

loadRoster();
