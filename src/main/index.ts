import { app, BrowserWindow, dialog, ipcMain, webFrameMain } from "electron";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { initialLayout, isLayout, projectColors, ROOT_CARD_ID, type Layout } from "../shared/canvas-model";
import { knownCards } from "../shared/canvas-model";
import { readFileCard, readFolder, isFile, writeFileCard } from "./files";
import { serveTerminals, stopAllTerminals } from "./sessions";
import { openPage, openPageOutside, registerPageScheme, servePages } from "./pages";
import { createNote, noteFileName, readNote, writeNote } from "./notes";
import { installRc } from "./shell-marks";
import { loadSettings } from "./settings";
import { watchFolder } from "./watch";
import { readWall, writeWall } from "./wall";

/** Стартовая папка - путь корневой карточки; её выбирают при первом запуске, потом меняют правкой layout.json. */
function rootPath(layout: Layout | null): string {
  return layout?.cards.find((card) => card.id === ROOT_CARD_ID)?.path ?? homedir();
}

/** Раскладка пишется не на каждый кадр перетаскивания, а когда движение прекратилось. */
const SAVE_DELAY_MS = 300;

/** Прокрутка во фреймах карточек: тонкая, полупрозрачная серая. Страница с scrollbar-color её не получит (Chromium 121+
 *  тогда берёт scrollbar-color, а не ::-webkit-scrollbar). */
const FRAME_SCROLLBAR = `(() => {
  const style = document.createElement("style");
  style.textContent = "::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{background:rgb(128 128 128/.45);border:2px solid transparent;border-radius:4px;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background-color:rgb(128 128 128/.7)}";
  (document.head ?? document.documentElement).append(style);
})()`;


let saveTimer: NodeJS.Timeout | null = null;

/** Последняя раскладка из окна: её дописывает выход из приложения. */
let mirror: Layout | null = null;
/** Есть ли в зеркале то, чего ещё нет на диске. */
let unsaved = false;

/** Раскладка живёт одним JSON рядом с настройками приложения: %APPDATA%/Hyperloom Community/layout.json */
function layoutFile(): string {
  return join(app.getPath("userData"), "layout.json");
}


async function loadLayout(): Promise<Layout> {
  // Проект - папка со своим .git (файл у рабочей копии и подмодуля, каталог у репозитория), как у кольца.
  mirror = projectColors(await readLayout(), (path) => existsSync(join(path, ".git")));
  return mirror;
}

async function readLayout(): Promise<Layout> {
  const file = layoutFile();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return firstLayout(); // файла нет - это первый запуск
  }

  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // Разбор ниже всё равно отвергнет значение, а файл уедет в .broken.
  }
  // Раскладка рабочей версии с карточками агентов и браузера читается без них, а не уезжает в .broken.
  raw = knownCards(raw);
  if (isLayout(raw)) return raw;

  // Файл есть, но раскладкой не читается. Правку руками нельзя терять под первой же
  // записью, поэтому она уезжает в соседний файл, а полотно начинается заново.
  await rename(file, file + ".broken").catch(() => {});
  return firstLayout();
}

/** Раскладка первого запуска, уже выбранная: файл мог не записаться, а второй диалог дал бы pi и полотну разные корни. */
let firstPicked: Layout | null = null;

/** Раскладка первого запуска от папки, выбранной в диалоге; отказ - домашняя папка. */
async function firstLayout(): Promise<Layout> {
  if (firstPicked) return firstPicked;
  const picked = await dialog.showOpenDialog({ title: "Выберите стартовую папку", properties: ["openDirectory"] });
  const layout = initialLayout(picked.filePaths[0] ?? homedir());
  // Пишется сразу: раскладку читают и старт приложения, и окно, а папку спрашивают один раз.
  try {
    writeFileSync(layoutFile(), JSON.stringify(layout, null, 2), "utf8");
  } catch (error) {
    console.error("раскладка первого запуска не записана:", error);
  }
  firstPicked = layout;
  return layout;
}

function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!unsaved || !mirror) return;
  // Запись синхронная: тем же путём раскладка сбрасывается на выходе из приложения,
  // где ждать промис уже некому. Файл маленький, пишется не чаще раза в SAVE_DELAY_MS.
  // Отступы - чтобы файл открывался и читался глазами.
  writeFileSync(layoutFile(), JSON.stringify(mirror, null, 2), "utf8");
  unsaved = false;
}

