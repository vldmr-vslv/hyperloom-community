// Чтение размеченного потока оболочки: где начался вывод команды и с каким кодом она
// завершилась. Разметку в саму оболочку ставит shell-marks.ts; здесь только чтение.
// Модуль про Electron ничего не знает и поэтому проверяется обычным node.
import { hideSecrets } from "../shared/secrets.ts";

/** Начало любого маркера; на конце - BEL. Оба знака печатает разметка из shell-marks.ts. */
const MARK = "\u001b]133;";
const BEL = "\u0007";

/** Что случилось в терминале: команда, её код возврата и её вывод без управляющих знаков. */
export type CommandRun = { command: string; code: number; output: string };

/**
 * Сколько вывода доходит до получателя. Промпт агента - не место для мегабайта сборки,
 * а ошибка обычно стоит в конце, поэтому режется начало.
 */
const OUTPUT_CAP = 4000;
/** Сырого вывода держим с запасом на управляющие последовательности: они уйдут при разборе. */
const RAW_CAP = OUTPUT_CAP * 5;
const CUT_NOTE = "[начало вывода отброшено]\n";

/**
 * Вывод без того, чего в промпте агенту делать нечего: цвета, движения курсора, заголовки
 * окна и одиночные возвраты каретки от индикаторов выполнения.
 * ponytail: последовательности вычёркиваются набором правил, а не разбором терминала.
 * Потолок - редкая последовательность вроде запроса ответа от терминала останется в тексте.
 * Апгрейд, если упрётся, - гонять вывод через xterm с headless-буфером.
 */
function plain(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, "")
    .replace(/\u001b[[(][0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
}

/** Хвост куска, с которого может начинаться разрезанный пополам маркер. */
function partialMark(text: string): string {
  for (let size = Math.min(MARK.length - 1, text.length); size > 0; size -= 1) {
    const tail = text.slice(-size);
    if (MARK.startsWith(tail)) return tail;
  }
  return "";
}

/**
 * Тело маркера завершения: "D;код;команда". Команды в нём нет - приглашение нарисовалось
 * само, до первой команды или после Enter на пустой строке, и посылать нечего.
 */
function parseDone(body: string): { code: number; command: string } | null {
  if (!body.startsWith("D;")) return null;
  const rest = body.slice(2);
  const split = rest.indexOf(";");
  const code = Number(split < 0 ? rest : rest.slice(0, split));
  const command = split < 0 ? "" : rest.slice(split + 1).trim();
  return command && Number.isInteger(code) ? { code, command } : null;
}

/**
 * Собранный вывод в том виде, в каком его увидит получатель: без лишнего и не длиннее потолка.
 * Секреты скрываются до среза: срез посреди значения отрезал бы имя, и хвост значения ушёл бы открытым.
 */
function trimOutput(raw: string, dropped: boolean): string {
  const text = hideSecrets(plain(raw).trim());
  if (text.length <= OUTPUT_CAP) return dropped ? CUT_NOTE + text : text;
  return CUT_NOTE + text.slice(-OUTPUT_CAP);
}

/**
 * Читатель потока размеченной оболочки: ему скармливают куски вывода, он отдаёт завершившиеся
 * команды. Что делать с удачными, решает не он - здесь только чтение. onBusy узнаёт, что команда
 * пошла (true) и что приглашение нарисовалось снова (false).
 * Куски приходят как их отдал PTY, поэтому маркер приезжает и разрезанным пополам.
 */
export function createRunReader(
  onRun: (run: CommandRun) => void,
  onBusy?: (busy: boolean) => void,
): (chunk: string) => void {
  // Хвост предыдущего куска, в котором мог начаться маркер, и вывод текущей команды.
  let pending = "";
  let output = "";
  let dropped = false;

  const add = (part: string): void => {
    output += part;
    if (output.length <= RAW_CAP) return;
    output = output.slice(-RAW_CAP);
    dropped = true;
  };

  /** Тело маркера: "C" - пошёл вывод команды, "D;код;команда" - команда завершилась. */
  const mark = (body: string): void => {
    const done = body === "C" ? null : parseDone(body);
    if (done) onRun({ ...done, output: trimOutput(output, dropped) });
    if (body === "C" || body.startsWith("D")) onBusy?.(body === "C");
    // И начало вывода, и его конец обнуляют накопленное: следующая команда пишет с чистого.
    output = "";
    dropped = false;
  };

  return (chunk: string): void => {
    let text = pending + chunk;
    pending = "";
    for (;;) {
      const at = text.indexOf(MARK);
      if (at < 0) break;
      const end = text.indexOf(BEL, at);
      add(text.slice(0, at));
      if (end < 0) {
        // Маркер пришёл не целиком: до него - вывод, остальное ждёт следующего куска.
        pending = text.slice(at);
        return;
      }
      mark(text.slice(at + MARK.length, end));
      text = text.slice(end + 1);
    }
    pending = partialMark(text);
    add(pending ? text.slice(0, -pending.length) : text);
  };
}
