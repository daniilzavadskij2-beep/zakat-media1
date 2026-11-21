"use strict";
/* Проверка защиты и основных сценариев в двух режимах: локальный файл и Redis (имитация Upstash, как на Vercel). Запуск: npm test */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { hashPassword } = require("../lib/security");

const PASSWORD = "correct horse battery";
const HASH = hashPassword(PASSWORD);
const SECRET = "a".repeat(40);
const ROOT = path.join(__dirname, "..");

/* Мини-копия Upstash REST: принимает команды Redis в виде JSON-массива. */
function fakeRedis() {
  const values = new Map(), lists = new Map();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer test-token") { res.writeHead(401); return res.end(JSON.stringify({ error: "unauthorized" })); }
      const [cmd, key, a, b] = JSON.parse(raw);
      let result = null;
      if (cmd === "GET") result = values.has(key) ? values.get(key) : null;
      else if (cmd === "SET") { values.set(key, a); result = "OK"; }
      else if (cmd === "DEL") { result = values.delete(key) ? 1 : 0; }
      else if (cmd === "INCR") { result = (Number(values.get(key)) || 0) + 1; values.set(key, String(result)); }
      else if (cmd === "EXPIRE") result = 1;
      else if (cmd === "LPUSH") { const l = lists.get(key) || []; l.unshift(a); lists.set(key, l); result = l.length; }
      else if (cmd === "LTRIM") { lists.set(key, (lists.get(key) || []).slice(a, b + 1)); result = "OK"; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
    });
  });
  return { server, values, lists };
}

async function start(port, env) {
  const proc = spawn(process.execPath, ["dev-server.js"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: port, NODE_ENV: "test", ...env } });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); return proc; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("сервер не запустился");
}

