import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ADMIN_KEY, requireSecureAdminKey, safeCompare } from "../src/config.js";

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
