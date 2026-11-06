// Настройки приложения: то, что правится руками в файле, а не кодом.
import { readFile } from "node:fs/promises";

/** Чем запускать и с какими аргументами: оболочка карточки терминала или агент. */
export type Shell = { command: string; args: string[] };

export type Settings = { shell: Shell };

/**
 * Умолчания отдаются свежим значением, а не общей константой: их получатель волен
 * складывать в них своё, и правка у одного не должна доезжать до остальных.
 * PowerShell берётся без логотипа, но с профилем человека (решение Влада): приглашение в карточке - то же, что
 * в его PowerShell (starship и прочее из профиля); разметка shell-marks.ts оборачивает его, а не заменяет.
 * Список агентов - известные CLI, а не установленные: чего нет в PATH, того не будет
 * и в выборе. Список правится руками, когда появится агент, о котором тут не знают.
 */
function defaults(): Settings {
  return {
    shell: { command: "powershell.exe", args: ["-NoLogo"] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Одна запись "чем запускать": и оболочка, и агент описаны в файле одинаково. */
function parseShell(raw: unknown): Shell | null {
  if (!isRecord(raw)) return null;
  const { command, args } = raw;
  if (typeof command !== "string" || !command) return null;
  if (args !== undefined && !isStrings(args)) return null;
  return { command, args: args ?? [] };
}

/**
 * Настройки из прочитанного значения. Файл правится руками, поэтому непонятное значение
 * заменяется умолчанием: приложение без оболочки бесполезно, а с чужой - опасно.
 * Аргументов может не быть вовсе - оболочка запустится без них.
 * Оболочка и список агентов чинятся порознь: опечатка в одном не уносит другое.
 * Внутри списка выкидывается только битая запись - остальные агенты пользователю нужны,
 * а пустой список остаётся пустым: это выбор "агентов не предлагать", а не поломка.
 */
export function parseSettings(raw: unknown): Settings {
  const fallback = defaults();
  if (!isRecord(raw)) return fallback;
  return {
    shell: parseShell(raw.shell) ?? fallback.shell,
  };
}

/** Настройки с диска. Файла нет, не читается или не разбирается - работают умолчания. */
export async function loadSettings(file: string): Promise<Settings> {
  try {
    return parseSettings(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return defaults();
  }
}