function suite(label, port) {
  const mode = label.startsWith("redis") ? "redis" : "file";
  const viaApi = label.includes("api/index");
  describe(`режим: ${label}`, () => {
    const BASE = `http://127.0.0.1:${port}`;
    let proc, dir, redis, cookie = "", csrf = "";
    const form = (obj) => new URLSearchParams(obj).toString();
    const post = (url, body, headers = {}) => fetch(BASE + url, { method: "POST", redirect: "manual", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, ...headers } });
    const login = () => post("/admin/login", form({ user: "admin", password: PASSWORD }));

    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "zakat-"));
      const env = { ADMIN_USER: "admin", ADMIN_PASS_HASH: HASH, SESSION_SECRET: SECRET, DATA_DIR: dir };
      if (mode === "redis") {
        redis = fakeRedis();
        await new Promise((r) => redis.server.listen(0, "127.0.0.1", r));
        env.KV_REST_API_URL = `http://127.0.0.1:${redis.server.address().port}`;
        env.KV_REST_API_TOKEN = "test-token";
      }
      if (viaApi) env.USE_VERCEL_ADAPTER = "1";
      proc = await start(port, env);
    });
    after(() => { proc.kill(); if (redis) redis.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    test("главная: заголовки безопасности и подпись под счётчиком", async () => {
      const res = await fetch(BASE + "/");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.match(await res.text(), /Счётчик демонстрационный: числа не отражают реальных посетителей/);
    });

    test("четыре раздела и демо-статья открываются", async () => {
      for (const s of ["interviews", "biographies", "news", "radio"]) assert.equal((await fetch(`${BASE}/section/${s}`)).status, 200, s);
      assert.equal((await fetch(`${BASE}/article/demo-1`)).status, 200);
    });

    test("админка и копия статей без входа закрыты", async () => {
      for (const p of ["/admin", "/admin/new", "/admin/backup"]) {
        const res = await fetch(BASE + p, { redirect: "manual" });
        assert.equal(res.status, 302, p);
        assert.equal(res.headers.get("location"), "/admin/login");
      }
    });

    test("вход, CSRF, XSS, обложка, копии и подделка куки", async () => {
      const res = await login();
      assert.equal(res.status, 302);
      const setCookie = res.headers.getSetCookie()[0];
      assert.match(setCookie, /HttpOnly; SameSite=Strict/);
      cookie = setCookie.split(";")[0];

      csrf = (await (await fetch(BASE + "/admin", { headers: { Cookie: cookie } })).text()).match(/name="_csrf" value="([a-f0-9]+)"/)[1];

      const payload = { title: "<script>alert(1)</script> Тест", excerpt: "x", body: "текст", section: "news", action: "publish", date: "2026-11-09" };
      assert.equal((await post("/admin/save", form(payload))).status, 403, "без CSRF-токена запрос должен отклоняться");
      assert.equal((await post("/admin/save", form({ ...payload, _csrf: csrf }))).status, 302);
      assert.equal((await post("/admin/save", form({ ...payload, title: "Второй тест", _csrf: csrf }))).status, 302);

      const news = await (await fetch(BASE + "/section/news")).text();
      assert.ok(news.includes("&lt;script&gt;alert(1)"), "заголовок должен быть экранирован");
      assert.ok(!news.includes("<script>alert(1)"), "сырой скрипт не должен попасть в страницу");

      const backup = await fetch(BASE + "/admin/backup", { headers: { Cookie: cookie } });
      assert.equal(backup.status, 200);
      assert.ok(JSON.parse(await backup.text()).some((a) => a.title === "Второй тест"));
      if (redis) assert.ok((redis.lists.get("zm:backups") || []).length >= 1, "перед сохранением должна создаваться копия");

      const upload = (body, headers = {}) => fetch(BASE + "/admin/upload", { method: "POST", body, headers: { Cookie: cookie, "X-CSRF-Token": csrf, ...headers } });
      assert.equal((await upload(Buffer.from("это не картинка, а текст в 20+ байт"))).status, 400);
      assert.equal((await upload(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(700 * 1024)]))).status, 413);
      const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32, 7)]);
      const ok = await upload(png);
      assert.equal(ok.status, 200);
      const coverPath = (await ok.json()).path;
      assert.match(coverPath, /^\/uploads\/[a-f0-9]{32}\.png$/);
      const served = await fetch(BASE + coverPath);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
      assert.equal((await fetch(BASE + "/admin/upload", { method: "POST", body: png, headers: { Cookie: cookie } })).status, 403);

      const [payloadPart] = cookie.split("=")[1].split(".");
      const forged = `${cookie.split("=")[0]}=${payloadPart}.${"A".repeat(43)}`;
      const res2 = await fetch(BASE + "/admin", { redirect: "manual", headers: { Cookie: forged } });
      assert.equal(res2.status, 302, "подделанная кука должна отклоняться");
    });

    test("после 5 неверных паролей вход блокируется", async () => {
      cookie = "";
      let last;
      for (let i = 0; i < 6; i++) last = await post("/admin/login", form({ user: "admin", password: "wrong" + i }));
      assert.equal(last.status, 429);
      assert.equal((await login()).status, 429, "даже верный пароль не пускает, пока действует блокировка");
    });
  });
}

suite("файл (локальная разработка)", 3991);
suite("redis (как на Vercel)", 3992);
suite("redis через api/index.js (точка входа Vercel)", 3994);

describe("Vercel без подключённого Redis", () => {
  let proc;
  before(async () => { proc = await start(3993, { VERCEL: "1", ADMIN_USER: "admin", ADMIN_PASS_HASH: HASH, SESSION_SECRET: SECRET, KV_REST_API_URL: "", KV_REST_API_TOKEN: "" }); });
  after(() => proc.kill());
  test("сайт показывает демо, а вход в админку закрыт", async () => {
    assert.equal((await fetch("http://127.0.0.1:3993/")).status, 200);
    const res = await fetch("http://127.0.0.1:3993/admin/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user: "admin", password: PASSWORD }).toString() });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});
