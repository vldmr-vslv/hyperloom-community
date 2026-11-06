import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { CommandRun } from "../../main/command-runs";
import type { TerminalSession } from "../../preload";
import { plural } from "./ring-svg";

/**
 * Значение токена из index.css. Цвета и шрифт терминала - те же токены, что у полотна:
 * карточка не должна выглядеть чужой заплатой. xterm рисует сам и var() не понимает,
 * поэтому ему нужно готовое значение.
 */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type MouseCoords = (event: MouseEvent, element: HTMLElement, ...rest: unknown[]) => unknown;

/**
 * xterm считает клетку под мышью по экранным пикселям, а полотно масштабирует карточку через CSS transform: при масштабе
 * не 1 щелчок попадал в чужую клетку - выделение, ссылки и мышь у claude. Обе его службы координат получают точку,
 * переведённую в несжатые пиксели экрана xterm.
 * ponytail: подмена лезет в закрытое поле xterm 6 (_core._mouseService). Пропало после обновления xterm - в консоли
 * предупреждение, и вернётся сдвиг; апгрейд - перехват событий мыши на захвате с поправленными clientX/clientY.
 */
function unscaleMouse(view: Terminal): void {
  const mouse = (view as unknown as { _core?: { _mouseService?: Record<"getCoords" | "getMouseReportCoords", MouseCoords> } })._core?._mouseService;
  if (!mouse?.getCoords || !mouse.getMouseReportCoords) {
    console.warn("xterm: нет _core._mouseService, координаты мыши при масштабе полотна не поправлены");
    return;
  }
  for (const name of ["getCoords", "getMouseReportCoords"] as const) {
    const original = mouse[name].bind(mouse);
    mouse[name] = (event, element, ...rest) => {
      const rect = element.getBoundingClientRect();
      const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
      const local = { clientX: rect.left + (event.clientX - rect.left) / scale, clientY: rect.top + (event.clientY - rect.top) / scale };
      return original(local as MouseEvent, element, ...rest);
    };
  }
}

/**
 * Шрифт экрана - шрифт полотна, а значки приглашения (starship и подобные), которых в нём нет, браузер берёт из
 * Nerd-шрифта: Agave Nerd Font стоит у PowerShell в Windows Terminal на этой машине (решение Влада).
 * ponytail: имя шрифта вшито. Нет его в системе - значки квадратиками, как без него. Апгрейд - шрифт в settings.json.
 */
function screenFont(): string {
  const base = token("--font-mono");
  const nerd = '"Agave Nerd Font"';
  return /monospace\s*$/.test(base) ? base.replace(/monospace\s*$/, `${nerd}, monospace`) : `${base}, ${nerd}`;
}

/**
 * Тело карточки терминала: настоящий процесс, запущенный в папке карточки.
 * Размер процесса идёт следом за размером карточки, иначе вывод переносился бы не по краю.
 */
