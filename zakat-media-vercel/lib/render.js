"use strict";
/* HTML-шаблоны. Весь пользовательский текст проходит через esc(). Инлайн-скриптов и стилей нет (запрещены CSP). */
const { SECTIONS, sectionTitle } = require("./store");

const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
const fmtDate = (iso) => iso.split("-").reverse().join(".");
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;800&display=swap"><link rel="stylesheet" href="/static/style.css">`;

/* Текст статьи: пустая строка делит абзацы, строка "## ..." становится подзаголовком. */
function paragraphs(body) {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) =>
    p.startsWith("## ") ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p).replace(/\n/g, "<br>")}</p>`
  ).join("\n");
}

/* ---------- публичный сайт ---------- */
function layout({ title, description = "Закат медиа: музыкальный журнал", content, active = "" }) {
  const nav = SECTIONS.map((s) => `<a href="/section/${s.slug}"${active === s.slug ? ' aria-current="page"' : ""}>${esc(s.title)}</a>`).join("");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">${FONTS}</head><body>
<header class="top"><a class="logo" href="/">ЗАКАТ <span>МЕДИА</span></a>
<nav aria-label="Разделы"><a href="/"${active === "home" ? ' aria-current="page"' : ""}>Главная</a>${nav}</nav></header>
<main>${content}</main>
<footer class="foot">
<p class="online" aria-live="off"><span class="dot" aria-hidden="true"></span>Сейчас на сайте: <b id="online-count">…</b></p>
<p>© Закат медиа</p>
<p class="disclaimer">Счётчик демонстрационный: числа не отражают реальных посетителей сайта.</p></footer>
<script src="/static/counter-model.js" defer></script><script src="/static/counter.js" defer></script></body></html>`;
}

function card(a) {
  const img = a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : `<span class="ph" aria-hidden="true"></span>`;
  return `<article class="card"><a class="card-img" href="/article/${esc(a.slug)}" tabindex="-1" aria-hidden="true">${img}<span class="tag">${esc(sectionTitle(a.section))}</span></a>
<div class="card-body"><h3><a href="/article/${esc(a.slug)}">${esc(a.title)}</a></h3><time datetime="${esc(a.date)}">${fmtDate(a.date)}</time><p>${esc(a.excerpt)}</p></div></article>`;
}

const sideItem = (a) => `<li><span class="mini">${esc(sectionTitle(a.section))}</span><a href="/article/${esc(a.slug)}">${esc(a.title)}</a><p>${esc(a.excerpt)}</p></li>`;

function homePage(latest, featured) {
  const pick = (featured.length ? featured : latest).slice(0, 4);
  return layout({
    title: "Закат медиа", active: "home",
    content: `<div class="cols"><section><h2 class="sec">Последние статьи</h2>${latest.slice(0, 8).map(card).join("") || "<p>Пока нет статей.</p>"}</section>
<aside><h2 class="sec">Выбор читателей</h2><ul class="side">${pick.map(sideItem).join("")}</ul></aside></div>`
  });
}

const sectionPage = (section, list) => layout({
  title: `${section.title}: Закат медиа`, active: section.slug,
  content: `<section class="wide"><h1 class="sec">${esc(section.title)}</h1>${list.map(card).join("") || "<p>В этом разделе пока нет статей.</p>"}</section>`
});

function articlePage(a) {
  const audio = a.audioUrl ? `<audio controls preload="none" src="${esc(a.audioUrl)}"></audio>` : "";
  const cover = a.cover ? `<img class="cover" src="${esc(a.cover)}" alt="">` : "";
  return layout({
    title: `${a.title}: Закат медиа`, description: a.excerpt || undefined, active: a.section,
    content: `<article class="post"><a class="tag-link" href="/section/${esc(a.section)}">${esc(sectionTitle(a.section))}</a>
<h1>${esc(a.title)}</h1><time datetime="${esc(a.date)}">${fmtDate(a.date)}</time>${cover}${audio}${paragraphs(a.body)}</article>`
  });
}

const notFoundPage = () => layout({ title: "Не найдено", content: `<section class="wide"><h1 class="sec">Страница не найдена</h1><p><a href="/">На главную</a></p></section>` });

