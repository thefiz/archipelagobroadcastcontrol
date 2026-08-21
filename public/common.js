export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function formatAge(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function statusClass(status) {
  return ["asap", "soon", "downtime"].includes(status) ? status : "";
}

export function priorityClass(priority) {
  return `priority-${priority}`;
}

export function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const liveDifference = Number(b.airState === "live") - Number(a.airState === "live");
    if (liveDifference) return liveDifference;
    const priorityDifference =
      (b.statusDefinition?.priority || 0) - (a.statusDefinition?.priority || 0);
    if (priorityDifference) return priorityDifference;
    return a.name.localeCompare(b.name);
  });
}
