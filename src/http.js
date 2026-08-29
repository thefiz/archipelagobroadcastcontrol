import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { safeCompare } from "./config.js";

const MIME_TYPES = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg", ".ico":"image/x-icon"
};

function sendJson(res, statusCode, data, { cors = false, head = false } = {}) {
  const headers = { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" };
  if (cors) headers["Access-Control-Allow-Origin"] = "*";
  res.writeHead(statusCode, headers);
  res.end(head ? undefined : JSON.stringify(data));
}

function restoreState(target, previousState) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, previousState);
}

function playerIdFromBearer(req, stateManager) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  for (const [playerId, definition] of stateManager.playerDefinitions) {
    if (safeCompare(token, definition.token)) return playerId;
  }
  return null;
}

function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    req.on("error", reject);
  });
}

export function createHttpServer({ publicDir, stateManager, snapshot, appVersion, wsPath, adminKey, onStateChanged }) {
  function serveStatic(req, res) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch { res.writeHead(400); res.end("Bad request"); return; }
    if (pathname === "/") pathname = "/index.html";
    const resolved = path.resolve(publicDir, `.${pathname}`);
    if (!resolved.startsWith(`${publicDir}${path.sep}`) && resolved !== publicDir) { res.writeHead(403); res.end("Forbidden"); return; }
    fs.stat(resolved, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"}); res.end("Not found"); return; }
      const type = MIME_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream";
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-cache"});
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(resolved).pipe(res);
    });
  }

  return createServer(async (req,res) => {
    const pathname = new URL(req.url,"http://localhost").pathname;

    if (pathname === "/api/player/status" && req.method === "POST") {
      const playerId = playerIdFromBearer(req, stateManager);
      if (!playerId) return sendJson(res,401,{ok:false,error:"Invalid player token."});

      let body;
      try { body = await readJsonBody(req); }
      catch (error) { return sendJson(res,400,{ok:false,error:error.message}); }

      const previousState = structuredClone(stateManager.state);
      const result = stateManager.setPlayerStatus(playerId, body.status);
      if (!result.ok) return sendJson(res,400,result);

      try { stateManager.persist(); }
      catch (error) {
        restoreState(stateManager.state, previousState);
        console.error(error.message);
        return sendJson(res,500,{ok:false,error:"Could not persist server state."});
      }

      onStateChanged?.();
      return sendJson(res,200,{ok:true,player:stateManager.safePlayerState(playerId)});
    }

    if (pathname === "/api/admin/unattended" && req.method === "POST") {
      const authorization = req.headers.authorization;
      const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice(7) : "";
      if (!safeCompare(token, adminKey)) return sendJson(res,401,{ok:false,error:"Invalid admin key."});

      let body;
      try { body = await readJsonBody(req); }
      catch (error) { return sendJson(res,400,{ok:false,error:error.message}); }

      const previousState = structuredClone(stateManager.state);
      const result = stateManager.setUnattendedMode(body.enabled);
      if (!result.ok) return sendJson(res,400,result);

      try { stateManager.persist(); }
      catch (error) {
        restoreState(stateManager.state, previousState);
        console.error(error.message);
        return sendJson(res,500,{ok:false,error:"Could not persist server state."});
      }

      onStateChanged?.();
      return sendJson(res,200,{ok:true,enabled:stateManager.state.unattendedMode});
    }

    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405,{Allow:"GET, HEAD"}); res.end(); return; }
    const head = req.method === "HEAD";
    if (pathname === "/api/config") return sendJson(res,200,stateManager.publicConfig(),{head});
    if (pathname === "/api/state") return sendJson(res,200,snapshot(),{head});
    if (pathname === "/api/unattended") {
      const players = Object.values(stateManager.state.players);
      return sendJson(res,200,{
        enabled:stateManager.state.unattendedMode,
        target:stateManager.state.unattendedTarget || null,
        reason:stateManager.state.unattendedTargetReason || null,
        eligiblePlayers:players.filter((player)=>player.connected && player.rotationActive).map((player)=>({
          id:player.id,name:player.name
        }))
      },{head});
    }
    if (pathname === "/api/lower-thirds") return sendJson(res,200,stateManager.lowerThirdSnapshot(),{cors:true,head});
    if (pathname === "/api/lower-thirds/live") {
      const live = Object.values(stateManager.state.players).find((p)=>p.airState === "live");
      return sendJson(res,200,{eventName:stateManager.state.eventName,generatedAt:new Date().toISOString(),player:live?stateManager.lowerThirdPlayer(live.id):null},{cors:true,head});
    }
    const match = pathname.match(/^\/api\/lower-thirds\/([^/]+)$/);
    if (match) {
      const player = stateManager.lowerThirdPlayer(decodeURIComponent(match[1]));
      if (!player) return sendJson(res,404,{ok:false,error:"Unknown player."},{cors:true,head});
      return sendJson(res,200,{eventName:stateManager.state.eventName,generatedAt:new Date().toISOString(),player},{cors:true,head});
    }
    if (pathname === "/health") return sendJson(res,200,{ok:true,version:appVersion,players:Object.keys(stateManager.state.players).length,websocketPath:wsPath,uptimeSeconds:Math.floor(process.uptime())},{head});
    serveStatic(req,res);
  });
}
