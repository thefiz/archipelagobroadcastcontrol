import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ADMIN_KEY, requireSecureAdminKey, safeCompare, validateConfig } from "../src/config.js";

function validConfig() {
  return {
    eventName: "Archipelago Multiworld",
    players: [
      {
        id: "john",
        name: "John",
        token: "john-secret",
        games: ["Super Metroid", "Celeste"],
        startingGame: "Super Metroid"
      }
    ],
    statuses: {
      normal: { label: "Normal", priority: 0, expiresSeconds: 0 },
      soon: { label: "Interesting Soon", priority: 2, expiresSeconds: 120 },
      asap: { label: "Please Show Me ASAP", priority: 3, expiresSeconds: 60 },
      downtime: { label: "Downtime / No Progression", priority: -1, expiresSeconds: 600 }
    }
  };
}

test("ADMIN_KEY must be explicitly set", () => {
  assert.throws(() => requireSecureAdminKey(undefined), /ADMIN_KEY must be set/);
  assert.throws(() => requireSecureAdminKey(DEFAULT_ADMIN_KEY), /ADMIN_KEY must be set/);
  assert.equal(requireSecureAdminKey("a-real-secret"), "a-real-secret");
});

test("safeCompare rejects mismatched or non-string credentials", () => {
  assert.equal(safeCompare("secret", "secret"), true);
  assert.equal(safeCompare("secret", "wrong"), false);
  assert.equal(safeCompare("short", "much-longer"), false);
  assert.equal(safeCompare(null, "secret"), false);
});

test("valid configuration passes validation", () => {
  const config = validConfig();
  assert.equal(validateConfig(config), config);
});

test("configuration rejects duplicate player ids and tokens", () => {
  const duplicateId = validConfig();
  duplicateId.players.push({ ...duplicateId.players[0], token: "different-secret" });
  assert.throws(() => validateConfig(duplicateId), /Duplicate player id "john"/);

  const duplicateToken = validConfig();
  duplicateToken.players.push({
    id: "jane", name: "Jane", token: "john-secret", games: ["TUNIC"], startingGame: "TUNIC"
  });
  assert.throws(() => validateConfig(duplicateToken), /same token as another player/);
});

test("configuration rejects invalid game assignments", () => {
  const noGames = validConfig();
  noGames.players[0].games = [];
  assert.throws(() => validateConfig(noGames), /at least one assigned game/);

  const badStart = validConfig();
  badStart.players[0].startingGame = "TUNIC";
  assert.throws(() => validateConfig(badStart), /startingGame "TUNIC".*not assigned/);
});

test("configuration requires the statuses used by production views", () => {
  const config = validConfig();
  delete config.statuses.asap;
  assert.throws(() => validateConfig(config), /missing required status "asap"/);
});

test("configuration validates status fields", () => {
  const badExpiry = validConfig();
  badExpiry.statuses.soon.expiresSeconds = -1;
  assert.throws(() => validateConfig(badExpiry), /expiresSeconds must be a non-negative number/);

  const badPriority = validConfig();
  badPriority.statuses.asap.priority = "high";
  assert.throws(() => validateConfig(badPriority), /priority must be a number/);
});
