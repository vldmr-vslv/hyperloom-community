// Модель канваса: карточки, стрелки и операции над ними.
// Чистые функции над значением раскладки - ни Electron, ни DOM, ни диска здесь нет,
// поэтому модуль запускается обычным node и проверяется без тестового фреймворка.

const LAYOUT_VERSION = 2;

/** Идентификатор корневой карточки постоянен: так его видно глазами в файле раскладки. */
export const ROOT_CARD_ID = "root";

const DEFAULT_CARD_SIZE = { width: 320, height: 220 };

export type Position = { x: number; y: number };
export type Size = { width: number; height: number };


/**
 * Чем карточка занята. Тип живёт в раскладке, а не выясняется с диска: терминал, агент
 * и заметка тоже привязаны к пути, и после перезапуска их друг от друга не отличить.
 */
const CARD_KINDS = ["folder", "file", "terminal", "note"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/**
 * Карточек одного вида в папке бывает несколько: и терминалов, и агентов. Путь у них общий
 * с папкой, поэтому идентификатор им выдаётся с номером, а не берётся путём. У браузер-карточки
 * путь общий с карточкой её файла - по той же причине.
 */
function isNumbered(kind: CardKind): boolean {
  return kind === "terminal";
}

export type Card = {
  id: string;
  kind: CardKind;
  path: string;
  position: Position;
  size: Size;
  /** Карточка свёрнута до шапки. Поля нет - развёрнута, поэтому прежние файлы читаются как были. */
  collapsed?: true;
  /** Подпись корня, заданная человеком. Поля нет - подписан именем своей папки. */
  title?: string;
};


export type Edge = {
  id: string;
  from: string;
  to: string;
};

export type Layout = {
  version: number;
  cards: Card[];
  edges: Edge[];
  /**
   * Цвет проекта по пути папки. Цвет лежит в раскладке, а не на карточке: закрытая и снова
   * открытая папка возвращается в своём цвете. Вложенные папки берут цвет ближайшего предка.
   */
  colors?: Record<string, string>;
  /** Скрытые записи списков: папки и файлы по пути, которых не видно ни в Root, ни в папке. */
  hidden?: string[];
  /**
   * Места закрытых карточек по идентификатору (pathKey): снова открытая карточка встаёт туда же и тем же размером,
   * как папка возвращается в своём цвете. Открытая из списка уходит: её место - в cards.
   */
  places?: Record<string, Place>;
};

/** Где стояла карточка и какого была размера. */
export type Place = { position: Position; size: Size };

/** Сколько мест закрытых карточек помнит раскладка: файлов за месяцы открывается сотни, файл раскладки правится руками. */
const PLACES_KEPT = 500;

/** Раскладка первого запуска: одна карточка каталога проектов, стрелок нет. */
export function initialLayout(rootPath: string): Layout {
  return {
    version: LAYOUT_VERSION,
    cards: [
      {
        id: ROOT_CARD_ID,
        kind: "folder",
        path: rootPath,
        position: { x: 0, y: 0 },
        size: { ...DEFAULT_CARD_SIZE },
      },
    ],
    edges: [],
  };
}

/** Новая раскладка с изменённой позицией и/или размером карточки. Чужой id - раскладка та же. */
export function updateCard(
  layout: Layout,
  id: string,
  patch: Partial<Pick<Card, "position" | "size" | "title">>,
): Layout {
  if (!layout.cards.some((card) => card.id === id)) return layout;
  return {
    ...layout,
    cards: layout.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)),
  };
}

/** Экспортируется ради моста: разбирать чужое значение приходится и ему. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Строка из чужого значения; не строка - пустая. */
export const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
}

function isPlace(value: unknown): value is Place & Record<string, unknown> {
  return (
    isRecord(value) &&
    isRecord(value.position) &&
    isNumber(value.position.x) &&
    isNumber(value.position.y) &&
    isRecord(value.size) &&
    isNumber(value.size.width) &&
    isNumber(value.size.height)
  );
}

function isCard(value: unknown): value is Card {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isCardKind(value.kind) &&
    typeof value.path === "string" &&
    isPlace(value) &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.collapsed === undefined || value.collapsed === true)
  );
}


const HEX = /^#[0-9a-f]{6}$/i;

function isColors(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((hex) => typeof hex === "string" && HEX.test(hex));
}

function isEdge(value: unknown): value is Edge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string"
  );
}