export function TerminalBody({
  path,
  card,
  onDone,
  onRun,
}: {
  path: string;
  /** Идентификатор карточки: по нему главный процесс находит её процесс и её хуки. */
  card: string;
  /** Команда в этой карточке завершилась, с любым кодом: карточка подсвечивает упавшую. */
  onDone?: (run: CommandRun) => void;
  /** Идёт ли в терминале команда. У карточки агента не вызывается: разметки приглашения там нет. */
  onRun?: (busy: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Плашка у курсора: выделенное ушло в буфер.
  const [copied, setCopied] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // Обработчики берутся из ссылки, а не из зависимостей: смена обработчика не должна
  // перезапускать процесс в карточке, а зависимость от них делала бы ровно это.
  const handlers = useRef({ onDone, onRun });
  handlers.current = { onDone, onRun };

  const gone = "оболочка завершилась";
  const dead = "оболочка не запустилась";

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    const screen = "terminal";
    const colors = () => ({
      background: token(`--${screen}-screen`),
      foreground: token(`--${screen}-text`),
      cursor: token(`--${screen}`),
      cursorAccent: token(`--${screen}-screen`),
      selectionBackground: token(`--${screen}-selection`),
    });
    const view = new Terminal({
      theme: colors(),
      fontFamily: screenFont(),
      fontSize: 12,
      cursorBlink: true,
      // Вывод длиннее этого числа строк уезжает безвозвратно: полотно держит много карточек,
      // и история каждой стоит памяти.
      scrollback: 2000,
    });
    const fit = new FitAddon();
    view.loadAddon(fit);
    view.open(node);
    unscaleMouse(view);

    let session: TerminalSession | null = null;
    let closed = false;


    // Ctrl+C при выделении и Ctrl+Shift+C копируют выделенное, как в Windows Terminal: xterm сам не копирует и
    // отдал бы программе прерывание. Без выделения Ctrl+C - прерывание, как было.
    // Ctrl+V в агенте - вставка из буфера, а не клавиша: xterm отдал бы программе байт \x16, а claude
    // на Windows по нему не вставляет ничего. Отпущенное xterm-ом нажатие браузер делает вставкой
    // в поле ввода xterm, и текст уходит программе вставкой. Карточку терминала это не трогает:
    // PowerShell по \x16 вставляет сам.
    view.attachCustomKeyEventHandler((event) => {
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      if (ctrl && event.code === "KeyC" && (event.shiftKey || view.hasSelection())) {
        if (event.type === "keydown" && view.hasSelection()) {
          void navigator.clipboard.writeText(view.getSelection());
          view.clearSelection();
        }
        return false;
      }
      return true;
    });
    // Правая кнопка - вставка, как в консоли Windows. Оболочке уходит Ctrl+V: PowerShell вставляет сам, и
    // многострочное не выполняется построчно. Агенту - тем же путём, что его Ctrl+V.
    // ponytail: bash и zsh из настроек читают Ctrl+V как "следующий знак буквально", а не вставку. Апгрейд - знать
    // в окне, какая оболочка у карточки, и слать им текст вставкой xterm.
    const contextPaste = (event: MouseEvent) => {
      event.preventDefault();
      if (!session) return;
      session.write("\u0016");
    };
    node.addEventListener("contextmenu", contextPaste);
    // Выделенное мышью сразу уходит в буфер, как в Windows Terminal, а у курсора плашка, сколько строк. Выделение
    // остаётся на экране; Ctrl+C с ним копирует, как раньше.
    const copyOnSelect = (event: MouseEvent) => {
      if (event.button !== 0 || !view.hasSelection()) return;
      const text = view.getSelection();
      if (!text.trim()) return;
      const n = text.replace(/\s+$/, "").split(/\r?\n/).length;
      const at = { x: event.clientX, y: event.clientY };
      void navigator.clipboard.writeText(text).then(
        () => setCopied({ ...at, text: `скопировано: ${n} ${plural(n, ["строка", "строки", "строк"])}` }),
        () => setCopied({ ...at, text: "не скопировано" }),
      );
    };
    // На захвате: на двойном щелчке до всплытия отпускание не доходит, а слово xterm выделяет уже на нажатии.
    node.addEventListener("mouseup", copyOnSelect, true);

    /**
     * Карточка меняет размер и при перетаскивании соседей, поэтому размер оболочки правится
     * только когда он и правда стал другим. Нулевая ширина бывает у ещё не отрисованной
     * карточки - fit на ней бросает.
     */
    const resize = () => {
      if (node.clientWidth === 0 || node.clientHeight === 0) return;
      const size = fit.proposeDimensions();
      if (!size || (size.cols === view.cols && size.rows === view.rows)) return;
      fit.fit();
      session?.resize(view.cols, view.rows);
    };
    resize();

    // Снимаемая карточка закрывает свой процесс; при смене сессии - только отключается от него.
    const release = (opened: TerminalSession) => opened.close();
    void window.terminalApi
      .open(path, card, {
        data: (chunk) => view.write(chunk),
        exit: () => {
          view.write(`\r\n\u001b[90m[${gone}]\u001b[0m\r\n`);
          // Процесс кончился посреди команды - команды больше нет.
          handlers.current.onRun?.(false);
        },
        done: (run) => handlers.current.onDone?.(run),
        run: (busy) => handlers.current.onRun?.(busy),
      })
      .then((opened) => {
        // Карточку успели закрыть, пока оболочка поднималась: процессу здесь уже некому писать.
        if (closed) {
          if (opened) release(opened);
          return;
        }
        if (!opened) {
          setFailed(true);
          return;
        }
        session = opened;
        const listen = () =>
          view.onData((input) => {
            // Ответы xterm на вопросы программы Enter не несут: по нему узнаётся набранное человеком.
            opened.write(input);
          });
        // Хвост вывода после переподключения xterm разбирает заново и заново отвечает на вопросы
        // терминалу в нём: вложенный conpty при старте спрашивает, что за терминал. Ответ
        // ушёл бы программе вводом - cmd печатал его строкой ^[[?1;2c. Ввод подключается, когда
        // хвост разобран: пустая запись ждёт в той же очереди разбора.
        if (opened.reattached) view.write("", listen);
        else listen();
        opened.resize(view.cols, view.rows);
      });

    const observer = new ResizeObserver(resize);
    observer.observe(node);
    // Сменили тему - экран перекрашивается сразу: xterm рисует сам и var() не понимает, поэтому
    // цвета перечитываются из токенов новой темы.
    const retheme = () => {
      view.options.theme = colors();
      view.options.fontFamily = screenFont();
    };
    window.addEventListener("theme-change", retheme);

    return () => {
      closed = true;
      window.removeEventListener("theme-change", retheme);
      node.removeEventListener("contextmenu", contextPaste);
      node.removeEventListener("mouseup", copyOnSelect, true);
      observer.disconnect();
      if (session) release(session);
      view.dispose();
    };
  }, [path, card, gone]);

  return (
    <>
      {failed && <div className="card__missing">{dead}</div>}
      {/* nodrag и nowheel: внутри карточки работает выделение и прокрутка вывода,
          а не перетаскивание и зум полотна. */}
      <div ref={host} className="card__terminal nodrag nowheel" />
      {copied && createPortal(<div className="tip tip--on" style={{ left: copied.x + 12, top: copied.y - 30 }}>{copied.text}</div>, document.body)}
    </>
  );
}
