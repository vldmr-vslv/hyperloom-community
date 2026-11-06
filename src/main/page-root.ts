// Какой файл отдаёт протокол браузер-карточки: только внутри папки страницы. Отдельно от pages.ts,
// где живёт Electron: так правило проверяется обычным node.
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Файл по пути из адреса страницы, если он внутри root; иначе null. Путь приходит закодированным:
 * %2e%2e и обратные слэши раскрываются до проверки, иначе ими вышли бы из папки.
 * ponytail: ссылка внутри папки, ведущая наружу, отдаётся как есть - проверяется путь, а не то, куда
 * он ведёт на диске. Апгрейд, если понадобится, - realpath перед проверкой.
 */
export function pageFileIn(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(root, "." + decoded);
  const inside = relative(root, file);
  return inside === "" || inside.startsWith("..") || isAbsolute(inside) ? null : file;
}

/**
 * Кусок файла по заголовку Range ("bytes=a-b", "bytes=a-", "bytes=-n"): плеер видео перематывает такими запросами, а
 * чтение file:// в Electron отвечает на них файлом целиком. Заголовка нет - null (отдать весь файл); кусок за концом
 * файла или непонятный заголовок - "bad" (ответ 416).
 */
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | "bad" {
  if (!header) return null;
  const found = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!found || (!found[1] && !found[2])) return "bad";
  const start = found[1] ? Number(found[1]) : Math.max(0, size - Number(found[2]));
  const end = found[1] && found[2] ? Math.min(Number(found[2]), size - 1) : size - 1;
  return start >= size || start > end ? "bad" : { start, end };
}
