// Страницы для браузер-карточки. Окно приложения живёт на file:// или на дев-сервере, и iframe с file://
// оттуда браузер не откроет, поэтому страница грузится своим протоколом: work-page://<ключ>/<путь>.
// Ключ стоит за папкой открытой страницы, и протокол отдаёт файлы только из неё и глубже: иначе чужая
// страница из проекта прочла бы через fetch любой файл на диске.
import { net, protocol, shell } from "electron";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { isFile } from "./files";
import { byteRange, pageFileIn } from "./page-root";

const SCHEME = "work-page";
// PDF показывает встроенный просмотрщик Chromium в том же фрейме, что и страницу; видео - плеер Chromium в карточке файла.
const PAGE_EXTENSIONS = [".html", ".htm", ".pdf", ".mp4", ".webm", ".mov", ".m4v", ".ogv"];

/** Папка по ключу и ключ по папке: одна папка - один ключ, сколько ни открывай её страниц. */
const roots = new Map<string, string>();
const keys = new Map<string, string>();

/** Протокол объявляется до готовности приложения: стандартный и безопасный, как https, - у страницы
 *  свой источник, отдельный от окна приложения, и работают fetch, модули и localStorage. */
export function registerPageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // stream: без него плеер видео из своего протокола не играет ("The element has no supported sources").
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Файл по адресу страницы, если он внутри её папки; иначе null. */
function pageFile(url: string): string | null {
  const { hostname, pathname } = new URL(url);
  const root = roots.get(hostname);
  return root ? pageFileIn(root, pathname) : null;
}

/** Текст без кодировки в заголовке браузер читал бы как windows-1252, и кириллица страниц ломалась
 *  бы. Файлы проектов - в utf-8; кодировку, названную самим ответом, это не трогает. */
function withCharset(response: Response): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!/^(text\/|application\/(javascript|json))/.test(type) || /charset=/i.test(type)) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", `${type}; charset=utf-8`);
  return new Response(response.body, { status: response.status, headers });
}

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
};

/** Видео кусками по Range: чтение file:// через net.fetch отдаёт файл целиком, и плеер не перематывал (позиция
 *  возвращалась в 0). */
async function videoResponse(file: string, type: string, range: string | null): Promise<Response> {
  const { size } = await stat(file);
  const part = byteRange(range, size);
  if (part === "bad") return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const { start, end } = part ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  const headers = { "content-type": type, "content-length": String(end - start + 1), "accept-ranges": "bytes" };
  return part
    ? new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}` } })
    : new Response(body, { status: 200, headers });
}

export function servePages(): void {
  protocol.handle(SCHEME, async (request) => {
    const file = pageFile(request.url);
    if (!file) return new Response("нет доступа", { status: 403 });
    try {
      const video = VIDEO_TYPES[extname(file).toLowerCase()];
      if (video) return await videoResponse(file, video, request.headers.get("range"));
      return withCharset(await net.fetch(pathToFileURL(file).toString()));
    } catch {
      // Файла нет: странице - обычный ответ 404, а не оборванный запрос.
      return new Response("нет такого файла", { status: 404 });
    }
  });
}

/** Путь - существующий файл страницы, PDF или видео (PAGE_EXTENSIONS). */
async function isPage(path: string): Promise<boolean> {
  return PAGE_EXTENSIONS.includes(extname(path).toLowerCase()) && (await isFile(path));
}

/** Адрес страницы для браузер-карточки; не страница или её нет - null. */
export async function openPage(path: unknown): Promise<string | null> {
  if (typeof path !== "string" || !(await isPage(path))) return null;
  const root = dirname(path);
  let key = keys.get(root);
  if (!key) {
    key = randomBytes(8).toString("hex");
    keys.set(root, key);
    roots.set(key, root);
  }
  return `${SCHEME}://${key}/${encodeURIComponent(basename(path))}`;
}

/** Страница в браузере Windows - тем, что открывает .html по умолчанию. */
export async function openPageOutside(path: unknown): Promise<boolean> {
  if (typeof path !== "string" || !(await isPage(path))) return false;
  return (await shell.openPath(path)) === "";
}
