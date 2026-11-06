// Терминал карточки: настоящий процесс оболочки в псевдотерминале, а не эмуляция.
// Так в карточке работает любой CLI, включая агентов - решение записано в SPEC.md.
import { execFile } from "node:child_process";
import { spawn } from "node-pty";
import type { MarkedShell } from "./shell-marks";

export type Terminal = {
  /** Идентификатор процесса оболочки: по нему видно, что закрытие карточки его унесло. */
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  stop: () => void;
};

/**
 * Размер до первого измерения карточкой. Оболочка требует размер уже при запуске, а карточка
 * сообщит свой, как только отрисуется, - до этого момента вывод переносится по этой ширине.
 */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

/**
 * Оболочка в папке карточки. Ошибка наружу не выходит: команды нет в PATH или папки нет на
 * диске - терминала просто не будет, а карточка скажет об этом вместо падения приложения.
 *
 * conpty - вложенный в node-pty, а не встроенный в Windows. Встроенный conpty Windows 10 не
 * пропускает к xterm альтернативный экран и мышь (полноэкранный агент без них не работает),
 * а при смене размера печатает экран заново жёсткими переносами: xterm копил копии строк и
 * не переносил длинные по новой ширине.
 */
export function openTerminal(
  shell: MarkedShell,
  cwd: string,
  onData: (chunk: string) => void,
  onExit: () => void,
): Terminal | null {
  let pty;
  try {
    pty = spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd,
      // Своё окружение оболочки добавляется к окружению приложения, а не заменяет его:
      // разметке нужна одна переменная, а PATH и остальное оболочке нужны все.
      env: { ...process.env, ...shell.env } as Record<string, string>,
      useConptyDll: true,
    });
  } catch {
    // ponytail: неудачный запуск оставляет внутри node-pty открытый сокет - объекта на руках
    // нет, закрыть его нечем. Потолок: карточка с неверной оболочкой держит один сокет до
    // выхода из приложения. Апгрейд, если упрётся, - проверять команду и папку до запуска.
    return null;
  }

  // Обращение к завершённому псевдотерминалу бросает и роняет главный процесс, а ввод из
  // карточки приходит и после завершения: оболочку закрыли командой exit, окно ещё живо.
  let live = true;

  pty.onData(onData);
  pty.onExit(() => {
    live = false;
    onExit();
  });

  return {
    pid: pty.pid,
    write: (data) => {
      if (live) pty.write(data);
    },
    resize: (cols, rows) => {
      if (live) pty.resize(cols, rows);
    },
    stop: () => {
      if (!live) return;
      live = false;
      // conpty Windows 10 закрывает консоль вызовом, который держит главный поток, пока не выйдут
      // все процессы консоли. Агент с потомками выходит секунды, и всё это время окно не принимает
      // ввод: мышь и клавиатура идут через главный процесс. Поэтому сперва дерево процесса снимается
      // отдельной командой, в стороне от главного потока, а консоль закрывается, когда она уже пуста.
      if (process.platform !== "win32") return pty.kill();
      execFile("taskkill", ["/PID", String(pty.pid), "/T", "/F"], { windowsHide: true }, () => {
        try {
          pty.kill();
        } catch {
          // Консоль уже закрылась вместе с процессом: закрывать нечего.
        }
      });
    },
  };
}
