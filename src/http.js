import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";

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

export function createHttpServer({ publicDir, stateManager, snapshot, appVersion, wsPath }) {
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

  return createServer((req,res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405,{Allow:"GET, HEAD"}); res.end(); return; }
    const pathname = new URL(req.url,"http://localhost").pathname;
    const head = req.method === "HEAD";
    if (pathname === "/api/config") return sendJson(res,200,stateManager.publicConfig(),{head});
    if (pathname === "/api/state") return sendJson(res,200,snapshot(),{head});
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