function scheduleSave(raw: unknown): void {
  // На диск не попадает то, что потом не прочитается обратно.
  if (!isLayout(raw)) return;
  mirror = raw;
  unsaved = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}


/** Слежение за путями, у которых есть карточка: путь - функция остановки. */
const watching = new Map<string, () => void>();

/**
 * Карточка просит следить за своим путём: папкой или файлом заметки. Карточка на путь одна,
 * поэтому и слежение одно: повторная просьба про тот же путь ничего не заводит.
 */
function startWatch(event: Electron.IpcMainEvent, path: unknown): void {
  if (typeof path !== "string" || watching.has(path)) return;
  const { sender } = event;
  watching.set(
    path,
    watchFolder(path, () => {
      // Окно могло закрыться между событием с диска и отправкой: посылать туда уже некуда.
      if (!sender.isDestroyed()) sender.send("folder:changed", path);
    }),
  );
}

function stopWatch(_event: Electron.IpcMainEvent, path: unknown): void {
  if (typeof path !== "string") return;
  watching.get(path)?.();
  watching.delete(path);
}

/** Системный диалог выбора папки. Отказ пользователя - это null, а не ошибка. */
async function pickFolder(event: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Открыть папку",
    defaultPath: rootPath(mirror),
    properties: ["openDirectory"],
  };
  // Диалог держится модальным к окну, из которого пришёл запрос; окна нет - показываем сам по себе.
  const parent = BrowserWindow.fromWebContents(event.sender);
  const picked = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options));
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

/**
 * Вопрос перед закрытием карточки, которое оборвёт работающие процессы: они уходят
 * с полотна вместе со своими карточками. Отказ и закрытый диалог - false, полотно как есть.
 */
async function confirmClose(
  event: Electron.IpcMainInvokeEvent,
  running: unknown,
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: "question",
    title: "Закрыть карточку",
    message: "Закрытие оборвёт то, что сейчас работает:",
    // Список приходит из окна и идёт прямо в диалог, поэтому приводится к строкам здесь.
    detail: (Array.isArray(running) ? running : []).map(String).join("\n"),
    buttons: ["Закрыть", "Отмена"],
    defaultId: 1,
    cancelId: 1,
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const picked = await (parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options));
  return picked.response === 0;
}

/**
 * Системный диалог имени новой заметки и пустой файл под неё. Отказ - null, и карточка
 * не заводится. Выбрано имя существующего файла - он открывается, а не затирается; Windows
 * при этом всё равно спрашивает про замену, отключить это в системном диалоге нечем.
 */
