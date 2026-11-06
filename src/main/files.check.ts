// Проверка чтения файла для агента на обычных assert: node src/main/files.check.ts
// Файлы настоящие, во временном каталоге: читается диск, и подделывать его значило бы
// проверять подделку.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { isFile, readFileCard, writeFileCard } from "./files.ts";

const folder = await mkdtemp(join(tmpdir(), "hyperloom-files-"));

try {

  // Карточка файла: текст, в том числе markdown, едет в редактор целиком; двоичный - нет.
  {
    const file = join(folder, "page.html");
    await writeFile(file, "<h1>Привет</h1>\r\n", "utf8");
    assert.deepEqual((await readFileCard(null, file))?.preview, { kind: "text", text: "<h1>Привет</h1>\r\n" });
    await writeFile(join(folder, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
    assert.deepEqual((await readFileCard(null, join(folder, "logo.png")))?.preview.kind, "image");
    const blob = join(folder, "data.bin");
    await writeFile(blob, Buffer.from([1, 2, 0, 3]));
    assert.deepEqual((await readFileCard(null, blob))?.preview, { kind: "other" });
  }

  // Запись из редактора: существующий файл переписывается, нового файла запись не заводит.
  {
    const file = join(folder, "page.html");
    assert.equal(await writeFileCard(null, file, "<p>новое</p>"), true);
    assert.equal(await readFile(file, "utf8"), "<p>новое</p>");
    const missing = join(folder, "нет.html");
    assert.equal(await writeFileCard(null, missing, "x"), false);
    await assert.rejects(readFile(missing), "запись завела новый файл");
    assert.equal(await writeFileCard(null, folder, "x"), false, "запись в папку");
  }

  // Отдать мессенджеру (перетаскиванием и буфером) можно только существующий обычный файл.
  {
    const file = join(folder, "page.html");
    assert.equal(await isFile(file), true);
    assert.equal(await isFile(folder), false, "папка");
    assert.equal(await isFile(join(folder, "нет.pdf")), false, "файла нет");
    assert.equal(await isFile(42), false, "не строка");
    assert.equal(await isFile(""), false, "пустой путь");
  }

  console.log("files: все проверки пройдены");
} finally {
  await rm(folder, { recursive: true, force: true });
}