/* ---------- админ-панель ---------- */
function adminLayout({ title, content, csrf }) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}: админка</title>${FONTS}</head><body class="admin">
<aside class="sidebar"><a class="logo" href="/admin">ЗАКАТ <span>МЕДИА</span></a>
<a href="/admin">Статьи</a><a href="/admin/new">Новая статья</a><a href="/admin/backup">Скачать копию статей</a><a href="/" target="_blank" rel="noopener">Открыть сайт</a>
<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="link" type="submit">Выйти</button></form></aside>
<main class="adm-main">${content}</main><script src="/static/admin.js" defer></script></body></html>`;
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Вход: админка</title>${FONTS}</head>
<body class="admin login"><form class="login-box" method="post" action="/admin/login"><h1>Вход</h1>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<label>Логин<input name="user" autocomplete="username" required></label>
<label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
<button class="btn" type="submit">Войти</button></form></body></html>`;
}

function listPage(items, status, csrf, notice) {
  const tab = (key, label) => `<a class="pill${status === key ? " on" : ""}" href="/admin${key ? `?status=${key}` : ""}">${label}</a>`;
  const rows = items.map((a) => `<tr><td><a href="/admin/edit/${esc(a.id)}">${esc(a.title)}</a></td><td>${esc(sectionTitle(a.section))}</td>
<td><span class="chip ${a.status}">${a.status === "published" ? "Опубликовано" : "Черновик"}</span></td><td>${fmtDate(a.date)}</td>
<td class="acts"><a href="/admin/edit/${esc(a.id)}">Изменить</a>
<form method="post" action="/admin/delete/${esc(a.id)}" data-confirm="Удалить статью?"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="link" type="submit">Удалить</button></form></td></tr>`).join("");
  return adminLayout({
    title: "Статьи", csrf,
    content: `<div class="adm-head"><h1>Статьи</h1><a class="btn" href="/admin/new">Новая статья</a></div>
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ""}
<div class="pills">${tab("", "Все")}${tab("published", "Опубликованные")}${tab("draft", "Черновики")}</div>
<div class="table-wrap"><table><thead><tr><th>Заголовок</th><th>Раздел</th><th>Статус</th><th>Дата</th><th>Действия</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Статей нет.</td></tr>`}</tbody></table></div>`
  });
}

function editorPage(a, csrf, errors = []) {
  const v = a || { title: "", excerpt: "", body: "", section: "news", status: "draft", date: new Date().toISOString().slice(0, 10), cover: "", audioUrl: "", featured: false };
  const options = SECTIONS.map((s) => `<option value="${s.slug}"${v.section === s.slug ? " selected" : ""}>${esc(s.title)}</option>`).join("");
  return adminLayout({
    title: a && a.id ? "Редактор" : "Новая статья", csrf,
    content: `<div class="adm-head"><h1>${a && a.id ? "Редактор" : "Новая статья"}</h1><a href="/admin">К списку статей</a></div>
${errors.length ? `<ul class="error" role="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
<form class="editor" method="post" action="/admin/save"><input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="id" value="${esc(a && a.id)}">
<div class="ed-main">
<label>Заголовок<input name="title" value="${esc(v.title)}" maxlength="150" required></label>
<label>Анонс<textarea name="excerpt" rows="3" maxlength="300">${esc(v.excerpt)}</textarea></label>
<label>Текст<textarea name="body" rows="16" maxlength="50000">${esc(v.body)}</textarea><small>Пустая строка делит абзацы. Строка, начинающаяся с «## », становится подзаголовком.</small></label></div>
<div class="ed-side">
<label>Раздел<select name="section">${options}</select></label>
<label>Дата публикации<input type="date" name="date" value="${esc(v.date)}"></label>
<label>Ссылка на аудио (для радио)<input name="audioUrl" type="url" value="${esc(v.audioUrl)}" placeholder="https://..."></label>
<label class="check"><input type="checkbox" name="featured"${v.featured ? " checked" : ""}> Показывать в «Выборе читателей»</label>
<div class="cover-box"><label>Обложка (JPG, PNG или WebP до 600 КБ)<input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp" data-csrf="${esc(csrf)}"></label>
<input type="hidden" name="cover" id="cover-path" value="${esc(v.cover)}"><img id="cover-preview" alt="" ${v.cover ? `src="${esc(v.cover)}"` : "hidden"}><p id="cover-msg" role="status"></p></div>
<button class="btn" type="submit" name="action" value="publish">Опубликовать</button>
<button class="btn ghost" type="submit" name="action" value="draft">Сохранить черновик</button></div></form>`
  });
}

module.exports = { esc, layout, homePage, sectionPage, articlePage, notFoundPage, loginPage, listPage, editorPage };
