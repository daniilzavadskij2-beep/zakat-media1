"use strict";
/* Локальный сервер для проверки: те же страницы, что на Vercel, данные в файле data/kv.json. Запуск: npm run dev */
try { process.loadEnvFile(); } catch { /* .env необязателен */ }

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { handle } = require("./lib/handler");
const { clientIp } = require("./lib/security");

const PORT = Number(process.env.PORT) || 3000;
const STATIC_DIR = path.join(__dirname, "public", "static");
const TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/static/")) { // на Vercel эти файлы отдаёт сам Vercel
    let rel = "";
    try { rel = decodeURIComponent(url.pathname.slice(8)); } catch { /* 404 ниже */ }
    const file = path.resolve(STATIC_DIR, rel);
    const type = TYPES[path.extname(file)];
    if (file.startsWith(STATIC_DIR + path.sep) && type && fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404); return res.end("Not found");
  }
  if (process.env.USE_VERCEL_ADAPTER === "1") return require("./api/index.js")(req, res); // проверка в тестах: тот же вход, что на Vercel
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
  const out = await handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks), ip: clientIp(req.headers, req.socket.remoteAddress) });
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}).listen(PORT, () => console.log(`Закат медиа (локально): http://localhost:${PORT}`));
