import { qs } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const playerId = qs("id");
const token = qs("token");

const app = document.querySelector("#app");
const errorBox = document.querySelector("#error");
const title = document.querySelector("#title");
const gameSelect = document.querySelector("#game");
const statuses = document.querySelector("#statuses");
const gameNotice = document.querySelector("#gameNotice");
const statusNotice = document.querySelector("#statusNotice");
const air = document.querySelector("#air");

let currentPlayer = null;
let statusDefinitions = {};

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  app.classList.add("hidden");
}

function renderPlayer(player) {
  currentPlayer = player;
  title.textContent = `${player.name} — Broadcast Controls`;

  if (gameSelect.options.length === 0) {
    for (const game of player.games) {
      const option = document.createElement("option");
      option.value = game;
      option.textContent = game;
      gameSelect.append(option);
    }
  }
  gameSelect.value = player.currentGame;

  for (const button of statuses.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.status === player.status);
    button.setAttribute("aria-pressed", String(button.dataset.status === player.status));
  }

  air.className = `air ${player.airState}`;
  air.textContent = player.airState === "live" ? "YOU’RE LIVE" : player.airState === "standby" ? "STAND BY" : "NOT ON AIR";
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
      statusNotice.textContent = result.ok ? (key === "normal" ? "Status cleared." : "Production has been notified.") : result.error;
    });
    statuses.append(button);
  }
}

const socket = new BroadcastSocket({
  onOpen: async () => {
    if (!playerId || !token) {
      showError("This page needs a player-specific link with an ID and token.");
      return;
    }

    statusNotice.textContent = "Connected.";
    const result = await socket.request("auth.player", { playerId, token });
    if (!result.ok) return showError(result.error);

    statusDefinitions = result.config.statuses;
    renderStatusButtons(socket);
    renderPlayer(result.player);
    errorBox.classList.add("hidden");
    app.classList.remove("hidden");
    statusNotice.textContent = "";
  },
  onClose: () => {
    statusNotice.textContent = "Connection interrupted. Reconnecting…";
  },
  onMessage: (message) => {
    if (message.type !== "state.snapshot") return;
    const player = message.data.players.find((entry) => entry.id === playerId);
    if (player && currentPlayer) renderPlayer(player);
  }
});

gameSelect.addEventListener("change", async () => {
  const result = await socket.request("player.game", { game: gameSelect.value });
  gameNotice.textContent = result.ok ? "Current game updated." : result.error;
});
