import { BroadcastSocket } from "./ws-client.js";

const queue = document.querySelector("#queue");
const modeLabel = document.querySelector("#modeLabel");
const count = document.querySelector("#count");
const connection = document.querySelector("#connection");
const overflow = document.querySelector("#overflow");
let latest = null;
let mode = "priority";
const modeNames = { priority: "CALLS", normal: "NORMAL", bk: "BK", all: "ALL" };
const SOON_FLASH_MS = 5200;

function ageText(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function statusKey(player) {
  return player.status === "downtime" ? "bk" : player.status;
}

function visiblePlayers(players) {
  if (mode === "priority") return players.filter((p) => p.status === "asap" || p.status === "soon");
  if (mode === "normal") return players.filter((p) => p.status === "normal");
  if (mode === "bk") return players.filter((p) => p.status === "downtime" || p.status === "bk");
  return players;
}

function sortPlayers(players) {
  const priority = { asap: 4, soon: 3, normal: 2, downtime: 1, bk: 1 };
  return [...players].sort((a, b) => {
    const p = (priority[b.status] || 0) - (priority[a.status] || 0);
    if (p) return p;
    if (a.status === "asap" || a.status === "soon") {
      return Date.parse(b.statusSetAt || 0) - Date.parse(a.statusSetAt || 0);
    }
    return a.name.localeCompare(b.name);
  });
}

function render() {
  if (!latest) return;
  const players = sortPlayers(visiblePlayers(latest.players));
  const shown = players;
  modeLabel.textContent = modeNames[mode] || mode.toUpperCase();
  count.textContent = players.length;
  queue.replaceChildren();
  queue.classList.toggle("density-medium", shown.length >= 5 && shown.length <= 6);
  queue.classList.toggle("density-dense", shown.length >= 7);

  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = mode === "priority" ? "NO CALLS" : "NONE";
    queue.append(empty);
    queue.style.gridTemplateRows = "1fr";
    queue.classList.remove("density-medium", "density-dense");
    overflow.textContent = "";
    return;
  }

  queue.style.gridTemplateRows = `repeat(${shown.length}, minmax(0, 1fr))`;

  for (const player of shown) {
    const key = statusKey(player);
    const row = document.createElement("article");
    row.className = `row ${key}`;

    // ASAP flashes continuously until this specific request has been taken live.
    // asapTakenLiveAt acknowledges the request permanently; airState reflects whether
    // the player is CURRENTLY live. Keep those concepts separate.
    if (player.status === "asap") {
      if (!player.asapTakenLiveAt) {
        row.classList.add("calling");
      } else if (player.airState === "live") {
        row.classList.add("taken-live");
      } else {
        row.classList.add("acknowledged");
      }
    }

    // SOON flashes for the first 5.2 seconds of the request, even though rows redraw each second.
    if (player.status === "soon" && player.statusSetAt) {
      const requestAge = Date.now() - Date.parse(player.statusSetAt);
      if (requestAge < SOON_FLASH_MS) row.classList.add("new-call");
    }

    const status = document.createElement("div");
    status.className = "status";
    const baseStatus = key === "asap" ? "ASAP" : key === "soon" ? "SOON" : key === "bk" ? "BK" : "OK";
    // LIVE is derived only from the player's current airState.
    // asapTakenLiveAt only acknowledges that an ASAP request has previously been served.
    status.textContent = player.airState === "live" ? `${baseStatus} LIVE` : baseStatus;

    const identity = document.createElement("div");
    identity.className = "identity";
    const name = document.createElement("div");
    name.className = "player";
    name.textContent = player.name;
    const game = document.createElement("div");
    game.className = "game";
    game.textContent = player.currentGame || "No game selected";
    identity.append(name, game);

    const age = document.createElement("div");
    age.className = "age";
    age.textContent = player.status === "normal" ? "" : ageText(player.statusSetAt);

    row.append(status, identity, age);
    queue.append(row);
  }

  overflow.textContent = "";
}

new BroadcastSocket({
  onOpen: () => { connection.textContent = "LIVE"; },
  onClose: () => { connection.textContent = "DISCONNECTED"; },
  onMessage: (message) => {
    if (message.type === "state.snapshot") {
      latest = message.data;
      if (message.data.compactMode) mode = message.data.compactMode;
      render();
    }
    if (message.type === "compact.mode" && message.data?.mode) {
      mode = message.data.mode;
      render();
    }
  }
});

setInterval(render, 1000);
