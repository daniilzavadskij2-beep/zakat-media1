/* Первичная настройка: спрашивает логин и пароль, создаёт локальный .env и печатает значения для Vercel.
   Запуск: npm run setup */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { hashPassword } = require("../lib/security");

const envFile = path.join(__dirname, "..", ".env");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => { process.stdout.write(q); const { value } = await lines.next(); return (value || "").replace(/\r$/, ""); };

(async () => {
  if (fs.existsSync(envFile)) {
    const answer = (await ask("Файл .env уже есть. Перезаписать? (да/нет): ")).trim().toLowerCase();
    if (answer !== "да" && answer !== "y") { console.log("Отменено, .env не изменён."); return rl.close(); }
  }
  const user = (await ask("Логин для входа [admin]: ")).trim() || "admin";
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(user)) { console.error("Логин: от 3 до 32 латинских букв, цифр, точки, дефиса или подчёркивания."); process.exitCode = 1; return rl.close(); }
  const password = await ask("Пароль (не короче 12 символов): ");
  if (password.length < 12) { console.error("Пароль слишком короткий: нужно минимум 12 символов."); process.exitCode = 1; return rl.close(); }

  const hash = hashPassword(password);
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(envFile, `PORT=3000\nADMIN_USER=${user}\nADMIN_PASS_HASH=${hash}\nSESSION_SECRET=${secret}\n`);
  console.log("\nГотово. Файл .env создан для локального запуска: npm run dev");
  console.log("\nДля Vercel добавьте эти три переменные (Settings, Environment Variables):");
  console.log(`ADMIN_USER=${user}\nADMIN_PASS_HASH=${hash}\nSESSION_SECRET=${secret}`);
  rl.close();
})();
