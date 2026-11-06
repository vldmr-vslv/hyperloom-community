// Проверка терминала на настоящем процессе оболочки: node src/main/terminal.check.ts
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSettings } from "./settings.ts";
import { openTerminal } from "./terminal.ts";
import { waitUntil } from "./wait-until.ts";

/** Оболочка отвечает не мгновенно: PowerShell поднимается около секунды. */
const WAIT_MS = 15000;

const shell = parseSettings(undefined).shell;

/**
 * Вывод без управляющих последовательностей и переносов. Терминал переносит длинную строку
 * по своей ширине, разрезая слова где придётся, - искать путь в сыром выводе бесполезно.
 */
function plain(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r?\n/g, "");
}

/** Накопитель вывода, умеющий дождаться нужной подстроки. */
function output() {
  let text = "";
  return {
    get text(): string {
      return text;
    },
    add: (chunk: string): void => {
      text += chunk;
    },
    until: (needle: string): Promise<void> =>
      waitUntil(
        () => plain(text).includes(needle),
        WAIT_MS,
        () => `не дождались "${needle}"; получено: ${JSON.stringify(plain(text).slice(-300))}`,
      ),
  };
}

/** Жив ли процесс: сигнал 0 ничего не делает, но на мёртвом процессе бросает. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const ROOT = join(tmpdir(), "hyperloom-terminal");
await rm(ROOT, { recursive: true, force: true });
await mkdir(ROOT, { recursive: true });
let made = 0;

/** Завершение процесса терминала: закрытие карточки не держит поток и не ждёт его, а папку
 *  процесса до выхода не удалить. */
function exitSignal(): { onExit: () => void; exit: Promise<void> } {
  let onExit = () => {};
  const exit = new Promise<void>((resolve) => (onExit = resolve));
  return { onExit, exit };
}

async function tempFolder(): Promise<string> {
  const dir = join(ROOT, String((made += 1)));
  await mkdir(dir);
  return dir;
}

// Оболочка запускается в папке своей карточки, принимает ввод и отдаёт вывод с цветом.
{
  const dir = await tempFolder();
  const seen = output();
  const ended = exitSignal();
  const terminal = openTerminal(shell, dir, seen.add, ended.onExit);
  assert.ok(terminal, "терминал не запустился");

  // Приглашение печатает тот же путь, поэтому маркер отделяет ответ команды от эха ввода.
  terminal.write("Write-Output READY-$($PWD.Path)\r");
  await seen.until(`READY-${dir}`);

  // Цвет доходит до карточки: без этого вывод любого CLI остался бы чёрно-белым.
  assert.match(seen.text, /\u001b\[[0-9;]*m/, "в выводе нет цветовых последовательностей");

  terminal.stop();
  await ended.exit;
  await rm(dir, { recursive: true, force: true });
}

// Карточку растянули: оболочка узнаёт новый размер, иначе вывод переносился бы по старой ширине.
{
  const dir = await tempFolder();
  const seen = output();
  const ended = exitSignal();
  const terminal = openTerminal(shell, dir, seen.add, ended.onExit);
  assert.ok(terminal);

  terminal.resize(120, 40);
  terminal.write("Write-Output SIZE-$($Host.UI.RawUI.WindowSize.Width)x$($Host.UI.RawUI.WindowSize.Height)\r");
  await seen.until("SIZE-120x40");

  terminal.stop();
  await ended.exit;
  await rm(dir, { recursive: true, force: true });
}

// Карточку закрыли: процесс оболочки в системе не остаётся, а карточка узнаёт о завершении.
{
  const dir = await tempFolder();
  const seen = output();
  let exited = false;
  const terminal = openTerminal(shell, dir, seen.add, () => {
    exited = true;
  });
  assert.ok(terminal);

  // Оболочке дают подняться: убивать её на полпути - не то, что делает закрытие карточки.
  terminal.write("Write-Output UP\r");
  await seen.until("UP");

  // Закрытие не держит поток: на Windows ожидание выхода процессов консоли останавливало бы
  // главный процесс, а вместе с ним ввод во всё окно.
  const { pid } = terminal;
  const started = Date.now();
  terminal.stop();
  assert.ok(Date.now() - started < 100, `закрытие держало поток ${Date.now() - started} мс`);

  const deadline = Date.now() + WAIT_MS;
  while (!exited) {
    if (Date.now() >= deadline) assert.fail("о завершении оболочки никто не сообщил");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(alive(pid), false, `процесс ${pid} остался в системе после закрытия карточки`);

  // Ввод из карточки может прийти позже завершения: окно закрывается не в тот же миг.
  terminal.write("Write-Output ПОЗДНО\r");
  terminal.resize(100, 30);
  terminal.stop();

  await rm(dir, { recursive: true, force: true });
}

// Оболочки нет на машине: карточка получает отказ, а приложение продолжает работать.
{
  const dir = await tempFolder();
  const missing = openTerminal({ command: "нет-такой-оболочки.exe", args: [] }, dir, () => {}, () => {});
  assert.equal(missing, null, "несуществующая оболочка не дала отказа");

  // Папки нет на диске - тот же отказ, а не падение.
  assert.equal(openTerminal(shell, join(dir, "нет-такой-папки"), () => {}, () => {}), null);

  await rm(dir, { recursive: true, force: true });
}

await rm(ROOT, { recursive: true, force: true });
console.log("terminal: все проверки пройдены");

// Выход явный: отказавший запуск оставляет внутри node-pty открытый сокет (см. ponytail
// в terminal.ts), и без этой строки проверка висела бы после последнего assert.
process.exit(0);
