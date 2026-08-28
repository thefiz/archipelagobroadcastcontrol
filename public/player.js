import { qs } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

let activePlayerId = qs("id");
let activeToken = qs("token");

const app = document.querySelector("#app");
const errorBox = document.querySelector("#error");
const title = document.querySelector("#title");
const gameSelect = document.querySelector("#game");
const statuses = document.querySelector("#statuses");
const gameNotice = document.querySelector("#gameNotice");
const statusNotice = document.querySelector("#statusNotice");
const air = document.querySelector("#air");

const login = document.querySelector("#playerLogin");
const loginPlayer = document.querySelector("#loginPlayer");
const loginToken = document.querySelector("#loginToken");
const loginButton = document.querySelector("#loginButton");
const loginNotice = document.querySelector("#loginNotice");

let currentPlayer = null;
let statusDefinitions = {};
let socketConnected = false;
let rosterLoaded = false;

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
    showLogin(result.error);
    loginToken.focus();
    loginToken.select();
    return false;
  }

  activePlayerId = playerId;
  activeToken = token;
  statusDefinitions = result.config.statuses;

  renderStatusButtons(socket);
  renderPlayer(result.player);

  clearError();
  hideLogin();
  app.classList.remove("hidden");
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

gameSelect.addEventListener("change", async () => {
  const result = await socket.request("player.game", { game: gameSelect.value });
  gameNotice.textContent = result.ok ? "Current game updated." : result.error;
});

loadRoster();
