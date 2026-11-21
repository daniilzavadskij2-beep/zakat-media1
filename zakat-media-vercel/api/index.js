"use strict";
/* Точка входа для Vercel: все адреса сайта (кроме /static/...) приходят сюда через vercel.json. */
const { handle } = require("../lib/handler");
const { clientIp } = require("../lib/security");

/* Читает тело запроса. Сначала из потока, а если Vercel уже разобрал его, то из req.body. */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  if (body.length === 0 && req.method === "POST" && req.body != null) {
    if (Buffer.isBuffer(req.body)) body = req.body;
    else if (typeof req.body === "string") body = Buffer.from(req.body);
    else body = Buffer.from(new URLSearchParams(req.body).toString());
  }
  return body;
}

module.exports = async (req, res) => {
  const body = await readBody(req);
  const out = await handle({ method: req.method, url: req.url, headers: req.headers, body, ip: clientIp(req.headers, req.socket && req.socket.remoteAddress) });
  res.statusCode = out.status;
  for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
  res.end(out.body);
};
