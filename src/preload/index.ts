import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { Layout } from "../shared/canvas-model";
import type { CommandRun } from "../main/command-runs";
import type { OpenResult } from "../main/sessions";

export type LayoutApi = {
  load: () => Promise<Layout>;
  save: (layout: Layout) => void;
  /**
   * Спросить, закрывать ли карточку, если это оборвёт перечисленное работающее.
   * Отказ - false, и полотно остаётся как есть.
   */
  confirmClose: (running: string[]) => Promise<boolean>;
};

/** mtime - время изменения записи, мс; 0 - не прочиталось. */
export type FolderEntry = { name: string; path: string; isDirectory: boolean; mtime: number };

/** Список обрезан по потолку главного процесса, поэтому рядом едет и полное число записей. */
export type FolderContents = { entries: FolderEntry[]; total: number };

/**
 * Ответ на чтение папки. "missing" - папки нет на диске, и карточка говорит об этом прямо;
 * null - папка есть, но не читается, например закрыта правами.
 */
export type FolderRead = FolderContents | "missing" | null;

export type FilePreview =
  | { kind: "image"; dataUrl: string }
  | { kind: "text"; text: string }
  | { kind: "other" };

/** Размер в байтах, git-статус словами и то, чем файл показывается в карточке. */
/** mtime - время изменения файла, мс: по нему кнопка Roadmap узнаёт, менялся ли он с последнего просмотра. */
export type FileInfo = { size: number; mtime: number; gitStatus: string; preview: FilePreview };

