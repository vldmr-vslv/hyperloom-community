// Проверка разбора настроек: node src/main/settings.check.ts
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, parseSettings } from "./settings.ts";

// Настроек нет вовсе - оболочкой работает PowerShell, а не пустота.
{
  const byDefault = parseSettings(undefined);
  assert.equal(byDefault.shell.command, "powershell.exe");
  assert.ok(Array.isArray(byDefault.shell.args));
}

// Файл правится руками, поэтому мусор в нём не должен оставлять приложение без оболочки.
{
  const fallback = parseSettings(undefined);
  for (const broken of [null, 42, "powershell", [], {}, { shell: null }, { shell: 42 }, { shell: {} }, { shell: { command: "" } }, { shell: { command: 5 } }, { shell: { command: "sh", args: "-l" } }, { shell: { command: "sh", args: [1, 2] } }]) {
    assert.deepEqual(parseSettings(broken), fallback, `мусор принят за настройки: ${JSON.stringify(broken)}`);
  }
}

// Заданная руками оболочка берётся из файла целиком: и команда, и её аргументы.
{
  const settings = parseSettings({ shell: { command: "cmd.exe", args: ["/K", "chcp 65001"] } });
  assert.equal(settings.shell.command, "cmd.exe");
  assert.deepEqual(settings.shell.args, ["/K", "chcp 65001"]);
}

// Аргументы можно не писать вовсе - оболочка запустится без них.
{
  const settings = parseSettings({ shell: { command: "bash.exe" } });
  assert.equal(settings.shell.command, "bash.exe");
  assert.deepEqual(settings.shell.args, []);
}






// Чтение с диска: файла нет - умолчание; файл есть - его значения.
{
  const dir = join(tmpdir(), "hyperloom-settings");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const file = join(dir, "settings.json");

  assert.deepEqual(await loadSettings(file), parseSettings(undefined), "нет файла - не умолчание");

  await writeFile(file, '{ "shell": { "command": "cmd.exe", "args": ["/K"] } }', "utf8");
  assert.equal((await loadSettings(file)).shell.command, "cmd.exe");

  // Не разбирается как JSON - приложение всё равно поднимается с умолчанием.
  await writeFile(file, "{ это не json", "utf8");
  assert.deepEqual(await loadSettings(file), parseSettings(undefined), "битый файл уронил чтение");

  await rm(dir, { recursive: true, force: true });
}

console.log("settings: все проверки пройдены");
