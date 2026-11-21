"use strict";
/* Вся логика сайта в одной функции: принимает запрос в простом виде, возвращает ответ.
   Её вызывают и Vercel (api/index.js), и локальный сервер (dev-server.js). */
const crypto = require("node:crypto");

const { createStore, normalize, SECTIONS } = require("./store");
const view = require("./render");
const sec = require("./security");
const { storage } = require("./storage");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || "";
const MAX_UPLOAD = 600 * 1024;
const MAX_FORM = 200 * 1024;
const store = createStore(storage);
const limiter = sec.createLimiter(storage, { max: 5, ttlSec: 15 * 60 });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const reply = (status, body, headers = {}) => ({
  status, body, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...sec.securityHeaders(), ...headers }
});
const json = (status, obj) => reply(status, JSON.stringify(obj), { "Content-Type": "application/json" });
const redirect = (location, headers = {}) => reply(302, "", { Location: location, ...headers });
const notFound = () => reply(404, view.notFoundPage());

const parseForm = (body) => {
  if (body.length > MAX_FORM) throw new HttpError(413, "Слишком большой запрос");
  return Object.fromEntries(new URLSearchParams(body.toString("utf8")));
};

/* Тип картинки определяется по первым байтам, а не по имени файла или заголовку. */
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}
const IMAGE_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/* Если админка настроена не до конца, вход закрыт. Подробности пишутся в журнал, посетителю общее сообщение. */
function setupProblem() {
  if (!storage.configured) console.warn("Админка отключена: не подключено хранилище Redis (Storage на Vercel).");
  else if (!ADMIN_PASS_HASH) console.warn("Админка отключена: не задана переменная ADMIN_PASS_HASH.");
  else if (!sec.sessionReady()) console.warn("Админка отключена: SESSION_SECRET не задан или короче 32 символов.");
  else return "";
  return "Админка ещё не настроена. Проверьте переменные окружения и подключение хранилища.";
}

async function admin(req, p, url) {
  if (p === "/admin/login") {
    const problem = setupProblem();
    if (req.method === "GET") return reply(problem ? 503 : 200, view.loginPage(problem));
    if (problem) return reply(503, view.loginPage(problem));
    if (await limiter.blocked(req.ip)) return reply(429, view.loginPage("Слишком много попыток. Попробуйте через 15 минут."), { "Retry-After": "900" });
    const form = parseForm(req.body);
    const passOk = sec.verifyPassword(String(form.password || ""), ADMIN_PASS_HASH);
    const userOk = sec.safeEqual(String(form.user || ""), ADMIN_USER);
    if (!(passOk && userOk)) {
      await limiter.hit(req.ip);
      console.warn(`Неудачный вход: ${!userOk ? `логин не совпал с ADMIN_USER (${ADMIN_USER})` : "пароль не подходит к хешу"}`);
      await new Promise((r) => setTimeout(r, 400));
      return reply(401, view.loginPage("Неверный логин или пароль."));
    }
    await limiter.clear(req.ip);
    return redirect("/admin", { "Set-Cookie": sec.createSessionCookie(ADMIN_USER) });
  }

  const session = sec.getSession(req.headers);
  if (!session) return redirect("/admin/login");
  const csrf = session.csrf;

  if (p === "/admin" && req.method === "GET") {
    const status = ["published", "draft"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "";
    const items = (await store.all()).filter((a) => !status || a.status === status);
    const notice = url.searchParams.get("saved") ? "Сохранено." : url.searchParams.get("deleted") ? "Статья удалена." : "";
    return reply(200, view.listPage(items, status, csrf, notice));
  }
  if (p === "/admin/new" && req.method === "GET") return reply(200, view.editorPage(null, csrf));

  if (p === "/admin/backup" && req.method === "GET") {
    return reply(200, await store.exportJson(), { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="articles-backup.json"' });
  }

  const edit = p.match(/^\/admin\/edit\/([a-f0-9]{16})$/);
  if (edit && req.method === "GET") {
    const a = await store.findById(edit[1]);
    return a ? reply(200, view.editorPage(a, csrf)) : notFound();
  }

  if (req.method !== "POST") return notFound();

  if (p === "/admin/upload") {
    if (!sec.csrfOk(session, req.headers["x-csrf-token"])) throw new HttpError(403, "Недействительный токен");
    if (req.body.length > MAX_UPLOAD) return json(413, { error: "Файл больше 600 КБ. Уменьшите картинку." });
    const ext = sniffImage(req.body);
    if (!ext) return json(400, { error: "Нужен файл JPG, PNG или WebP." });
    try {
      return json(200, { path: await store.saveCover(req.body, ext) });
    } catch (err) {
      console.error(err);
      return json(502, { error: "Не удалось сохранить картинку. Попробуйте файл поменьше." });
    }
  }

  const form = parseForm(req.body);
  if (!sec.csrfOk(session, form._csrf)) throw new HttpError(403, "Недействительный токен");

  if (p === "/admin/logout") return redirect("/admin/login", { "Set-Cookie": sec.clearSessionCookie() });

  if (p === "/admin/save") {
    const { article, errors } = normalize({ ...form, status: form.action === "publish" ? "published" : "draft", featured: form.featured === "on" });
    if (errors.length) return reply(400, view.editorPage({ ...article, id: form.id || undefined }, csrf, errors));
    const id = /^[a-f0-9]{16}$/.test(form.id || "") ? form.id : null;
    if (!(await store.upsert(article, id)) && form.id) return notFound();
    return redirect("/admin?saved=1");
  }

  const del = p.match(/^\/admin\/delete\/([a-f0-9]{16})$/);
  if (del) { await store.remove(del[1]); return redirect("/admin?deleted=1"); }

  return notFound();
}

async function route(req) {
  if (!["GET", "HEAD", "POST"].includes(req.method)) throw new HttpError(405, "Метод не поддерживается");
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (p.startsWith("/admin")) return admin(req, p, url);
  if (req.method === "POST") throw new HttpError(404, "Не найдено");

  const cover = p.match(/^\/uploads\/([a-f0-9]{32})\.(jpg|png|webp)$/);
  if (cover) {
    const file = await store.getCover(cover[1], cover[2]);
    if (!file) return notFound();
    return reply(200, file.buffer, { "Content-Type": IMAGE_TYPES[file.ext], "Cache-Control": "public, max-age=31536000, immutable" });
  }

  if (p === "/") {
    const list = await store.published();
    return reply(200, view.homePage(list, list.filter((a) => a.featured)));
  }
  const section = p.match(/^\/section\/([a-z]+)$/);
  if (section) {
    const s = SECTIONS.find((x) => x.slug === section[1]);
    return s ? reply(200, view.sectionPage(s, (await store.published()).filter((a) => a.section === s.slug))) : notFound();
  }
  const article = p.match(/^\/article\/([a-z0-9-]{1,80})$/);
  if (article) {
    const a = await store.findBySlug(article[1]);
    return a ? reply(200, view.articlePage(a)) : notFound();
  }
  return notFound();
}

/* req: { method, url, headers, body (Buffer), ip }. Возвращает { status, headers, body }. */
async function handle(req) {
  try {
    return await route(req);
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, `<p>${view.esc(err.message)}</p>`);
    console.error(err);
    return reply(500, "<p>Ошибка сервера. Попробуйте обновить страницу.</p>");
  }
}

module.exports = { handle };
