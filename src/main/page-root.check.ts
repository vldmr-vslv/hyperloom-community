// Проверка границы браузер-карточки на обычных assert: node src/main/page-root.check.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { byteRange, pageFileIn } from "./page-root.ts";

const root = join("C:", "projects", "site");

// Файлы страницы и её подпапок отдаются.
assert.equal(pageFileIn(root, "/index.html"), join(root, "index.html"));
assert.equal(pageFileIn(root, "/css/main.css"), join(root, "css", "main.css"));
assert.equal(pageFileIn(root, "/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.html"), join(root, "привет.html"));

// Выход из папки не проходит никаким способом записи.
for (const escape of ["/../secret.txt", "/%2e%2e/secret.txt", "/css/../../secret.txt", "/..%5Csecret.txt", "/%2E%2E%2F%2E%2E%2Fwin.ini"]) {
  assert.equal(pageFileIn(root, escape), null, `вышли из папки: ${escape}`);
}

// Сама папка и битая кодировка - не файл страницы.
assert.equal(pageFileIn(root, "/"), null);
assert.equal(pageFileIn(root, "/%E0%A4%A"), null);

// Перемотка видео: кусок файла по Range, как его просит плеер Chromium.
assert.equal(byteRange(null, 100), null, "без Range - файл целиком");
assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
assert.deepEqual(byteRange("bytes=40-59", 100), { start: 40, end: 59 });
assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 }, "конец за файлом обрезается");
assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 }, "последние 10 байт");
assert.equal(byteRange("bytes=100-", 100), "bad", "начало за концом файла");
assert.equal(byteRange("items=0-5", 100), "bad");
assert.equal(byteRange("bytes=-", 100), "bad");

console.log("page-root: все проверки пройдены");
