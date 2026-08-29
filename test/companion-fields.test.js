import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanionFields } from "../src/companion.js";

test("Companion fields use stable player-id keys", () => {
  const fields = buildCompanionFields({
    andy: {
      id: "andy",
      status: "asap",
      airState: "live",
      currentGame: "A Link to the Past",
      connected: true
    },
    bird650: {
      id: "bird650",
      status: "soon",
      airState: "off",
      currentGame: "Pokemon Emerald",
      connected: false
    }
  });

  assert.deepEqual(fields, {
    andy_status: "asap",
    andy_air: "live",
    andy_game: "A Link to the Past",
    andy_connected: true,
    andy_rotationActive: false,
    bird650_status: "soon",
    bird650_air: "off",
    bird650_game: "Pokemon Emerald",
    bird650_connected: false,
    bird650_rotationActive: false
  });
});
