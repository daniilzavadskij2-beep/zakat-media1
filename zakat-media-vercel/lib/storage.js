"use strict";
/* Хранилище ключ-значение. На Vercel это Upstash Redis (через REST), локально обычный файл data/kv.json.
   Интерфейс у всех вариантов одинаковый: get, set, del, incr (счётчик с временем жизни), pushTrim (список копий). */
const fs = require("node:fs");
const path = require("node:path");

function redisStorage(url, token) {
  async function cmd(args) {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
    return data.result;
  }
  return {
    kind: "redis", configured: true,
    get: (key) => cmd(["GET", key]),
    set: (key, value) => cmd(["SET", key, value]),
    del: (key) => cmd(["DEL", key]),
    async incr(key, ttlSec) { const n = await cmd(["INCR", key]); if (n === 1) await cmd(["EXPIRE", key, ttlSec]); return n; },
    async pushTrim(key, value, max) { await cmd(["LPUSH", key, value]); await cmd(["LTRIM", key, 0, max - 1]); }
  };
}

/* Для локальной разработки: всё в одном JSON-файле. */
function fileStorage(file) {
  let data = null;
  const load = () => { if (!data) { try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; } } return data; };
  const persist = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(data)); fs.renameSync(`${file}.tmp`, file); };
  const alive = (e) => e && (!e.exp || e.exp > Date.now());
  return {
    kind: "file", configured: true,
    async get(key) { const e = load()[key]; return alive(e) ? e.v : null; },
    async set(key, value) { load()[key] = { v: value }; persist(); },
    async del(key) { delete load()[key]; persist(); },
    async incr(key, ttlSec) { const e = load()[key]; const n = alive(e) ? e.v + 1 : 1; load()[key] = { v: n, exp: alive(e) ? e.exp : Date.now() + ttlSec * 1000 }; persist(); return n; },
    async pushTrim(key, value, max) { const e = load()[key]; const list = e ? e.v : []; list.unshift(value); load()[key] = { v: list.slice(0, max) }; persist(); }
  };
}

/* На Vercel без подключённого Redis писать некуда: сайт показывает демо-данные, админка отключена. */
function missingStorage() {
  const fail = async () => { throw new Error("Хранилище не подключено"); };
  return { kind: "none", configured: false, get: async () => null, set: fail, del: fail, incr: fail, pushTrim: fail };
}

function createStorage(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStorage(url, token);
  if (env.VERCEL) return missingStorage();
  return fileStorage(path.join(env.DATA_DIR || path.join(__dirname, "..", "data"), "kv.json"));
}

module.exports = { createStorage, storage: createStorage() };
