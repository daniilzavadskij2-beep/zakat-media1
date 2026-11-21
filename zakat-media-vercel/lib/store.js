"use strict";
/* Статьи и обложки в хранилище (Redis на Vercel, файл локально). Перед каждым сохранением предыдущая версия уходит в копии. */
const crypto = require("node:crypto");

const SECTIONS = [
  { slug: "interviews", title: "Интервью" },
  { slug: "biographies", title: "Биографии" },
  { slug: "news", title: "Новости" },
  { slug: "radio", title: "Радио" }
];
const sectionTitle = (slug) => (SECTIONS.find((s) => s.slug === slug) || {}).title || slug;
const today = () => new Date().toISOString().slice(0, 10);

const ARTICLES = "zm:articles";
const BACKUPS = "zm:backups";
const KEEP_BACKUPS = 30;

/* Демо-материалы, пока в хранилище ещё ничего не сохранено. Идентификаторы постоянные. */
const SEED = [
  ["interviews", "Демо: интервью с вокалистом группы", true],
  ["interviews", "Демо: как группа записывала альбом", false],
  ["biographies", "Демо: биография артиста", true],
  ["biographies", "Демо: путь к первой большой сцене", false],
  ["news", "Демо: новый сингл вышел на платформах", true],
  ["news", "Демо: анонс осеннего концерта", false],
  ["radio", "Демо: выпуск радио о новых релизах", true],
  ["radio", "Демо: подборка недели", false]
].map(([section, title, featured], i) => ({
  id: crypto.createHash("sha256").update(`demo-${i + 1}`).digest("hex").slice(0, 16),
  slug: `demo-${i + 1}`, title,
  excerpt: "Это демонстрационный материал. Замените его своим текстом в админ-панели.",
  body: "Это демонстрационный материал.\n\nАбзацы разделяются пустой строкой.\n\n## Подзаголовок\n\nСтрока, которая начинается с двух решёток и пробела, становится подзаголовком.",
  section, status: "published", date: `2026-11-0${9 - i}`, cover: "", audioUrl: "", featured
}));

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };

function makeSlug(title, list) {
  const base = title.toLowerCase().split("").map((c) => TRANSLIT[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "article";
  let slug = base, n = 2;
  while (list.some((a) => a.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function createStore(kv) {
  async function readAll() {
    const raw = await kv.get(ARTICLES);
    return raw ? JSON.parse(raw) : SEED.map((a) => ({ ...a }));
  }
  async function writeAll(list) {
    const previous = await kv.get(ARTICLES);
    if (previous) await kv.pushTrim(BACKUPS, previous, KEEP_BACKUPS);
    await kv.set(ARTICLES, JSON.stringify(list));
  }

  return {
    async all() { return (await readAll()).sort(byDateDesc); },
    async published() { return (await this.all()).filter((a) => a.status === "published"); },
    async findById(id) { return (await readAll()).find((a) => a.id === id); },
    async findBySlug(slug) { return (await this.published()).find((a) => a.slug === slug); },

    async upsert(data, id) {
      const list = await readAll();
      if (id) {
        const item = list.find((a) => a.id === id);
        if (!item) return null;
        Object.assign(item, data);
        await writeAll(list);
        return item;
      }
      const item = { id: crypto.randomBytes(8).toString("hex"), slug: makeSlug(data.title, list), ...data };
      list.push(item);
      await writeAll(list);
      return item;
    },

    async remove(id) {
      const list = await readAll();
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return false;
      await writeAll(next);
      return true;
    },

    async exportJson() { return JSON.stringify(await readAll(), null, 2); },

    /* Обложки лежат в хранилище в виде base64. Путь вида /uploads/<32 hex>.<jpg|png|webp>. */
    async saveCover(buffer, ext) {
      const id = crypto.randomBytes(16).toString("hex");
      await kv.set(`zm:cover:${id}`, JSON.stringify({ t: ext, d: buffer.toString("base64") }));
      return `/uploads/${id}.${ext}`;
    },
    async getCover(id, ext) {
      const raw = await kv.get(`zm:cover:${id}`);
      if (!raw) return null;
      const { t, d } = JSON.parse(raw);
      return t === ext ? { buffer: Buffer.from(d, "base64"), ext } : null;
    }
  };
}

/* Проверка и очистка данных формы. Возвращает чистую статью и список ошибок. */
function normalize(raw) {
  const errors = [];
  const text = (v, max) => String(v ?? "").trim().slice(0, max);

  const title = text(raw.title, 150);
  if (title.length < 3) errors.push("Заголовок: минимум 3 символа.");
  const excerpt = text(raw.excerpt, 300);
  const body = String(raw.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 50000);
  const section = SECTIONS.some((s) => s.slug === raw.section) ? raw.section : null;
  if (!section) errors.push("Выберите раздел.");
  const status = raw.status === "published" ? "published" : "draft";

  let date = text(raw.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) date = today();

  const cover = text(raw.cover, 80);
  if (cover && !/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(cover)) errors.push("Некорректная обложка.");

  const audioUrl = text(raw.audioUrl, 300);
  if (audioUrl) {
    try {
      if (!/^https?:$/.test(new URL(audioUrl).protocol)) throw new Error("scheme");
    } catch {
      errors.push("Ссылка на аудио должна начинаться с http:// или https://.");
    }
  }
  if (status === "published" && !body) errors.push("Для публикации нужен текст статьи.");

  return { article: { title, excerpt, body, section, status, date, cover, audioUrl, featured: Boolean(raw.featured) }, errors };
}

module.exports = { SECTIONS, sectionTitle, createStore, normalize };
