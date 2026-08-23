import crypto from "node:crypto";
import fs from "node:fs";

export const DEFAULT_ADMIN_KEY = "change-me-before-the-event";
const REQUIRED_STATUSES = ["normal", "soon", "asap", "downtime"];

export function loadJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePlayer(player, index, playerIds, playerTokens) {
  const label = `players[${index}]`;
  if (!player || typeof player !== "object" || Array.isArray(player)) {
    throw new Error(`${label} must be an object.`);
  }
  if (!nonEmptyString(player.id)) throw new Error(`${label}.id must be a non-empty string.`);
  if (playerIds.has(player.id)) throw new Error(`Duplicate player id "${player.id}".`);
  playerIds.add(player.id);

  if (!nonEmptyString(player.name)) throw new Error(`Player "${player.id}" must have a non-empty name.`);
  if (!nonEmptyString(player.token)) throw new Error(`Player "${player.id}" must have a non-empty token.`);
  if (playerTokens.has(player.token)) throw new Error(`Player "${player.id}" uses the same token as another player.`);
  playerTokens.add(player.token);

  if (!Array.isArray(player.games) || player.games.length === 0) {
    throw new Error(`Player "${player.id}" must have at least one assigned game.`);
  }
  const games = new Set();
  for (const game of player.games) {
    if (!nonEmptyString(game)) throw new Error(`Player "${player.id}" has an invalid game name.`);
    if (games.has(game)) throw new Error(`Player "${player.id}" has duplicate game "${game}".`);
    games.add(game);
  }
  if (player.startingGame !== undefined) {
    if (!nonEmptyString(player.startingGame)) throw new Error(`Player "${player.id}" has an invalid startingGame.`);
    if (!games.has(player.startingGame)) {
      throw new Error(`Player "${player.id}" has startingGame "${player.startingGame}", but that game is not assigned to the player.`);
    }
  }
}

function validateStatus(statuses, key) {
  const status = statuses[key];
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error(`statuses.${key} must be an object.`);
  }
  if (!nonEmptyString(status.label)) throw new Error(`statuses.${key}.label must be a non-empty string.`);
  if (!Number.isFinite(status.priority)) throw new Error(`statuses.${key}.priority must be a number.`);
  if (!Number.isFinite(status.expiresSeconds) || status.expiresSeconds < 0) {
    throw new Error(`statuses.${key}.expiresSeconds must be a non-negative number.`);
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config.json must contain a JSON object.");
  }
  if (!nonEmptyString(config.eventName)) throw new Error("config.json must define a non-empty eventName.");
  if (!Array.isArray(config.players) || config.players.length === 0) {
    throw new Error("config.json must define at least one player.");
  }
  if (!config.statuses || typeof config.statuses !== "object" || Array.isArray(config.statuses)) {
    throw new Error("config.json must define statuses.");
  }

  for (const key of REQUIRED_STATUSES) {
    if (!Object.hasOwn(config.statuses, key)) throw new Error(`config.json is missing required status "${key}".`);
  }
  for (const key of Object.keys(config.statuses)) validateStatus(config.statuses, key);

  const playerIds = new Set();
  const playerTokens = new Set();
  config.players.forEach((player, index) => validatePlayer(player, index, playerIds, playerTokens));
  return config;
}

export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing config.json. Copy config.example.json to config.json and edit it.");
  }
  return validateConfig(loadJson(configPath));
}

export function requireSecureAdminKey(value) {
  if (!value || value === DEFAULT_ADMIN_KEY) {
    throw new Error("ADMIN_KEY must be set to a non-default value before the server can start.");
  }
  return value;
}

export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
