// Чтение диска для карточек: содержимое папки и сведения о файле.
// Отдельно от index.ts, где живут раскладка, окно и проводка IPC.
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import type { IpcMainInvokeEvent } from "electron";
import type { FileInfo, FilePreview, FolderRead } from "../preload";

/**
 * Сколько имён из папки уезжает в карточку. node_modules - это десятки тысяч записей,
 * и рисовать их в карточке размером с ладонь нечем и незачем.
 * ponytail: потолок - остаток списка не посмотреть никак. Апгрейд - подгрузка при прокрутке.
 */
const MAX_ENTRIES = 200;

/**
 * Содержимое папки для карточки: папки сверху, файлы ниже, по алфавиту.
 * Папку могли удалить или закрыть правами - тогда содержимого нет, и карточка скажет об этом
 * честно, вместо того чтобы показать пустой список.
 */
export async function readFolder(
  _event: IpcMainInvokeEvent,
  path: unknown,
): Promise<FolderRead> {
  if (typeof path !== "string") return null;
  try {
    const found = await readdir(path, { withFileTypes: true });
    found.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
    const shown = found.slice(0, MAX_ENTRIES);
    // Время изменения: по нему кольцо папки ставит на обод самые свежие подпапки. Запись успели удалить - 0.
    const times = await Promise.all(shown.map((entry) => stat(join(path, entry.name)).then((info) => info.mtimeMs, () => 0)));
    return {
      entries: shown.map((entry, i) => ({
        name: entry.name,
        // Путь собирается здесь: только тут известен разделитель этой системы.
        path: join(path, entry.name),
        isDirectory: entry.isDirectory(),
        mtime: times[i],
      })),
      total: found.length,
    };
  } catch (error) {
    // Папки нет на диске - это не то же самое, что папка есть, но закрыта правами.
    // Карточка про исчезнувшую папку говорит прямо, а не "не читается".
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : null;
  }
}

/** Расширения, которые показываются картинкой. Тип нужен data-URL: без него <img> не разберёт байты. */
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/**
 * Потолок на предпросмотр: файл крупнее показывается как прочие - имя, путь, размер, git.
 * ponytail: содержимое едет через IPC целиком, картинка ещё и разбухшая в base64.
 * Апгрейд, когда упрётся, - свой протокол для файлов вместо data-URL.
 */
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

/**
 * Потолок на текст в редакторе карточки: файл крупнее показывается как прочие.
 * ponytail: текст едет через IPC и живёт в редакторе целиком. Апгрейд - чтение кусками.
 */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const run = promisify(execFile);

/**
 * Git-статус файла словами. Git не найден или папка не под контролем - "вне git":
 * для карточки это одно и то же, показывать нечего.
 * ponytail: потолок - отдельный процесс git на каждую карточку файла, по разу при появлении.
 * Апгрейд, когда карточек станет много, - один запрос на репозиторий вместо запроса на файл.
 */
async function gitStatus(file: string): Promise<string> {
  let out: string;
  try {
    const done = await run("git", ["status", "--porcelain", "--ignored=matching", "--", file], {
      cwd: dirname(file),
    });
    out = done.stdout;
  } catch {
    return "вне git";
  }
  if (!out) return "без изменений";
  if (out.startsWith("??")) return "не под контролем";
  if (out.startsWith("!!")) return "в .gitignore";
  return "изменён";
}

/** Чем показывать файл: картинкой, текстом в редакторе или, если ни то ни другое, "прочим". */
async function filePreview(path: string, size: number): Promise<FilePreview> {
  if (size > MAX_PREVIEW_BYTES) return { kind: "other" };
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  try {
    if (type) {
      const bytes = await readFile(path);
      return { kind: "image", dataUrl: `data:${type};base64,${bytes.toString("base64")}` };
    }
    if (size <= MAX_TEXT_BYTES) {
      const bytes = await readFile(path);
      // Нулевой байт - признак двоичного файла; тем же его отличает git.
      if (!bytes.includes(0)) return { kind: "text", text: bytes.toString("utf8") };
    }
  } catch {
    // Файл есть, но содержимое не даётся: показывается как прочее, карточка не пустеет.
  }
  return { kind: "other" };
}


/**
 * Запись текста из редактора карточки. Пишется только в уже существующий файл: карточка правит
 * файл, а не заводит новые, и путь из окна не должен создавать файлы где попало.
 */
export async function writeFileCard(_event: IpcMainInvokeEvent | null, path: unknown, text: unknown): Promise<boolean> {
  if (typeof path !== "string" || typeof text !== "string" || !(await isFile(path))) return false;
  try {
    await writeFile(path, text, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Сведения о файле для карточки. Файла нет или он не читается - null, как и у папки. */
export async function readFileCard(
  _event: IpcMainInvokeEvent | null,
  path: unknown,
): Promise<FileInfo | null> {
  if (typeof path !== "string") return null;
  let size: number;
  let mtime: number;
  try {
    ({ size, mtimeMs: mtime } = await stat(path));
  } catch {
    return null;
  }
  return { size, mtime, gitStatus: await gitStatus(path), preview: await filePreview(path, size) };
}

/** Путь из окна - существующий обычный файл: не папка, не пустая строка, не что-то кроме строки. */
export async function isFile(path: unknown): Promise<boolean> {
  if (typeof path !== "string" || !path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

