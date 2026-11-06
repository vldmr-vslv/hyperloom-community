// Проверка работы с файлом заметки на обычных assert: node src/main/notes.check.ts
// Папка настоящая, во временном каталоге: заметка - это файл на диске, и проверять её
// подделкой файловой системы значило бы проверять подделку.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNote, noteFileName, readNote, writeNote } from "./notes.ts";

const folder = await mkdtemp(join(tmpdir(), "hyperloom-notes-"));

try {
  // Имя из диалога доводится до .md: заметка - markdown-файл, а не любой выбранный.
  {
    assert.equal(noteFileName(join(folder, "идеи")), join(folder, "идеи.md"));
    assert.equal(noteFileName(join(folder, "идеи.md")), join(folder, "идеи.md"));
    assert.equal(noteFileName(join(folder, "идеи.MD")), join(folder, "идеи.MD"));
    // Чужое расширение не открывается заметкой: код правят агент и терминал, так в SPEC.md.
    assert.equal(noteFileName(join(folder, "code.ts")), join(folder, "code.ts.md"));
  }

  // Новая заметка появляется на диске пустым файлом - до первой буквы в карточке.
  {
    const file = join(folder, "new.md");
    assert.equal(await createNote(file), true);
    assert.equal(await readFile(file, "utf8"), "");
  }

  // Выбрано имя существующего файла: он открывается, а не затирается.
  {
    const file = join(folder, "kept.md");
    await writeFile(file, "чужой текст", "utf8");
    assert.equal(await createNote(file), true);
    assert.equal(await readNote(file), "чужой текст");
  }

  // Набранное в карточке лежит в файле тем же текстом, и читается обратно им же.
  {
    const file = join(folder, "round.md");
    await createNote(file);
    assert.equal(await writeNote(file, "# Заголовок\n\nтекст\n"), true);
    assert.equal(await readFile(file, "utf8"), "# Заголовок\n\nтекст\n");
    assert.equal(await readNote(file), "# Заголовок\n\nтекст\n");
  }

  // Файла нет - это null, а не пустая строка: карточке есть что сказать вместо пустого поля.
  assert.equal(await readNote(join(folder, "нет-такого.md")), null);

  // Через мост из окна приходит что угодно: не строка - отказ, а не падение.
  assert.equal(await readNote(42), null);
  assert.equal(await writeNote(join(folder, "round.md"), null), false);

  // Путь ведёт в несуществующую папку: наружу идёт отказ, а не падение главного процесса.
  {
    const nowhere = join(folder, "нет-папки", "note.md");
    assert.equal(await createNote(nowhere), false);
    assert.equal(await writeNote(nowhere, "текст"), false);
  }

  console.log("notes: все проверки пройдены");
} finally {
  await rm(folder, { recursive: true, force: true });
}
