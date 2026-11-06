// Живые терминалы приложения: кто из карточек какой процесс держит и как он к ней приходит.
// Сам процесс оболочки живёт в terminal.ts - тот модуль про Electron ничего не знает
// и поэтому проверяется обычным node.
import { ipcMain } from "electron";
import { isRecord } from "../shared/canvas-model";
import type { Settings } from "./settings";
import { createRunReader } from "./command-runs";
import { markShell } from "./shell-marks";
import { openTerminal, type Terminal } from "./terminal";
import { newSession } from "./work-dirs";

/** Письмо карточке в окно: номер сессии подставляет отправитель, карточка сверяет его у себя. */
export type Send = (channel: string, ...args: unknown[]) => void;

/**
 * Живой процесс карточки: сам он, чья это карточка, куда ей писать и чем она занята.
 * Состояние держится и здесь, а не только в окне: по нему главный процесс решает, пропускать
 * ли в карточку текст от агента.
 *
 * Процесс переживает перезагрузку окна: карточка той же раскладки переподключается к нему
 * (reattach) и получает хвост вывода. lease - номер последнего подключения: закрыть процесс
 * может только оно, и запоздавшее закрытие от прежнего окна живой процесс не снимет.
 */
type Live = {
  terminal: Terminal;
  card: string;
  notify: Send;
  lease: number;
  backlog: string[];
  backlogSize: number;
};

/**
 * Сколько последнего вывода процесса помнится для переподключения, знаков. Хранится кусками:
 * склеивать строку в 200 тысяч знаков на каждый кусок частого вывода стоило бы дорого.
 * ponytail: помнится сырой поток, а не экран. Потолок - полноэкранная программа после
 * переподключения рисуется с середины потока, пока не перерисует экран сама (карточка
 * подталкивает её сменой размера). Апгрейд - xterm без экрана в главном процессе и его снимок.
 */
const BACKLOG_CAP = 200_000;

function remember(live: Live, chunk: string): void {
  live.backlog.push(chunk);
  live.backlogSize += chunk.length;
  while (live.backlogSize > BACKLOG_CAP && live.backlog.length > 1) {
    live.backlogSize -= live.backlog.shift()!.length;
  }
}

/** Терминалы по номеру сессии (newSession, work-dirs.ts). */
const terminals = new Map<number, Live>();

/**
 * Процесс карточки по её идентификатору. Перебор, а не вторая карта: карточек с процессом
 * на полотне десятки, и держать две карты в согласии дороже, чем пройти по одной.
 */

/**
 * Чем поднимать оболочки: настройки, разметка приглашения, хуки агента и корень рабочих копий.
 */
type Shells = { settings: Settings; rcFile: string };

/**
 * Что карточка просит поднять: путь, команда агента (или null - оболочка) и её имя. resume - явный
 * выбор сессии claude: "new", "last" или идентификатор; без него карточка переподключается к живому
 * процессу, если он есть. copy - агент работает в своей рабочей копии, а не в самой папке.
 */
type OpenRequest = { path: string; card: string };

/**
 * Что карточка получает в ответ: номер сессии, номер подключения и то, где она в итоге работает.
 * Копии нет - агент работает в папке, папка не под git или копию завести не вышло; карточка тогда
 * пишет "в папке".
 * Процесс уже жил (окно перезагрузили) - в ответе хвост его вывода и последнее состояние агента.
 */
export type OpenResult = {
  session: number;
  lease: number;
  backlog?: string;
};

/** Просьба приходит из окна, поэтому разбирается целиком, а не берётся на веру. */
function parseOpen(raw: unknown): OpenRequest | null {
  if (!isRecord(raw) || typeof raw.path !== "string" || typeof raw.card !== "string" || !raw.card) return null;
  return { path: raw.path, card: raw.card };
}


/** Письма карточке этой сессии - в окно, которое её открыло. Так же пишет карточке и её чат. */
export function sendTo(event: Electron.IpcMainInvokeEvent, session: number): Send {
  const { sender } = event;
  // Окно могло закрыться между выводом оболочки и отправкой: посылать туда уже некуда.
  return (channel, ...args) => {
    if (!sender.isDestroyed()) sender.send(channel, session, ...args);
  };
}

