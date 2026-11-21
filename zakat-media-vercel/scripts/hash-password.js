/* Печатает хеш пароля для ADMIN_PASS_HASH. Запуск: npm run hash -- "пароль" */
const { hashPassword } = require("../lib/security");

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Укажите пароль не короче 12 символов: npm run hash -- "ваш длинный пароль"');
  process.exit(1);
}
console.log(hashPassword(password));
