"use strict";
/* Защита: пароли (scrypt), сессии в подписанной куке (без хранения на сервере), CSRF, лимит входа, заголовки. */
const crypto = require("node:crypto");

const IS_PROD = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
const TRUST_PROXY = IS_PROD && (Boolean(process.env.VERCEL) || process.env.TRUST_PROXY === "1");
const SCRYPT = { N: 16384, r: 8, p: 1 };

/* ---------- пароли ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${crypto.scryptSync(password, salt, 64, SCRYPT).toString("base64")}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  if (salt.length < 8 || expected.length < 16) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, expected.length, SCRYPT), expected);
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ---------- сессия: данные лежат в самой куке и подписаны ключом SESSION_SECRET ---------- */
const SESSION_TTL = 2 * 60 * 60 * 1000;
const COOKIE = IS_PROD ? "__Host-sid" : "sid";
const SECRET = (process.env.SESSION_SECRET || "").length >= 32 ? process.env.SESSION_SECRET : (IS_PROD ? "" : crypto.randomBytes(32).toString("hex"));
const sessionReady = () => SECRET.length >= 32;
const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

function parseCookies(headers) {
  const out = {};
  for (const part of String(headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookieHeader = (value, maxAgeSec) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${IS_PROD ? "; Secure" : ""}`;

function createSessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, c: crypto.randomBytes(24).toString("hex"), e: Date.now() + SESSION_TTL })).toString("base64url");
  return cookieHeader(`${payload}.${sign(payload)}`, SESSION_TTL / 1000);
}

function getSession(headers) {
  const raw = parseCookies(headers)[COOKIE];
  if (!raw || !sessionReady()) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.e > Date.now() ? { user: data.u, csrf: data.c } : null;
  } catch { return null; }
}

const clearSessionCookie = () => cookieHeader("", 0);
const csrfOk = (session, token) => Boolean(session && token && safeEqual(session.csrf, token));

/* ---------- лимит неудачных попыток входа (счётчик хранится в Redis, поэтому работает на всех копиях сервера) ---------- */
function createLimiter(kv, { max, ttlSec }) {
  const key = (ip) => `zm:rl:login:${ip}`;
  return {
    async blocked(ip) { return (Number(await kv.get(key(ip))) || 0) >= max; },
    hit: (ip) => kv.incr(key(ip), ttlSec),
    clear: (ip) => kv.del(key(ip))
  };
}

function clientIp(headers, socketAddress) {
  if (TRUST_PROXY) {
    const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return socketAddress || "unknown";
}

function securityHeaders() {
  const h = {
    "Content-Security-Policy": ["default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com", "img-src 'self' data:", "media-src 'self' https:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin"
  };
  if (IS_PROD) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}

module.exports = { IS_PROD, hashPassword, verifyPassword, safeEqual, sessionReady, createSessionCookie, getSession, clearSessionCookie, csrfOk, createLimiter, clientIp, securityHeaders };