/**
 * Раскладка без карточек незнакомого вида, их связей и стрелок потока. Так сборка без части видов читает
 * раскладку сборки со всеми видами; то, что не похоже на раскладку, отдаётся как есть - его отвергнет isLayout.
 */
export function knownCards(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.cards) || !Array.isArray(value.edges)) return value;
  const cards = value.cards.filter((card) => isRecord(card) && isCardKind(card.kind));
  const ids = new Set(cards.map((card) => card.id));
  const edges = value.edges.filter((edge) => isRecord(edge) && edge.manual === undefined && ids.has(edge.from) && ids.has(edge.to));
  return { ...value, cards, edges };
}

/**
 * Годится ли прочитанное с диска как раскладка. Файл правится руками, доверия к нему нет:
 * проверяется целиком, потому что половина карточек - это не раскладка, а обломки.
 * Пустой список карточек тоже не годится: создать карточку в интерфейсе пока нечем,
 * и пустое полотно оказалось бы тупиком без выхода.
 */
export function isLayout(value: unknown): value is Layout {
  return (
    isRecord(value) &&
    value.version === LAYOUT_VERSION &&
    Array.isArray(value.cards) &&
    value.cards.length > 0 &&
    value.cards.every(isCard) &&
    Array.isArray(value.edges) &&
    value.edges.every(isEdge) &&
    (value.colors === undefined || isColors(value.colors)) &&
    (value.hidden === undefined ||
      (Array.isArray(value.hidden) && value.hidden.every((path) => typeof path === "string"))) &&
    (value.places === undefined || (isRecord(value.places) && Object.values(value.places).every(isPlace)))
  );
}

/** Зазор между родительской карточкой и её потомками. */
const CARD_GAP = 40;

/**
 * Идентификатор карточки. У папки, файла и заметки это сам путь: он уникален, читается в файле
 * раскладки глазами, и та же папка, выбранная второй раз, не заводит двойника.
 * У терминала и агента путь общий с их папкой, поэтому к пути добавляется вид и номер.
 */
function cardId(layout: Layout, path: string, kind: CardKind): string {
  if (!isNumbered(kind)) return path;
  const base = `${kind}:${path}#`;
  let number = 1;
  while (layout.cards.some((card) => card.id === base + number)) number += 1;
  return base + number;
}

/**
 * Карточка для пути со стрелкой принадлежности от родителя: папка от корня, файл,
 * терминал и агент - от папки. Двойник отсекается по идентификатору, а не по пути:
 * у терминала и агента путь тот же, что у их папки.
 */
export function addCard(
  layout: Layout,
  parentId: string,
  path: string,
  kind: CardKind,
): Layout {
  const parent = layout.cards.find((card) => card.id === parentId);
  if (!parent) return layout;
  if (kind === "terminal" && layout.cards.some((card) => card.kind === "terminal")) return layout;
  // У корневой карточки идентификатор постоянный, а не путь, поэтому двойник ищется по пути.
  // Сравнение без учёта слэшей и регистра: корень записан прямыми слэшами, а пути из чтения
  // папки приходят с обратными, и та же папка иначе завела бы двойника.
  if (!isNumbered(kind) && layout.cards.some((card) => pathKey(card.path) === pathKey(path))) return layout;
  const id = cardId(layout, path, kind);

  // Потомки родителя выстраиваются столбиком справа от него; закрытая раньше карточка встаёт на своё место.
  // ponytail: позиция считается один раз при создании и не разъезжается сама,
  // поэтому карточка может лечь на уже подвинутую руками. Апгрейд - раскладка потомков.
  const siblings = layout.edges.filter((edge) => edge.from === parentId).length;
  const { [pathKey(id)]: place, ...places } = layout.places ?? {};
  const card: Card = {
    id,
    kind,
    path,
    position: place?.position ?? {
      x: parent.position.x + parent.size.width + CARD_GAP,
      y: parent.position.y + siblings * (DEFAULT_CARD_SIZE.height + CARD_GAP),
    },
    size: place?.size ?? { ...DEFAULT_CARD_SIZE },
  };

  return {
    ...layout,
    cards: [...layout.cards, card],
    edges: [...layout.edges, { id: `${parentId}->${card.id}`, from: parentId, to: card.id }],
    ...(place && { places }),
  };
}

