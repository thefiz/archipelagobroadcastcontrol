import { formatAge, priorityClass, sortPlayers, statusClass } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const login = document.querySelector("#login");
const keyInput = document.querySelector("#key");
const loginButton = document.querySelector("#loginButton");
const loginNotice = document.querySelector("#loginNotice");
const dashboard = document.querySelector("#dashboard");
const modeControls = document.querySelector("#modeControls");

let authenticated = false;
let adminKey = "";
let latestSnapshot = null;

const socket = new BroadcastSocket({
  onOpen: async () => {
    if (!authenticated || !adminKey) return;
    const result = await socket.request("auth.admin", { key: adminKey });
    if (!result.ok) {
      authenticated = false;
      login.classList.remove("hidden");
      dashboard.classList.add("hidden");
      modeControls.classList.add("hidden");
      loginNotice.textContent = result.error;
      return;
    }
    render(result.state);
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

function render(snapshot) {
  latestSnapshot = snapshot;
  if (!authenticated) return;

  dashboard.replaceChildren();
  for (const player of sortPlayers(snapshot.players)) {
    const card = document.createElement("article");
    card.className = `card player-card ${priorityClass(player.statusDefinition.priority)}`;

    const top = document.createElement("div");
    top.className = "card-top";

    const identity = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = player.name;
    heading.style.marginBottom = "4px";
    const game = document.createElement("div");
    game.textContent = player.currentGame;
    game.className = "muted";
    identity.append(heading, game);

    const status = document.createElement("span");
    status.className = `badge ${statusClass(player.status)}`;
    status.textContent = player.statusDefinition.label;
    top.append(identity, status);

    const details = document.createElement("p");
    details.className = "muted";
    details.style.margin = "12px 0 0";
    details.textContent = [
      player.connected ? "Player page connected" : "Player page offline",
      player.statusSetAt ? `status age ${formatAge(player.statusSetAt)}` : null,
      player.airState !== "off" ? player.airState.toUpperCase() : null
    ].filter(Boolean).join(" • ");

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

    card.append(top, details, controls);
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
  render(result.state);
}

loginButton.addEventListener("click", authenticate);
keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") authenticate();
});

for (const button of document.querySelectorAll(".compact-mode")) {
  button.addEventListener("click", () => sendAdmin("admin.compact.mode", { mode: button.dataset.mode }));
}

setInterval(() => latestSnapshot && render(latestSnapshot), 1000);
