// Разметка приглашения оболочки. Кода возврата в потоке PTY нет вовсе - оболочка печатает
// вперемешку вывод команд и своё приглашение, - поэтому приглашение переучивается печатать
// невидимые маркеры: где начался вывод команды и с каким кодом она завершилась. Приём тот же,
// что у терминала VS Code: OSC 133. Читает их обратно command-runs.ts.
// Модуль про Electron ничего не знает и поэтому проверяется обычным node.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Shell } from "./settings";

/**
 * Оболочка, которой к аргументам и окружению добавили разметку. Окружение нужно одному zsh:
 * своего аргумента под файл настроек у него нет.
 */
export type MarkedShell = Shell & { env?: Record<string, string> };

/**
 * Разметка для PowerShell. Приглашение печатает маркер завершения с кодом и командной строкой,
 * а чтение строки ввода - маркер начала вывода: без него в вывод попала бы вся перерисовка
 * строки, которую ведёт PSReadLine, пока команду набирают.
 * ponytail: маркер начала стоит после нажатия Enter, а не в конце приглашения, поэтому само
 * приглашение и набранная команда остаются в собранном выводе. Потолок отсюда: conpty отдаёт
 * не поток печати, а перерисовку экрана, и маркер из приглашения приезжает раньше самого
 * приглашения - проверено дампом потока. Апгрейд, если шум помешает, - собирать вывод из
 * разобранного буфера терминала, а не из потока.
 * Номер записи истории отсекает повтор: Enter на пустой строке рисует приглашение заново,
 * но новой команды за ним нет.
 * ponytail: при неудаче код берётся из $LASTEXITCODE, а он держится от последней внешней
 * команды. Потолок - упавший командлет после упавшей программы покажет её код, а не свой;
 * оба не ноль, и на "команда упала" это не влияет. Апгрейд - разбирать вид последней записи
 * истории.
 * Видимое приглашение - то, что было до разметки: из профиля (starship и подобные) или стандартное "PS папка>".
 * Перед его вызовом $? снова ложь, если команда упала: Write-Error с Ignore ставит его, не трогая $Error, - иначе
 * чужое приглашение всегда видело бы успех своей строки разметки.
 */
const POWERSHELL_SETUP = [
  "$global:__wsHistory = -1",
  "$global:__wsPrompt = $function:prompt",
  // Модуль подгружается явно: до входа в разговорный режим его функции может ещё не быть,
  // и подмена ниже тогда молча не случилась бы. Повторный импорт уже загруженного - ничто.
  "Import-Module PSReadLine -ErrorAction SilentlyContinue",
  "if ($function:PSConsoleHostReadLine) {",
  "  $global:__wsRead = $function:PSConsoleHostReadLine",
  "  function global:PSConsoleHostReadLine {",
  "    $line = $global:__wsRead.Invoke()",
  '    [Console]::Write("$([char]27)]133;C$([char]7)")',
  "    $line",
  "  }",
  "}",
  "function global:prompt {",
  "  $ok = $?",
  "  $last = $LASTEXITCODE",
  "  $entry = Get-History -Count 1",
  // Сама настройка приезжает командой и ложится в историю - но уже после того, как выполнилась,
  // так что отсечь её может только первое приглашение.
  "  if ($global:__wsHistory -eq -1) { $global:__wsHistory = $entry.Id }",
  "  $mark = ''",
  "  if ($entry -and $entry.Id -ne $global:__wsHistory) {",
  "    $global:__wsHistory = $entry.Id",
  "    $code = if ($ok) { 0 } elseif ($last) { $last } else { 1 }",
  "    $line = $entry.CommandLine -replace '\\s+', ' '",
  '    $mark = "$([char]27)]133;D;$code;$line$([char]7)"',
  "  }",
  "  $global:LASTEXITCODE = $last",
  "  if (-not $ok) { Write-Error '' -ErrorAction Ignore }",
  "  $mark + ((& $global:__wsPrompt) -join '')",
  "}",
].join("\n");

/**
 * Та же разметка для оболочек семейства posix, одним файлом на bash и zsh: у zsh есть готовые
 * крючки preexec и precmd, у bash их заменяют ловушка DEBUG и PROMPT_COMMAND.
 * Файл настроек пользователя читается первым: приложение подменяет его своим, а не отменяет.
 * ponytail: у bash ловушка DEBUG срабатывает и на команды самого приглашения, поэтому маркер
 * начала вывода ставится только на первую команду строки - её и хватает.
 */
const RC_SCRIPT = [
  "# Hyperloom: разметка приглашения для карточки терминала. Файл заводится приложением.",
  'if [ -n "$ZSH_VERSION" ]; then',
  '  [ -f "$HOME/.zshrc" ] && ZDOTDIR="$HOME" . "$HOME/.zshrc"',
  "  __ws_pre() { __ws_cmd=$1; printf '\\033]133;C\\007'; }",
  "  __ws_post() { local code=$?; printf '\\033]133;D;%s;%s\\007' \"$code\" \"$__ws_cmd\"; __ws_cmd=''; }",
  "  autoload -Uz add-zsh-hook",
  "  add-zsh-hook preexec __ws_pre",
  "  add-zsh-hook precmd __ws_post",
  "else",
  '  [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
  "  __ws_pre() { [ -n \"$__ws_busy\" ] && return; __ws_busy=1; printf '\\033]133;C\\007'; }",
  "  __ws_post() {",
  "    local code=$? id cmd",
  '    read -r id cmd <<< "$(HISTTIMEFORMAT= history 1)"',
  // Первое приглашение только запоминает номер: в history 1 тогда последняя строка прошлых сессий.
  '    if [ -n "${__ws_id+x}" ] && [ "$id" != "$__ws_id" ]; then',
  "      printf '\\033]133;D;%s;%s\\007' \"$code\" \"$cmd\"",
  "    fi",
  '    __ws_id=$id',
  "    __ws_busy=",
  "  }",
  '  PROMPT_COMMAND="__ws_post${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  "  trap '__ws_pre' DEBUG",
  "fi",
  "",
].join("\n");

/**
 * Файл разметки для оболочек posix рядом с настройками приложения. Имя .zshrc не случайно:
 * bash берёт файл аргументом с любым именем, а zsh читает из каталога только его.
 */
export function installRc(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, ".zshrc");
  writeFileSync(file, RC_SCRIPT, "utf8");
  return file;
}

/**
 * Имя команды: путь и расширение не важны, важно, чем размечать. Тем же именем узнаёт
 * своего агента agent-hooks.ts - в PATH команда лежит и как .cmd, и как .exe.
 */
export function commandName(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

/**
 * Оболочка с разметкой приглашения. Незнакомая оболочка возвращается как была: маркеров
 * от неё не будет.
 * Разметка едет аргументами запуска, а не строкой в готовую оболочку: набранного приложением
 * в карточке видно быть не должно.
 */
export function markShell(shell: Shell, rcFile: string): MarkedShell {
  const name = commandName(shell.command);
  if (name === "powershell" || name === "pwsh") {
    // Скрипт уезжает закодированным: кавычки внутри него иначе пришлось бы прятать от того,
    // как Windows собирает командную строку из аргументов.
    const encoded = Buffer.from(POWERSHELL_SETUP, "utf16le").toString("base64");
    return { ...shell, args: [...shell.args, "-NoExit", "-EncodedCommand", encoded] };
  }
  if (name === "bash") return { ...shell, args: [...shell.args, "--init-file", rcFile] };
  if (name === "zsh") return { ...shell, env: { ZDOTDIR: dirname(rcFile) } };
  return shell;
}
