import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const TEST_CONFIG = {
  eventName: "Integration Test",
  statuses: {
    normal: { label: "Normal", priority: 0, expiresSeconds: 0 },
    soon: { label: "Interesting Soon", priority: 2, expiresSeconds: 120 },
    asap: { label: "Please Show Me ASAP", priority: 3, expiresSeconds: 60 },
    downtime: { label: "Downtime / No Progression", priority: -1, expiresSeconds: 600 }
  },
  players: [
    { id: "john", name: "John", token: "john-token", games: ["Super Metroid", "TUNIC"], startingGame: "Super Metroid" },
    { id: "jane", name: "Jane", token: "jane-token", games: ["Celeste"], startingGame: "Celeste" }
  ]
};

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message."));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onMessage(raw) {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); }
      catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function openWebSocket(url) {
  const ws = new WebSocket(url);
  await once(ws, "open");
  return ws;
}

async function closeWebSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = once(ws, "close");
  ws.close();
  await closed;
}

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archipelago-integration-"));
  const configPath = path.join(tempDir, "config.json");
  const statePath = path.join(tempDir, "data", "state.json");
  fs.writeFileSync(configPath, `${JSON.stringify(TEST_CONFIG, null, 2)}\n`);
  const port = await freePort();

  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CONFIG_PATH: configPath,
      STATE_PATH: statePath,
      ADMIN_KEY: "integration-admin-key"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 5000);
    function onData() {
      if (!stdout.includes("running at")) return;
      cleanup();
      resolve();
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`Server exited before becoming ready (code ${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }
    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.on("exit", onExit);
    onData();
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async stop() {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function withServer(fn) {
  const server = await startServer();
  try { return await fn(server); }
  finally { await server.stop(); }
}

test("HTTP health and state endpoints reflect a running server", async () => {
  await withServer(async ({ baseUrl }) => {
    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.version, PACKAGE.version);
    assert.equal(health.players, 2);
    assert.equal(health.websocketPath, "/ws");

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.eventName, "Integration Test");
    assert.equal(state.players.length, 2);
    assert.equal(state.players.find((player) => player.id === "john").currentGame, "Super Metroid");
  });
});

test("player WebSocket authentication and status change broadcast a snapshot", async () => {
  await withServer(async ({ baseUrl, wsUrl }) => {
    const ws = await openWebSocket(wsUrl);
    try {
      const authAck = waitForMessage(ws, (message) => message.type === "ack" && message.requestId === "auth");
      ws.send(JSON.stringify({ type: "auth.player", requestId: "auth", data: { playerId: "john", token: "john-token" } }));
      assert.equal((await authAck).data.ok, true);

      const snapshot = waitForMessage(ws, (message) =>
        message.type === "state.snapshot" &&
        message.data.players.some((player) => player.id === "john" && player.status === "asap")
      );
      const statusAck = waitForMessage(ws, (message) => message.type === "ack" && message.requestId === "status");
      ws.send(JSON.stringify({ type: "player.status", requestId: "status", data: { status: "asap" } }));

      assert.equal((await statusAck).data.ok, true);
      const stateMessage = await snapshot;
      const john = stateMessage.data.players.find((player) => player.id === "john");
      assert.equal(john.status, "asap");
      assert.equal(john.connected, true);

      const state = await (await fetch(`${baseUrl}/api/state`)).json();
      assert.equal(state.players.find((player) => player.id === "john").status, "asap");
    } finally {
      await closeWebSocket(ws);
    }
  });
});

test("admin live changes enforce a single live player", async () => {
  await withServer(async ({ baseUrl, wsUrl }) => {
    const ws = await openWebSocket(wsUrl);
    try {
      const authAck = waitForMessage(ws, (message) => message.type === "ack" && message.requestId === "auth");
      ws.send(JSON.stringify({ type: "auth.admin", requestId: "auth", data: { key: "integration-admin-key" } }));
      assert.equal((await authAck).data.ok, true);

      for (const playerId of ["john", "jane"]) {
        const requestId = `live-${playerId}`;
        const ack = waitForMessage(ws, (message) => message.type === "ack" && message.requestId === requestId);
        ws.send(JSON.stringify({ type: "admin.player.air", requestId, data: { playerId, airState: "live" } }));
        assert.equal((await ack).data.ok, true);
      }

      const state = await (await fetch(`${baseUrl}/api/state`)).json();
      assert.equal(state.players.find((player) => player.id === "john").airState, "off");
      assert.equal(state.players.find((player) => player.id === "jane").airState, "live");
      assert.equal(state.players.filter((player) => player.airState === "live").length, 1);
    } finally {
      await closeWebSocket(ws);
    }
  });
});