/** Место, которое раскладка помнит за закрытой карточкой с этим идентификатором. */
export function placeOf(layout: Layout, id: string): Place | undefined {
  return layout.places?.[pathKey(id)];
}


/**
 * Путь для сравнения: пути приходят и с обратными слэшами Windows, и с прямыми, а регистр букв
 * на Windows путь не меняет. Сегменты `.` и `..` сворачиваются: агент называет файл и путём от своей папки с
 * `..`, и полным, а это одна карточка (_scratch/ticket-summary, тикет 14). Выше корня диска `..` не уводит, в начале
 * относительного пути остаётся как есть. Ответ запоминается: слой связей зовёт его тысячи раз за кадр протяжки.
 */
export function pathKey(path: string): string {
  let key = pathKeys.get(path);
  if (key === undefined) {
    if (pathKeys.size > 5000) pathKeys.clear();
    key = normalized(path);
    pathKeys.set(path, key);
  }
  return key;
}

const pathKeys = new Map<string, string>();

function normalized(path: string): string {
  const key = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!/(^|\/)\.\.?(\/|$)/.test(key)) return key;
  const parts: string[] = [];
  for (const part of key.split("/")) {
    if (part === ".") continue;
    if (part !== "..") parts.push(part);
    else {
      const last = parts[parts.length - 1];
      if (last === undefined || last === "..") parts.push(part);
      else if (last !== "" && !/^[a-z]:$/.test(last)) parts.pop();
    }
  }
  return parts.join("/").replace(/\/+$/, "");
}

/** Лежит ли путь внутри папки, на любой глубине. Сама папка внутри себя не лежит. */
export function isInside(path: string, dir: string): boolean {
  return pathKey(path).startsWith(pathKey(dir) + "/");
}

/**
 * Под какой карточкой встаёт папка, которую открыл агент: под ближайшей открытой папкой-предком
 * по пути - так же, как её открыла бы рука из строки этой папки. Вне каталога проектов предка нет:
 * тогда под карточкой, из которой просил агент, если она на полотне, а иначе под корнем.
 */
export function folderParent(layout: Layout, path: string, from?: string): string {
  let parent: Card | undefined;
  for (const card of layout.cards) {
    if (card.kind !== "folder" || !isInside(path, card.path)) continue;
    if (!parent || pathKey(card.path).length > pathKey(parent.path).length) parent = card;
  }
  if (parent) return parent.id;
  if (from && layout.cards.some((card) => card.id === from)) return from;
  return ROOT_CARD_ID;
}

/** Свернуть карточку до шапки или развернуть обратно. Чужой id - раскладка та же. */
export function setCollapsed(layout: Layout, id: string, collapsed: boolean): Layout {
  if (!layout.cards.some((card) => card.id === id)) return layout;
  return {
    ...layout,
    cards: layout.cards.map((card) => {
      if (card.id !== id) return card;
      const next: Card = { ...card, collapsed: true };
      if (!collapsed) delete next.collapsed;
      return next;
    }),
  };
}

/** Цвет проекта для папки. Не цвет вида #rrggbb - раскладка та же. */
export function setColor(layout: Layout, path: string, hex: string): Layout {
  if (!HEX.test(hex)) return layout;
  const colors = Object.fromEntries(
    Object.entries(layout.colors ?? {}).filter(([key]) => pathKey(key) !== pathKey(path)),
  );
  return { ...layout, colors: { ...colors, [path]: hex.toLowerCase() } };
}

/** Цвет назначается только проекту, подпапки берут его от проекта: цвета прочих папок снимаются. Что проект, решает
 *  isProject: модель на диск не смотрит. */
export function projectColors(layout: Layout, isProject: (path: string) => boolean): Layout {
  const colors = Object.entries(layout.colors ?? {});
  const kept = colors.filter(([path]) => isProject(path));
  return kept.length === colors.length ? layout : { ...layout, colors: Object.fromEntries(kept) };
}

/** Цвет проекта для пути: свой или ближайшей папки-предка. Никто не красил - undefined. */
export function colorOf(layout: Layout, path: string): string | undefined {
  let found: [string, string] | undefined;
  for (const entry of Object.entries(layout.colors ?? {})) {
    const [key] = entry;
    const mine = pathKey(key) === pathKey(path) || isInside(path, key);
    if (mine && (!found || pathKey(key).length > pathKey(found[0]).length)) found = entry;
  }
  return found?.[1];
}

