// Своя картинка фона полотна. Живёт файлом рядом с раскладкой: окно получает её байтами при
// запуске, а не путём - страница с дев-сервера файл по пути не откроет, а хранилищу окна
// картинка в несколько мегабайт не по размеру.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Больше этого картинку не берём: фон размером с фильм держал бы память окна зря. */
const WALL_LIMIT = 40 * 1024 * 1024;

export type Wall = { bytes: Uint8Array; type: string };

/** Картинка фона из каталога данных. Нет её или не читается - фона нет. */
export async function readWall(dir: string): Promise<Wall | null> {
  try {
    const [bytes, type] = await Promise.all([readFile(join(dir, "wall")), readFile(join(dir, "wall.type"), "utf8")]);
    return { bytes, type };
  } catch {
    return null;
  }
}

/**
 * Запомнить картинку фона или забыть её (bytes null). Приходит из окна, поэтому проверяется:
 * картинка ли это по типу и не слишком ли велика. Не картинку не пишем - false.
 */
export async function writeWall(dir: string, bytes: unknown, type: unknown): Promise<boolean> {
  if (bytes === null) {
    await Promise.all([rm(join(dir, "wall"), { force: true }), rm(join(dir, "wall.type"), { force: true })]);
    return true;
  }
  if (!(bytes instanceof Uint8Array) || bytes.length > WALL_LIMIT) return false;
  if (typeof type !== "string" || !/^image\/[\w.+-]+$/.test(type)) return false;
  await writeFile(join(dir, "wall"), bytes);
  await writeFile(join(dir, "wall.type"), type, "utf8");
  return true;
}
