// Проверки скрытия секретов в тексте, который уходит агенту. Обычные assert, без тестового фреймворка.
import { strict as assert } from "node:assert";
import { hideSecrets } from "./secrets.ts";

const H = "<скрыто>";

// Строка входа в Telegram из вывода aggrgtr: её печатают для .env.
assert.equal(
  hideSecrets("Готово. Добавьте в .env:\nTG_SESSION=1BQANOTg3YmFkLWJhc2U2NC1zZXNzaW9u\nдальше"),
  `Готово. Добавьте в .env:\nTG_SESSION=${H}\nдальше`,
);
assert.equal(hideSecrets("API_KEY: abc"), `API_KEY: ${H}`);
assert.equal(hideSecrets("Authorization: Bearer x.y.z"), `Authorization: Bearer ${H}`);
assert.equal(hideSecrets("curl -H 'authorization: bearer abc123'"), `curl -H 'authorization: bearer ${H}'`);
assert.equal(hideSecrets(`$env:API_KEY="abc"; npm test`), `$env:API_KEY="${H}"; npm test`);
assert.equal(hideSecrets(`$env:API_KEY = "abc"`), `$env:API_KEY = "${H}"`);
assert.equal(hideSecrets("TOKEN: Bearer abc"), `TOKEN: ${H}`);
// Решение Влада: значение без кавычек скрывается до конца строки, хвост после пробела и запятой не уходит.
assert.equal(hideSecrets("TOKEN=abc def\nдальше"), `TOKEN=${H}\nдальше`);
assert.equal(hideSecrets("JWT_SECRET=a,b\r\nдальше"), `JWT_SECRET=${H}\r\nдальше`);
// Скобка после значения остаётся: JSON и код уходят агенту целыми.
assert.equal(hideSecrets(`{"password": 12345}`), `{"password": ${H}}`);
assert.equal(hideSecrets("f(token=abc) [key=x]"), `f(token=${H}) [key=${H}]`);

// Любой регистр, приставки и хвосты у имени, все слова из списка.
for (const name of ["token", "GITHUB_TOKEN", "db_password", "SMTP_PASS", "client-secret", "Session.Key", "apiKey", "APIKey"]) {
  assert.equal(hideSecrets(`${name}=v4lue`), `${name}=${H}`, name);
}
// Значение в кавычках скрывается целиком, кавычки остаются.
assert.equal(hideSecrets(`"api_key": "a b c",`), `"api_key": "${H}",`);
assert.equal(hideSecrets("export SECRET='x y'"), `export SECRET='${H}'`);
// Адрес: значение кончается на &, следующий параметр цел.
assert.equal(hideSecrets("?access_token=abc&page=2"), `?access_token=${H}&page=2`);

// Решение: KEY должен быть отдельным словом имени, KEYBOARD и MONKEY - не секреты.
assert.equal(hideSecrets("KEYBOARD=us"), "KEYBOARD=us");
assert.equal(hideSecrets("MONKEY=1 PASSPORT: x"), "MONKEY=1 PASSPORT: x");
// Решение Влада: PWD не в списке, в выводе env это текущая папка.
assert.equal(hideSecrets("PWD=/home/u"), "PWD=/home/u");
// Обычный текст и пустое значение не трогаются; значение не берётся со следующей строки.
const plain = "npm ERR! code 1\nТест упал: ожидалось 3, пришло 4\nсравнение token == other";
assert.equal(hideSecrets(plain), plain);
assert.equal(hideSecrets("TOKEN=\nследующая"), "TOKEN=\nследующая");

console.log("secrets: все проверки пройдены");