/** Скрыть запись из списков Root и папок. Уже скрытая - раскладка та же. */
export function hideEntry(layout: Layout, path: string): Layout {
  if (isHidden(layout, path)) return layout;
  return { ...layout, hidden: [...(layout.hidden ?? []), path] };
}

/** Вернуть скрытую запись в списки. */
export function unhideEntry(layout: Layout, path: string): Layout {
  if (!isHidden(layout, path)) return layout;
  return { ...layout, hidden: (layout.hidden ?? []).filter((one) => pathKey(one) !== pathKey(path)) };
}

export function isHidden(layout: Layout, path: string): boolean {
  return (layout.hidden ?? []).some((one) => pathKey(one) === pathKey(path));
}


/**
 * Карточка и всё, что из неё выросло: обход вниз по стрелкам принадлежности. Ручные стрелки
 * обходом не считаются - они связывают карточки, а не владеют ими.
 * Пройденное запоминается - файл раскладки правится руками, и кольцо стрелок в нём
 * не должно зациклить обход.
 */
function branch(layout: Layout, id: string): Set<string> {
  // ponytail: список стрелок перебирается заново на каждую найденную карточку.
  // Потолок - карточки, помноженные на стрелки; при обещанных спекой трёх десятках карточек
  // это доли миллисекунды. Апгрейд, если полотно вырастет, - разложить стрелки по родителю.
  const ids = new Set([id]);
  // Set отдаёт и то, что добавили по ходу перебора: очередь потомков ведётся им самим.
  for (const found of ids) {
    for (const edge of layout.edges) if (edge.from === found) ids.add(edge.to);
  }
  return ids;
}

/**
 * Держит ли карточка живой процесс. Терминал держит оболочку с самого появления, а агент -
 * только с выбранной командой: до выбора его карточка предлагает список и ничего не запускает.
 */
function isLive(card: Card): boolean {
  return card.kind === "terminal";
}

/**
 * Что закрытие карточки оборвёт: живые терминалы и агенты под ней, на любой глубине.
 * Сама карточка не в счёт: крестик на терминале и есть просьба его завершить.
 */
export function liveDescendants(layout: Layout, id: string): Card[] {
  const closing = branch(layout, id);
  return layout.cards.filter((card) => card.id !== id && closing.has(card.id) && isLive(card));
}

/**
 * Карточка уходит с полотна вместе с потомками и всеми стрелками, которые их касались:
 * закрытая папка не оставляет за собой висящих в пустоте файлов, терминалов и заметок.
 * У карточки без потомков это то же самое закрытие её одной. Места ушедших раскладка запоминает (places).
 */
export function removeCard(layout: Layout, id: string): Layout {
  if (!layout.cards.some((card) => card.id === id)) return layout;
  const closing = branch(layout, id);
  const places = { ...layout.places };
  for (const card of layout.cards) {
    if (!closing.has(card.id)) continue;
    // Свежее место уходит в конец списка: при переполнении теряются самые давние.
    delete places[pathKey(card.id)];
    places[pathKey(card.id)] = { position: card.position, size: card.size };
  }
  return {
    ...layout,
    cards: layout.cards.filter((card) => !closing.has(card.id)),
    edges: layout.edges.filter((edge) => !closing.has(edge.from) && !closing.has(edge.to)),
    places: Object.fromEntries(Object.entries(places).slice(-PLACES_KEPT)),
  };
}

/**
 * Находит все карточки, относящиеся к тому же проекту, что и данная карточка.
 * Проектом считается папка-предок, напрямую растущая из корня (root), либо папка карточки.
 * Включает все карточки в поддереве проекта и карточки с путями внутри папки проекта.
 */