/** Управление живым терминалом карточки. Закрытие уносит процесс оболочки. */
export type TerminalSession = {
  /** Процесс уже жил до этого подключения: окно перезагрузили, а приложение нет. */
  reattached: boolean;
  /** Отключиться, не закрывая процесс: карточка сейчас поднимет вместо него другую сессию. */
  detach: () => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

/** Что карточка хочет знать о своём процессе: вывод, завершение и завершённая в нём команда. */
export type TerminalHandlers = {
  data: (chunk: string) => void;
  exit: () => void;
  /**
   * Команда в карточке завершилась, с любым кодом. Приходит только карточке терминала: разметку
   * приглашения главный процесс ставит оболочке, а не агенту.
   */
  done?: (run: CommandRun) => void;
  /** Команда в карточке терминала пошла (true) или закончилась (false). Агенту не приходит. */
  run?: (busy: boolean) => void;
};


export type TerminalApi = {
  /** Оболочка из настроек в папке карточки; запустить не удалось - null. */
  open: (path: string, card: string, handlers: TerminalHandlers) => Promise<TerminalSession | null>;
};

export type NoteApi = {
  /**
   * Диалог имени новой заметки и пустой файл под неё в этой папке; путь файла или null,
   * если от диалога отказались или файл не создался. Существующий файл не затирается.
   */
  create: (folder: string) => Promise<string | null>;
  /** Текст заметки; файла нет или он не читается - null. */
  read: (path: string) => Promise<string | null>;
  /** Набранное в карточке ложится в файл целиком; не записалось - false. */
  write: (path: string, text: string) => Promise<boolean>;
};

export type FileApi = {
  /** Путь перетащенного или вставленного файла на диске; файл не с диска - пустая строка. */
  pathOf: (file: File) => string;
  /** Сведения о файле; файла нет или он не читается - null. */
  read: (path: string) => Promise<FileInfo | null>;
  /** Записать текст редактора в существующий файл; не записалось или файла нет - false. */
  write: (path: string, text: string) => Promise<boolean>;
  /** Адрес HTML-страницы для браузер-карточки; не страница или её нет - null. */
  page: (path: string) => Promise<string | null>;
  /** Начать протяжку файла наружу (в мессенджер, проводник), как из проводника. Не обычный файл - протяжки нет. */
  drag: (path: string) => void;
  /** Положить файл в буфер обмена файлом, для Ctrl+V в мессенджере; не вышло - false. */
  copy: (path: string) => Promise<boolean>;
  /** Открыть HTML-страницу браузером Windows; не вышло - false. */
  outside: (path: string) => Promise<boolean>;
  /** Своя картинка фона полотна, запомненная на диске; её нет - null. */
  wall: () => Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null>;
  /** Запомнить картинку фона или забыть её (null); не картинка или слишком велика - false. */
  setWall: (bytes: Uint8Array | null, type?: string) => Promise<boolean>;
};

export type FolderApi = {
  /** Путь выбранной папки; отказ от диалога - null. */
  pick: () => Promise<string | null>;
  /** Содержимое папки; папки нет - "missing", папка не читается - null. */
  read: (path: string) => Promise<FolderRead>;
  /**
   * Слежение за путём: onChange вызывается, когда на диске что-то поменялось - внутри
   * папки или с ней самой. Путь файла годится тем же: за файлом заметки следит это же.
   * Возвращает функцию, прекращающую слежение.
   */
  watch: (path: string, onChange: () => void) => () => void;
};


const layoutApi: LayoutApi = {
  load: () => ipcRenderer.invoke("layout:load"),
  // Ответ не нужен: когда писать на диск, решает главный процесс.
  save: (layout) => ipcRenderer.send("layout:save", layout),
  confirmClose: (running) => ipcRenderer.invoke("layout:confirm-close", running),
};

const folderApi: FolderApi = {
  pick: () => ipcRenderer.invoke("folder:pick"),
  read: (path) => ipcRenderer.invoke("folder:read", path),
  watch: (path, onChange) => {
    // Уведомление идёт одним каналом на все карточки, поэтому путь сверяется здесь.
    const listen = (_event: IpcRendererEvent, changed: unknown) => {
      if (changed === path) onChange();
    };
    ipcRenderer.on("folder:changed", listen);
    ipcRenderer.send("folder:watch", path);
    return () => {
      ipcRenderer.off("folder:changed", listen);
      ipcRenderer.send("folder:unwatch", path);
    };
  },
};

const fileApi: FileApi = {
  read: (path) => ipcRenderer.invoke("file:read", path),
  write: (path, text) => ipcRenderer.invoke("file:write", path, text),
  page: (path) => ipcRenderer.invoke("page:open", path),
  drag: (path) => ipcRenderer.send("file:drag", path),
  copy: (path) => ipcRenderer.invoke("file:copy", path),
  outside: (path) => ipcRenderer.invoke("page:outside", path),
  pathOf: (file) => webUtils.getPathForFile(file),
  wall: () => ipcRenderer.invoke("wall:read"),
  setWall: (bytes, type) => ipcRenderer.invoke("wall:write", bytes, type),
};

const noteApi: NoteApi = {
  create: (folder) => ipcRenderer.invoke("note:create", folder),
  read: (path) => ipcRenderer.invoke("note:read", path),
  write: (path, text) => ipcRenderer.invoke("note:write", path, text),
};

const terminalApi: TerminalApi = {
  open: async (path, card, handlers) => {
    const opened: OpenResult | null = await ipcRenderer.invoke("terminal:open", { path, card });
    if (!opened) return null;
    const { session } = opened;

    // Вывод всех терминалов идёт одним каналом, поэтому номер сессии сверяется здесь.
    const data = (_event: IpcRendererEvent, from: unknown, chunk: unknown) => {
      if (from === session && typeof chunk === "string") handlers.data(chunk);
    };
    const exit = (_event: IpcRendererEvent, from: unknown) => {
      if (from === session) handlers.exit();
    };
    const done = (_event: IpcRendererEvent, from: unknown, run: CommandRun) => {
      if (from === session) handlers.done?.(run);
    };
    const run = (_event: IpcRendererEvent, from: unknown, busy: unknown) => {
      if (from === session && typeof busy === "boolean") handlers.run?.(busy);
    };
    ipcRenderer.on("terminal:data", data);
    ipcRenderer.on("terminal:exit", exit);
    ipcRenderer.on("terminal:done", done);
    ipcRenderer.on("terminal:run", run);
    const unlisten = () => {
      ipcRenderer.off("terminal:data", data);
      ipcRenderer.off("terminal:exit", exit);
      ipcRenderer.off("terminal:done", done);
      ipcRenderer.off("terminal:run", run);
    };

    // Процесс уже жил, окно перезагрузили: сперва то, что он успел вывести и чем был занят.
    if (opened.backlog) handlers.data(opened.backlog);

    return {
      reattached: opened.lease > 1,
      write: (input) => ipcRenderer.send("terminal:input", session, input),
      resize: (cols, rows) => ipcRenderer.send("terminal:resize", session, cols, rows),
      detach: unlisten,
      close: () => {
        unlisten();
        ipcRenderer.send("terminal:close", session, opened.lease);
      },
    };
  },
};


contextBridge.exposeInMainWorld("layoutApi", layoutApi);
contextBridge.exposeInMainWorld("folderApi", folderApi);
contextBridge.exposeInMainWorld("fileApi", fileApi);
contextBridge.exposeInMainWorld("noteApi", noteApi);
contextBridge.exposeInMainWorld("terminalApi", terminalApi);

declare global {
  interface Window {
    layoutApi: LayoutApi;
    folderApi: FolderApi;
    fileApi: FileApi;
    noteApi: NoteApi;
    terminalApi: TerminalApi;
  }
}
