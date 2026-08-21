import { qs } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const playerId = qs("id");
const showStatus = qs("status") !== "0";
const box = document.querySelector("#box");
const playerName = document.querySelector("#player");
const game = document.querySelector("#game");
const status = document.querySelector("#status");

new BroadcastSocket({
  onMessage: (message) => {
    if (message.type !== "state.snapshot") return;
    const player = message.data.players.find((entry) => entry.id === playerId);
    if (!player) return;

    playerName.textContent = player.name;
    game.textContent = player.currentGame;
    status.textContent = showStatus && player.status !== "normal" ? player.statusDefinition.label : "";
    box.classList.remove("hidden");
  }
});