export function projectCardsOf(layout: Layout, id: string): Set<string> {
  const focused = layout.cards.find((card) => card.id === id);
  if (!focused) return new Set();
  if (id === ROOT_CARD_ID) {
    const ids = new Set([id]);
    for (const edge of layout.edges) {
      if (edge.from === id) ids.add(edge.to);
    }
    return ids;
  }

  // Восходим по рёбрам принадлежности (!edge.manual) до папки проекта (потомка root)
  const parents = new Map<string, string>();
  for (const edge of layout.edges) {
    parents.set(edge.to, edge.from);
  }

  let curr = id;
  let projectFolderId: string | undefined;
  const visited = new Set<string>();
  while (curr && !visited.has(curr)) {
    visited.add(curr);
    const parentId = parents.get(curr);
    if (!parentId || parentId === ROOT_CARD_ID) {
      projectFolderId = curr;
      break;
    }
    curr = parentId;
  }

  const projectCard = projectFolderId ? layout.cards.find((c) => c.id === projectFolderId) : undefined;
  const projectPath = projectCard?.path ?? focused.path;

  const result = new Set<string>([id]);
  if (projectFolderId) {
    result.add(projectFolderId);
    const queue = [projectFolderId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const edge of layout.edges) {
        if (edge.from === parentId && !result.has(edge.to)) {
          result.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
  }

  // Добавляем все карточки, пути которых лежат внутри папки проекта
  if (projectPath) {
    for (const card of layout.cards) {
      if (card.id !== ROOT_CARD_ID && (pathKey(card.path) === pathKey(projectPath) || isInside(card.path, projectPath))) {
        result.add(card.id);
      }
    }
  }

  // Также добавляем прямых соседей (включая ручные стрелки)
  for (const edge of layout.edges) {
    if (edge.from === id) result.add(edge.to);
    if (edge.to === id) result.add(edge.from);
  }

  return result;
}

/**
 * Что остаётся чётким, пока идёт ввод в карточку:
 * - для агента: ВСЕ карточки его проекта (папка, подпапки, файлы, заметки, терминалы);
 * - для остальных карточек: она сама и всё, до чего от неё одна стрелка в любую сторону.
 * Карточки нет в раскладке - чётких нет вовсе: размывать полотно из-за неё не за что.
 */
export function focusedCards(layout: Layout, id: string): Set<string> {
  const card = layout.cards.find((c) => c.id === id);
  if (!card) return new Set();
  const ids = new Set([id]);
  for (const edge of layout.edges) {
    if (edge.from === id) ids.add(edge.to);
    if (edge.to === id) ids.add(edge.from);
  }
  return ids;
}

/** Имя карточки - последний отрезок пути. Разделитель любой: пути приходят и от Windows, и от posix. */
export function cardName(card: Card): string {
  return card.path.split(/[\\/]/).filter(Boolean).pop() ?? card.path;
}


/** Видимая область полотна в его же координатах: прямоугольник, попадающий на экран. */
export type View = Position & Size;

/**
 * Карточки, попавшие на экран хоть краем. Уехавшую целиком за край незачем перерисовывать:
 * её всё равно никто не видит, а процесс внутри от этого не останавливается.
 */
export function visibleCards(layout: Layout, view: View): Set<string> {
  return new Set(
    layout.cards
      .filter(
        (card) =>
          card.position.x < view.x + view.width &&
          card.position.x + card.size.width > view.x &&
          card.position.y < view.y + view.height &&
          card.position.y + card.size.height > view.y,
      )
      .map((card) => card.id),
  );
}

/**
 * Сколько карточек полотно рисует разом. Тридцать - число из тикета заморозки; столько же
 * карточек спека кладёт на полотно в приёмке про панорамирование не ниже 50 кадров.
 */
export const RENDER_BUDGET = 30;

/**
 * Какие карточки заморожены: рисовать их не нужно, но с полотна они не уходят и процесс
 * внутри работает дальше. Мёрзнет всё, что не попало на экран, а если видимых больше бюджета -
 * ещё и те из них, к которым дольше всего не обращались.
 */
export function frozenCards(
  layout: Layout,
  visible: Set<string>,
  touchedAt: Map<string, number>,
): Set<string> {
  // Сортировка устойчива, поэтому карточки, к которым не обращались вовсе, мёрзнут
  // в порядке раскладки, а не как попало.
  // ponytail: порядок обращений собирается заново на каждый пересчёт. Потолок - карточки,
  // помноженные на логарифм от них; на трёх десятках это доли миллисекунды, а пересчёт идёт
  // не на кадр. Апгрейд, если полотно вырастет, - вести порядок обращений отдельным списком.
  const drawn = new Set(
    layout.cards
      .filter((card) => visible.has(card.id))
      .sort((a, b) => (touchedAt.get(b.id) ?? 0) - (touchedAt.get(a.id) ?? 0))
      .slice(0, RENDER_BUDGET)
      .map((card) => card.id),
  );
  return new Set(layout.cards.filter((card) => !drawn.has(card.id)).map((card) => card.id));
}
