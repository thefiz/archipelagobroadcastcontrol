import crypto from "node:crypto";
import fs from "node:fs";

export const DEFAULT_ADMIN_KEY = "change-me-before-the-event";

export function loadJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing config.json. Copy config.example.json to config.json and edit it.");
  }
  const config = loadJson(configPath);
  if (!config || !Array.isArray(config.players) || !config.statuses) {
    throw new Error("config.json must define players and statuses.");
  }
  return config;
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
