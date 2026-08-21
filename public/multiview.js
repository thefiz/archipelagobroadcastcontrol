import { priorityClass, statusClass } from "./common.js";
import { BroadcastSocket } from "./ws-client.js";

const multiview = document.querySelector("#multiview");

function render(snapshot) {
  multiview.replaceChildren();

  for (const player of snapshot.players) {
    const tile = document.createElement("article");
    tile.className = `tile ${priorityClass(player.statusDefinition.priority)}`;

    if (player.status !== "normal") {
      const status = document.createElement("span");
      status.className = `badge tile-status ${statusClass(player.status)}`;
      status.textContent = player.statusDefinition.label;
      tile.append(status);
    }

    if (player.airState !== "off") {
      const air = document.createElement("span");
      air.className = `badge tile-air ${player.airState}`;
      air.textContent = player.airState === "live" ? "LIVE" : "STANDBY";
      tile.append(air);
    }

    const label = document.createElement("div");
    label.className = "tile-label";
    const name = document.createElement("div");
    name.className = "tile-name";
    name.textContent = player.name;
    const game = document.createElement("div");
    game.className = "tile-game";
    game.textContent = player.currentGame;
    label.append(name, game);

    tile.append(label);
    multiview.append(tile);
  }
}

new BroadcastSocket({
  onMessage: (message) => {
    if (message.type === "state.snapshot") render(message.data);
  }
});
