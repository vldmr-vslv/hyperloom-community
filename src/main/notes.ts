// Файл заметки на диске: создание, чтение и запись текста карточки.
// Электрона здесь нет - только файловые операции, поэтому модуль запускается обычным node
// и проверяется без тестового фреймворка. Диалог выбора имени живёт в index.ts, рядом с
// диалогом выбора папки.
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

/** Расширение заметки по умолчанию. Заметки - обычные markdown-файлы, так решено в SPEC.md. */
const NOTE_EXTENSION = ".md";

/**
 * Имя, набранное в диалоге, доведённое до файла заметки: .md дописывается всегда, когда
 * его нет. Заметки - обычные .md в папке проекта, так решено в SPEC.md, и чужое расширение
 * тут не уступка, а другой файл: заметкой открылся бы и .ts, а код правят агент и терминал.
 */
export function noteFileName(picked: string): string {
  return extname(picked).toLowerCase() === NOTE_EXTENSION ? picked : picked + NOTE_EXTENSION;
}

/**
 * Файл заметки на месте: пустой создаётся, существующий не трогается - в диалоге могли
 * выбрать имя чужого файла, и заметка его открывает, а не затирает.
 * Папки нет или писать некуда - false, и карточка не заводится.
 */
export async function createNote(file: string): Promise<boolean> {
  try {
    // Флаг wx: если файл уже есть, запись не идёт вовсе, а не идёт и перезаписывает.
    await writeFile(file, "", { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST";
  }
}

/** Текст заметки; файла нет, он не читается или путь пришёл не строкой - null. */
export async function readNote(file: unknown): Promise<string | null> {
  if (typeof file !== "string") return null;
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Набранное в карточке ложится в файл целиком.
 * ponytail: потолок - файл переписывается целиком на каждое сохранение, и правка снаружи,
 * попавшая между чтением и записью, теряется. Апгрейд, когда упрётся, - сверка времени
 * изменения файла перед записью.
 */
export async function writeNote(file: unknown, text: unknown): Promise<boolean> {
  if (typeof file !== "string" || typeof text !== "string") return false;
  try {
    await writeFile(file, text, "utf8");
    return true;
  } catch {
    return false;
  }
}