async function pickNote(
  event: Electron.IpcMainInvokeEvent,
  folder: unknown,
): Promise<string | null> {
  if (typeof folder !== "string") return null;
  const options: Electron.SaveDialogOptions = {
    title: "Новая заметка",
    defaultPath: join(folder, "note.md"),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const picked = await (parent
    ? dialog.showSaveDialog(parent, options)
    : dialog.showSaveDialog(options));
  if (picked.canceled || !picked.filePath) return null;
  const file = noteFileName(picked.filePath);
  return (await createNote(file)) ? file : null;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    // Тот же цвет, что --canvas в src/renderer/src/index.css: до первой отрисовки окно
    // залито им, и при смене палитры меняются оба.
    backgroundColor: "#1a1a1a",
    title: "Hyperloom Community",
    // Свой значок окна и панели задач; без него Windows показывает значок самого Electron.
    icon: join(import.meta.dirname, "../../resources/icon.ico"),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      // Preload собирается модулем ESM, а такой Electron грузит только вне песочницы.
      // Изоляция контекста при этом остаётся включённой.
      sandbox: false,
    },
  });

  // Окно показывается уже отрисованным, без белой вспышки на старте.
  mainWindow.on("ready-to-show", () => mainWindow.show());

  // Ссылка в отрендеренном markdown увела бы окно с полотна и заменила бы приложение
  // страницей без пути назад. Переходы и новые окна запрещены целиком.
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Стили окна во фрейм карточки не проходят, а страница своей тёмной прокрутки обычно не ставит: стиль вкладывается
  // в каждый загруженный фрейм. Серый полупрозрачный бегунок читается и на светлой странице.
  mainWindow.webContents.on("did-frame-finish-load", (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    void webFrameMain.fromId(processId, routingId)?.executeJavaScript(FRAME_SCROLLBAR).catch(() => undefined);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer error] ${message} (${sourceId}:${line})`);
    }
  });

  // В разработке electron-vite поднимает дев-сервер и кладёт его адрес сюда.
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

// Один экземпляр на папку данных: два окна писали бы одну раскладку. Второй запуск поднимает первое окно.
// Замок держится по userData, поэтому npm run dev при открытой рабочей версии не стартует.
const single = app.requestSingleInstanceLock();
if (!single) app.exit(0);
app.on("second-instance", () => {
  // Окна снимков страниц тоже BrowserWindow, но offscreen: их не поднимать.
  const window = BrowserWindow.getAllWindows().find((each) => !each.webContents.isOffscreen());
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

// Протокол страниц браузер-карточки объявляется до готовности приложения - иначе Electron его не примет.
registerPageScheme();

void app.whenReady().then(async () => {
  // app.exit не синхронный: второй экземпляр мог дожить до ready, и раскладку он трогать не должен.
  if (!single) return;
  // Раскладка читается до окна: первый запуск спрашивает стартовую папку раньше, чем появится полотно.
  await readLayout();
  servePages();
  // Настройки правятся руками и читаются один раз при старте:
  // %APPDATA%/Hyperloom Community/settings.json
  const settings = await loadSettings(join(app.getPath("userData"), "settings.json"));

  serveTerminals(settings, installRc(join(app.getPath("userData"), "shell")));

  ipcMain.handle("layout:load", loadLayout);
  ipcMain.on("layout:save", (_event, raw: unknown) => scheduleSave(raw));
  ipcMain.handle("layout:confirm-close", confirmClose);
  ipcMain.handle("folder:pick", pickFolder);
  ipcMain.handle("folder:read", readFolder);
  ipcMain.on("folder:watch", startWatch);
  ipcMain.on("folder:unwatch", stopWatch);
  ipcMain.handle("file:read", readFileCard);
  ipcMain.handle("file:write", writeFileCard);
  // Файл карточки - мессенджеру: протяжка значка шапки отдаёт его системе как из проводника, "копировать" кладёт в буфер
  // файлом. Своего API для файла в буфере у Electron нет, а Set-Clipboard ставит FileDrop (CF_HDROP), его берут
  // Telegram и WhatsApp; путь идёт переменной окружения, без разбора кавычек.
  ipcMain.on("file:drag", async (event, file: unknown) => {
    if (typeof file !== "string" || !(await isFile(file))) return;
    const icon = await app.getFileIcon(file).catch(() => null);
    if (icon) event.sender.startDrag({ file, icon });
  });
  ipcMain.handle("file:copy", async (_event, file: unknown) => {
    if (typeof file !== "string" || !(await isFile(file))) return false;
    return new Promise<boolean>((done) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:HYPERLOOM_SHARE"],
        { env: { ...process.env, HYPERLOOM_SHARE: file }, windowsHide: true, timeout: 10000 },
        (error) => done(!error),
      ),
    );
  });
  ipcMain.handle("wall:read", () => readWall(app.getPath("userData")));
  ipcMain.handle("wall:write", (_event, bytes: unknown, type: unknown) => writeWall(app.getPath("userData"), bytes, type));
  ipcMain.handle("page:open", (_event, path: unknown) => openPage(path));
  ipcMain.handle("page:outside", (_event, path: unknown) => openPageOutside(path));
  ipcMain.handle("note:create", pickNote);
  ipcMain.handle("note:read", (_event, path: unknown) => readNote(path));
  ipcMain.handle("note:write", (_event, path: unknown, text: unknown) => writeNote(path, text));

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Карточку подвинули и сразу закрыли окно - несохранённое дописывается здесь.
// Тем же заходом уходят оболочки: без этого они пережили бы приложение, породившее их.
app.on("before-quit", () => {
  flushSave();
  stopAllTerminals();
});

// Критерий тикета: после закрытия окна в системе не остаётся процессов.
// Выходим на всех платформах, включая macOS, где Electron по умолчанию живёт дальше.
app.on("window-all-closed", () => app.quit());
