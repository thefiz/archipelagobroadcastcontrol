export function buildCompanionFields(players) {
  const fields = {};
  for (const player of Object.values(players)) {
    const id = player.id;
    fields[`${id}_status`] = player.status;
    fields[`${id}_air`] = player.airState;
    fields[`${id}_game`] = player.currentGame || "";
    fields[`${id}_connected`] = Boolean(player.connected);
    fields[`${id}_rotationActive`] = Boolean(player.rotationActive);
  }
  return fields;
}