/**
 * Карточка открывает свой процесс, который ещё жив: окно перезагрузили, а приложение нет.
 * Процесс остаётся тем же, карточка получает хвост его вывода и новое подключение. Процесс
 * другой команды (карточке выбрали другого агента) снимается - поднимется новый.
 */
function reattach(event: Electron.IpcMainInvokeEvent, request: OpenRequest): OpenResult | null {
  for (const [session, live] of terminals) {
    if (live.card !== request.card) continue;
    live.lease += 1;
    live.notify = sendTo(event, session);
    return { session, lease: live.lease, backlog: live.backlog.join("") };
  }
  return null;
}

/**
 * Терминал для карточки. Запустить не удалось - null, и карточка скажет об этом.
 */
async function open(
  shells: Shells,
  event: Electron.IpcMainInvokeEvent,
  raw: unknown,
): Promise<OpenResult | null> {
  const request = parseOpen(raw);
  if (!request) return null;
  const again = reattach(event, request);
  if (again) return again;
  const runner = markShell(shells.settings.shell, shells.rcFile);
  const work = { cwd: request.path };

  const session = newSession();
  // Письма идут через запись о процессе: после переподключения у неё новый адресат.
  let live: Live | undefined;
  const send: Send = (channel, ...args) => live?.notify(channel, ...args);
  const read = createRunReader((run) => send("terminal:done", run), (busy) => send("terminal:run", busy));

  const terminal = openTerminal(
    runner,
    work.cwd,
    (chunk) => {
      read?.(chunk);
      if (live) remember(live, chunk);
      send("terminal:data", chunk);
    },
    () => {
      terminals.delete(session);
      send("terminal:exit");
    },
  );
  if (!terminal) return null;

  live = { terminal, card: request.card, notify: sendTo(event, session), lease: 1, backlog: [], backlogSize: 0 };
  terminals.set(session, live);
  return { session, lease: live.lease };
}


/** Размер приходит из окна и уходит в оболочку, которая на нуле и минусе бросает. */
function isSide(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/**
 * Карточку закрыли: процесс оболочки уходит вместе с ней, а рабочая копия - следом за ним.
 * Порядок обязателен: пока процесс агента жив, Windows держит его каталог и снос не пройдёт.
 * В копии осталась незакоммиченная работа - копия остаётся лежать, и человеку говорят, где.
 */
async function close(
  _event: Electron.IpcMainEvent,
  session: unknown,
  lease: unknown,
): Promise<void> {
  if (typeof session !== "number") return;
  // Закрытие от прежнего подключения - карточка уже переподключилась, процесс ей нужен.
  const current = terminals.get(session);
  if (current && lease !== current.lease) return;
  // Процесса может и не быть: агент завершился сам, а карточку закрыли после этого.
  // Копия от этого никуда не делась, и снести её всё равно надо.
  const live = terminals.get(session);
  live?.terminal.stop();
  terminals.delete(session);
}

/** Обработчики терминала на шине IPC. Настройки читаются при старте и на ходу не меняются. */
export function serveTerminals(
  settings: Settings,
  rcFile: string,
): void {
  const shells: Shells = { settings, rcFile };

  ipcMain.handle("terminal:open", (event, raw: unknown) => open(shells, event, raw));

  ipcMain.on("terminal:input", (_event, session: unknown, data: unknown) => {
    if (typeof session !== "number" || typeof data !== "string") return;
    terminals.get(session)?.terminal.write(data);
  });

  ipcMain.on("terminal:resize", (_event, session: unknown, cols: unknown, rows: unknown) => {
    if (typeof session !== "number" || !isSide(cols) || !isSide(rows)) return;
    terminals.get(session)?.terminal.resize(cols, rows);
  });

  ipcMain.on("terminal:close", (event, session: unknown, lease: unknown) => void close(event, session, lease));
}

/** Приложение уходит - оболочки уходят с ним, иначе они пережили бы породившее их окно. */
export function stopAllTerminals(): void {
  for (const live of terminals.values()) {
    live.terminal.stop();
  }
  terminals.clear();
  // Рабочие копии остаются на диске: карточки никуда не делись и при следующем запуске
  // вернутся в свои копии. Уносит лишние подметание при загрузке раскладки.
}
