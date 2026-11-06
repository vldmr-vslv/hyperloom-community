// Слежение за папкой на диске: чтобы карточка папки показывала то, что на диске сейчас.
//
// Про Windows, замерено на этой машине: после удаления наблюдаемой папки watch не отдаёт
// ошибку, а сыплет событиями про саму папку без остановки - 20 тысяч за полсекунды, и close()
// поток не обрывает. Отсюда две меры ниже: слежение снимается на первом же таком событии,
// а его хвост отсекается по номеру слежения - иначе всплеск не кончится никогда, а вместе
// с ним не кончится и ожидание тишины.
import { watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Всплеск событий (npm install, git checkout) сходится в одно уведомление: иначе на каждый
 * из тысяч файлов уехал бы свой перечит папки. Список обновляется, когда всплеск стих.
 * ponytail: потолок - непрерывная запись в папку откладывает обновление до её конца.
 * Апгрейд, если упрётся, - второй таймер потолком ожидания.
 */
const QUIET_MS = 150;

/** Вызов откладывается, пока события не стихнут: пачка событий сходится в один вызов. */
function debounce(ms: number, action: () => void) {
  let timer: NodeJS.Timeout | null = null;
  return {
    fire: (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(action, ms);
    },
    cancel: (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Слежение за одним путём. Ошибка наружу не выходит: папки нет или доступа нет - слежения
 * просто не будет. Сорвавшееся слежение приходит в onEvent событием про сам путь:
 * для наблюдателя это то же самое, что и удаление.
 */
function open(target: string, onEvent: (about: string | null) => void): FSWatcher | null {
  let watcher: FSWatcher;
  try {
    watcher = watch(target, (_event, filename) => onEvent(filename));
  } catch {
    return null;
  }
  // Необработанное событие error на EventEmitter уронило бы главный процесс.
  watcher.on("error", () => onEvent(target));
  return watcher;
}

/**
 * Один и тот же путь Windows отдаёт по-разному: с префиксом длинного пути, любым регистром
 * и любым разделителем. Отрезок "?" - это и есть остаток префикса; именем он не бывает.
 */
function samePath(a: string, b: string): boolean {
  const plain = (path: string) =>
    path
      .split(/[\\/]/)
      .filter((part) => part && part !== "?")
      .join("/")
      .toLowerCase();
  return plain(a) === plain(b);
}

/**
 * Слежение за содержимым папки. onChange вызывается, когда в папке что-то поменялось,
 * а также когда саму папку удалили с диска или вернули на место.
 * Возвращает функцию, прекращающую слежение.
 */
export function watchFolder(path: string, onChange: () => void): () => void {
  let inside: FSWatcher | null = null;
  let alive = 0; // номер живого слежения внутри папки: по нему отсекается хвост прежнего

  let stopped = false;

  const quiet = debounce(QUIET_MS, () => {
    if (stopped) return;
    // Папка могла вернуться на место, пока слежения за ней не было.
    if (!inside) inside = openInside();
    onChange();
  });

  const openInside = (): FSWatcher | null => {
    const mine = (alive += 1);
    return open(path, (about) => {
      if (mine !== alive) return; // хвост оборванного слежения, работы по нему никакой
      // Событие про саму папку, а не про её содержимое: её удалили или переименовали.
      if (about !== null && samePath(about, path)) {
        inside?.close();
        inside = null;
        alive += 1;
      }
      quiet.fire();
    });
  };

  inside = openInside();

  // Родительская папка: только она скажет, что путь вернули на место - слежения за
  // удалённым уже нет. Событие про соседа пропускается: за содержимым соседа мы не следим,
  // а карточка файла по такому уведомлению уводила бы агенту то, чего никто не менял.
  // Имя в событии не пришло - будим на всякий случай: это дешевле пропущенного возврата.
  // ponytail: потолок - удалить путь вместе с его родителем, и возврат не заметит никто:
  // слежения не останется совсем.
  // Апгрейд, когда упрётся, - опрос пути по таймеру, пока ни одно слежение не открылось.
  const parent = dirname(path);
  const outside =
    parent === path
      ? null
      : open(parent, (about) => {
          if (inside && about !== null && !samePath(join(parent, about), path)) return;
          quiet.fire();
        });

  return () => {
    stopped = true;
    quiet.cancel();
    inside?.close();
    outside?.close();
  };
}
