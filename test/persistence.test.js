import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic, readPersistedState } from "../src/persistence.js";

test("atomic state write produces valid JSON and leaves no temp files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abc-state-"));
  const target = path.join(dir, "state.json");
  writeJsonAtomic(target, { value: 42 });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { value: 42 });
  assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("state write errors are surfaced with context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abc-state-"));
  const blocker = path.join(dir, "not-a-directory");
  fs.writeFileSync(blocker, "x");
  assert.throws(() => writeJsonAtomic(path.join(blocker, "state.json"), {}), /Could not persist state|EEXIST|ENOTDIR/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing persisted state uses fallback", () => {
  assert.deepEqual(readPersistedState("/definitely/not/present/state.json", { clean: true }), { clean: true });
});
