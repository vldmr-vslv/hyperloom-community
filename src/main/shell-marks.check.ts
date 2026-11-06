// Проверка разметки оболочки: node src/main/shell-marks.check.ts
// Блоки ниже поднимают настоящие powershell и bash в псевдотерминале.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSettings } from "./settings.ts";
import { createRunReader, type CommandRun } from "./command-runs.ts";
import { installRc, markShell } from "./shell-marks.ts";
import { openTerminal } from "./terminal.ts";

/** Оболочка поднимается не мгновенно, а команда в ней выполняется и того позже. */
const WAIT_MS = 20000;

/** Где на Windows лежит настоящий bash: тот, что в PATH, - это WSL, а не он. */
const BASH_PATHS = [
  "C:/Program Files/Git/usr/bin/bash.exe",
  "C:/Program Files/Git/bin/bash.exe",
  "/bin/bash",
  "/usr/bin/bash",
];

async function until(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!ready()) {
    if (Date.now() >= deadline) assert.fail(`не дождались: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const ROOT = join(tmpdir(), "hyperloom-marks");
await rm(ROOT, { recursive: true, force: true });
await mkdir(ROOT, { recursive: true });
const rc = installRc(ROOT);

// Незнакомая оболочка возвращается как была: разметки для неё нет, и придумывать её нечем.
{
  const own = { command: "нет-такой-оболочки.exe", args: ["-x"] };
  assert.deepEqual(markShell(own, rc), own);
}

// Настоящий PowerShell с разметкой: упавшая команда доходит с кодом возврата и своим выводом.
{
  const dir = join(ROOT, "powershell");
  await mkdir(dir);
  const runs: CommandRun[] = [];
  let exited = false;
  const shell = markShell(parseSettings(undefined).shell, rc);
  const terminal = openTerminal(shell, dir, createRunReader((run) => runs.push(run)), () => (exited = true));
  assert.ok(terminal, "размеченная оболочка не запустилась");

  // Маркер собирается из кусков, поэтому в эхе набранной команды его нет, а в её выводе есть.
  terminal.write('node -e "console.log(\'BROKE\'+\'-HERE\'); process.exit(3)"\r');
  await until(() => runs.length > 0, "упавшая команда в PowerShell");

  const run = runs[0];
  assert.equal(run.code, 3, `код возврата не тот: ${JSON.stringify(run)}`);
  assert.match(run.command, /process\.exit\(3\)/, `команда не та: ${run.command}`);
  assert.ok(run.output.endsWith("BROKE-HERE"), `вывод не тот: ${JSON.stringify(run.output)}`);
  // Перерисовка строки, которую PSReadLine ведёт на каждое нажатие, в вывод не уехала:
  // после Enter строка ввода остаётся в нём в одном виде, а не десятком обрывков.
  assert.equal(run.output.split("BROKE-HERE").length - 1, 1, `в выводе мусор: ${JSON.stringify(run.output)}`);
  assert.ok(run.output.split("\n").length <= 4, `в выводе лишние строки: ${JSON.stringify(run.output)}`);

  // Удачная команда доходит тем же путём и с нулём: отсев по коду - не дело читателя.
  terminal.write("node -v\r");
  await until(() => runs.length > 1, "удачная команда в PowerShell");
  assert.equal(runs[1].code, 0, `у удачной команды код не ноль: ${JSON.stringify(runs[1])}`);

  // Enter на пустой строке команды за собой не оставляет - иначе падение слалось бы дважды.
  terminal.write("\r");
  terminal.write("node -v\r");
  await until(() => runs.length > 2, "вторая удачная команда в PowerShell");
  assert.equal(runs.length, 3, `пустая строка сошла за команду: ${JSON.stringify(runs)}`);

  terminal.stop();
  await until(() => exited, "выход PowerShell");
}

// Тот же путь в bash: разметка кладётся другим способом, а читатель один и тот же.
{
  const dir = join(ROOT, "bash");
  await mkdir(dir);
  const runs: CommandRun[] = [];
  let exited = false;
  // Полным путём, а не именем: на этой машине голое `bash.exe` уводит в System32, к WSL -
  // CreateProcess смотрит туда раньше PATH. Проверено разведкой на дампе потока.
  const found = BASH_PATHS.find((path) => existsSync(path));
  const shell = found ? markShell({ command: found, args: [] }, rc) : null;
  const terminal = shell && openTerminal(shell, dir, createRunReader((run) => runs.push(run)), () => (exited = true));
  if (!terminal) {
    console.log("shell-marks: bash на машине не нашёлся, его разметка не проверялась");
  } else {
    terminal.write("node -e \"console.log('BROKE-HERE'); process.exit(3)\"\r");
    await until(() => runs.length > 0, "упавшая команда в bash");

    const run = runs[0];
    assert.equal(run.code, 3, `код возврата не тот: ${JSON.stringify(run)}`);
    assert.match(run.command, /process\.exit\(3\)/, `команда не та: ${run.command}`);
    assert.match(run.output, /BROKE-HERE/, `вывод не тот: ${JSON.stringify(run.output)}`);

    terminal.write("node -v\r");
    await until(() => runs.length > 1, "удачная команда в bash");
    assert.equal(runs[1].code, 0, `у удачной команды код не ноль: ${JSON.stringify(runs[1])}`);
    // stop() снимает дерево в фоне, а процесс, которым bash сразу после команды считает PS1
    // (`__git_ps1` у Git for Windows), держит папку, пока жив: rm до выхода падал EBUSY.
    terminal.stop();
    await until(() => exited, "выход bash");
  }
}

await rm(ROOT, { recursive: true, force: true });
console.log("shell-marks: все проверки пройдены");

// Выход явный: отказавший запуск оставляет внутри node-pty открытый сокет (см. ponytail
// в terminal.ts), и без этой строки проверка висела бы после последнего assert.
process.exit(0);
