export function connectedPlayerSockets(clients, playerId, openState) {
  let count = 0;
  for (const client of clients) {
    if (client.readyState === openState && client.meta?.playerId === playerId) count += 1;
  }
  return count;
}

export function reassignPlayerConnection({ ws, newPlayerId, clients, state, openState }) {
  const previousPlayerId = ws.meta?.playerId || null;
  if (previousPlayerId === newPlayerId) return previousPlayerId;

  ws.meta.playerId = newPlayerId;
  if (previousPlayerId && state.players[previousPlayerId]) {
    state.players[previousPlayerId].connected = connectedPlayerSockets(clients, previousPlayerId, openState) > 0;
  }
  if (newPlayerId && state.players[newPlayerId]) state.players[newPlayerId].connected = true;
  return previousPlayerId;
}
