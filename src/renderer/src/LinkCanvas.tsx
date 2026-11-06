// Слой связей, четырьмя canvas. Задний: точки фона. Нижний (под карточками): полотно графом. Над карточками два:
// неподвижный - связи и свет по кромке, перерисовывается только со сменой сцены или вида; верхний - всё, что
// движется. Над карточками связи лежат затем, чтобы карточка выше связи её закрывала, а ниже - нет. Вид рисует
// тема (themes/*.paint.ts); здесь - цикл кадра, пути и замер строк.
// Перерисовка - не каждый кадр. Картинка сдвинулась (полотно, карточки, сцена) - рисуется сразу, с
// частотой окна; в остальное время связи живут сами - не чаще 30 кадров в секунду. Движение выключено
// в системе - холсты не трогаются, пока ничего не сдвинулось. Окно не в фокусе - не чаще четырёх кадров
// в секунду.
import { useEffect, useRef, type MutableRefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import { pathKey, type Card, type Layout } from "../../shared/canvas-model";
import type { Body } from "../../shared/graph";
import { sample } from "../../shared/route";
import { CANVAS, mix } from "./palette";
import { glideStep, type Ice } from "./ice";
import { boxOf, HEAD, layLinks, type Laid } from "./link-routes";
import { ringEnds, ringLine } from "./ring-fx";
import { CARD_R, isRing } from "./rings";
import { seedOf, type Drawn, type Frame, type Lamp, type Painter } from "./themes/painter";

/** Что слой связей берёт у полотна на каждый кадр. App обновляет это при каждой отрисовке. */
export type Scene = {
  layout: Layout;
  /** Тема: её рисование и имя - узор точек фона кешируется по нему. */
  theme: string;
  painter: Painter;
  colorOf: (card: Card) => string;
  dots: boolean;
  /** Круглое полотно (тёмная тема): папки - кольца, связи входят по ободу и стороне, свой свет и частицы. */
  rings: boolean;
  /** Полотно показано графом: где кружки и какой под мышью. null - обычное полотно. */
  graph: { bodies: ReadonlyMap<string, Body>; hover: string | null } | null;
  /** Круглое полотно: карточки и кольца, что разворачиваются и сворачиваются, и с какого мига (performance.now()). */
  born: ReadonlyMap<string, number>;
  dying: ReadonlyMap<string, number>;
};

/** Сколько разворачивается и сворачивается карточка и кольцо, мс: столько же, сколько их анимации (rings.css). */
const UNFOLD = { card: { open: 760, close: 440 }, ring: { open: 1000, close: 560 } };
const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

/** Яркость связей и света на концах у разворачивающегося, как в прототипе: к карточке связь приходит раньше неё
 *  (первые 30% разворота), к кольцу - вместе с ним; сворачивание - тот же ход обратно. 1 - стоит. */
function unfoldAlpha(scene: Scene, id: string, round: boolean, now: number): number {
  const born = scene.born.get(id);
  const dying = scene.dying.get(id);
  if (born === undefined && dying === undefined) return 1;
  const ms = round ? UNFOLD.ring : UNFOLD.card;
  const p = Math.min(1, Math.max(0, dying !== undefined ? 1 - (now - dying) / ms.close : (now - born!) / ms.open));
  return round ? seg(p, 0.2, 0.7) : seg(p, 0, 0.3);
}

/** Фон: точки с шагом DOT_GAP на полотне; размер точки на экране один и тот же при любом масштабе. */
const DOT_GAP = 24;
/** Самый частый шаг сетки на экране, px. Отдалили сильнее - сетка прореживается вдвое; уходящие точки
 *  гаснут на узком участке, пока шаг сжимается от двух MIN_GAP до FADE_FROM MIN_GAP. */
const MIN_GAP = 16;
const FADE_FROM = 1.75;

/** Мерцание: две синусоиды с несоизмеримыми частотами; где идёт работа - чаще и глубже. */
function flicker(seed: number, t: number, work: boolean): number {
  const k = work ? 1 : 0.45;
  const f = work ? 2.2 : 1;
  return 0.8 + k * (0.12 * Math.sin(f * 1.7 * t + seed) + 0.08 * Math.sin(f * 4.3 * t + seed * 2.1));
}


/** Узоры сетки точек по ключу "тема:вид:размер клетки": под каждый размер клетки узор рисуется раз. */
const patterns = new Map<string, CanvasPattern>();

/** Узор одной клетки сетки, точки - в долях клетки. Клетка - целое число пикселей экрана с учётом
 *  плотности, поэтому точка не размывается растяжением. Точка у края клетки рисуется со всех сторон,
 *  иначе на стыках узора она обрезана. */
function patternOf(ctx: CanvasRenderingContext2D, key: string, size: number, spots: [number, number][], dpr: number, painter: Painter): CanvasPattern {
  const known = patterns.get(key);
  if (known) return known;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const g = tile.getContext("2d")!;
  for (const [u, v] of spots)
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) painter.dot(g, u * size + dx, v * size + dy, dpr);
  const pattern = ctx.createPattern(tile, "repeat")!;
  if (patterns.size > 200) patterns.clear();
  patterns.set(key, pattern);
  return pattern;
}

/** Точки фона - узор на весь экран, сдвинутый и растянутый вместе с полотном. */
function grid(ctx: CanvasRenderingContext2D, width: number, height: number, [tx, ty, zoom]: [number, number, number], scene: Scene): void {
  const dpr = window.devicePixelRatio || 1;
  let cell = DOT_GAP * zoom;
  let thinned = false;
  while (cell < MIN_GAP) {
    cell *= 2;
    thinned = true;
  }
  const size = Math.max(4, Math.round(cell * dpr));
  const at = new DOMMatrix([cell / size, 0, 0, cell / size, tx, ty]);
  const main = patternOf(ctx, `${scene.theme}:m:${size}`, size, [[0, 0]], dpr, scene.painter);
  main.setTransform(at);
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, width, height);
  const fade = thinned ? Math.min(1, (cell - FADE_FROM * MIN_GAP) / ((2 - FADE_FROM) * MIN_GAP)) : 0;
  if (fade <= 0.02) return;
  const fine = patternOf(ctx, `${scene.theme}:f:${size}`, size, [[0.5, 0], [0, 0.5], [0.5, 0.5]], dpr, scene.painter);
  fine.setTransform(at);
  ctx.globalAlpha = fade;
  ctx.fillStyle = fine;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
}

/** Подгоняет размер canvas под экран, очищает и отдаёт контекст в экранных координатах. size - размер
 *  слоя связей в CSS-пикселях: он берётся из ResizeObserver, а не замером в каждом кадре. */
function prepare(el: HTMLCanvasElement, size: { w: number; h: number }): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  if (el.width !== Math.round(size.w * dpr) || el.height !== Math.round(size.h * dpr)) {
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
  }
  const ctx = el.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, el.width, el.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function toFlow(ctx: CanvasRenderingContext2D, [tx, ty, zoom]: [number, number, number]): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);
}

/**
 * Где в карточке строки и плитки её записей: высота середины записи от верха карточки, в единицах
 * полотна. Запись, уехавшая прокруткой за край списка, прижимается к его краю. Меряется по разметке
 * не каждый кадр, а когда разметка менялась (ports.dirty): иначе замер тянул бы вёрстку в каждом кадре.
 */
function measurePorts(host: HTMLElement, into: Map<string, Map<string, number>>): void {
  for (const node of host.querySelectorAll<HTMLElement>(".react-flow__node")) {
    const id = node.dataset.id;
    const entries = node.querySelectorAll<HTMLElement>("[data-path]");
    if (!id || entries.length === 0) continue;
    const box = node.getBoundingClientRect();
    const zoom = node.offsetHeight ? box.height / node.offsetHeight : 1;
    const ys = into.get(id) ?? new Map<string, number>();
    for (const entry of entries) {
      const rect = entry.getBoundingClientRect();
      // Замороженная или свёрнутая карточка не раскладывает тело: прежний замер остаётся.
      if (rect.height === 0) continue;
      let y = rect.top + rect.height / 2;
      const list = entry.closest<HTMLElement>(".scroll")?.getBoundingClientRect();
      if (list) y = Math.min(Math.max(y, list.top + 6), list.bottom - 6);
      ys.set(pathKey(entry.dataset.path ?? ""), (y - box.top) / zoom);
    }
    into.set(id, ys);
  }
}

function frameOf(card: Card, rings = false, below = 0): Frame {
  // Рамка - тот же прямоугольник, что обходят связи: у корня с продолжением заднего слоя влево.
  if (rings) return { ...boxOf(card, true, below), r: isRing(card) ? card.size.width / 2 : CARD_R };
  return { ...boxOf(card), r: card.kind === "file" || card.kind === "note" ? 14 : 18 };
}


/** Что рисовать на этот кадр: пути связей из прокладки, лампочки шапок и цепочки до корня. */
function build(scene: Scene, laid: Laid): { items: Drawn[]; lamps: Lamp[] } {
  const cards = new Map(scene.layout.cards.map((card) => [card.id, card]));
  const items: Drawn[] = [];
  for (const edge of scene.layout.edges) {
    const a = cards.get(edge.from);
    const b = cards.get(edge.to);
    const route = laid.routes.get(edge.id);
    if (!a || !b || !route) continue;
    items.push({
      id: edge.id,
      route,
      from: scene.colorOf(a),
      to: scene.colorOf(b),
      source: a.id,
      target: b.id,
            a: frameOf(a, scene.rings),
            b: frameOf(b, scene.rings),
    });
  }
  // На круглом полотне лампочек в шапках нет: цвет проекта мигает квадратом в шапке карточки (index.css).
  const lamps = (scene.rings ? [] : scene.layout.cards).map((card) => ({
    id: card.id,
    x: card.position.x,
    y: card.position.y,
    flat: card.kind === "file" || card.kind === "note",
    folder: card.kind === "folder",
    color: scene.colorOf(card),
    work: false,
  }));
  return { items, lamps };
}


/** Граф: связи - прямые от кружка к кружку, без раструбов, шариков и лампочек. Связи не у кружка под
 *  мышью бледнеют: цвет уходит к цвету стола, а не в прозрачность - её темы выставляют сами. */
function drawGraph(ctx: CanvasRenderingContext2D, scene: Scene, graph: NonNullable<Scene["graph"]>, t: number, near: boolean): void {
  const cards = new Map(scene.layout.cards.map((card) => [card.id, card]));
  const items: Drawn[] = [];
  for (const edge of scene.layout.edges) {
    const a = cards.get(edge.from);
    const b = cards.get(edge.to);
    const p = graph.bodies.get(edge.from);
    const q = graph.bodies.get(edge.to);
    if (!a || !b || !p || !q) continue;
    const faint = graph.hover !== null && edge.from !== graph.hover && edge.to !== graph.hover;
    const tone = (hex: string) => (faint ? mix(hex, CANVAS, 0.8) : hex);
    const points = [
      { x: p.x, y: p.y },
      { x: q.x, y: q.y },
    ];
    items.push({
      id: edge.id,
      route: { points, ...sample(points) },
      from: tone(scene.colorOf(a)),
      to: tone(scene.colorOf(b)),
      source: a.id,
      target: b.id,
      a: frameOf(a),
      b: frameOf(b),
    });
  }
  scene.painter.lines(ctx, items, t, near);
}

/** Место карточки в стопке: выше z-index - выше, при равном - та, что позже в разметке. Берётся из стора React Flow:
 *  z-index узлу он ставит сам (internals.z, по выделению, наведению и фокусу, App.tsx), а узлы кладёт в разметку в
 *  порядке nodeLookup. Та же стопка - тот же объект: по нему кэшируется геометрия кадра. */
function stackOf(lookup: ReadonlyMap<string, { internals: { z: number } }>, was: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  let i = 0;
  for (const [id, node] of lookup) out.set(id, (node.internals.z || 0) * 10000 + i++);
  if (out.size === was.size && [...out].every(([id, rank]) => was.get(id) === rank)) return was;
  return out;
}

/** Карточка как то, что закрывает связь: рамка и место в стопке. */
type Cover = Frame & { id: string; rank: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** Рамка группы связей в единицах полотна, с запасом на свечение, раструбы и свет по кромке карточки (до 120 px
 *  от места входа связи в обе стороны). */
function areaOf(items: Drawn[]): Box {
  const pad = 130;
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const item of items) {
    const b = boundsOf(item);
    out.x0 = Math.min(out.x0, b.x0 - pad);
    out.y0 = Math.min(out.y0, b.y0 - pad);
    out.x1 = Math.max(out.x1, b.x1 + pad);
    out.y1 = Math.max(out.y1, b.y1 + pad);
  }
  return out;
}

/** Прямоугольник связи с запасом на свечение и раструбы. Путь тот же, пока связь не переложили: рамка по нему
 *  считается раз, а не в каждом кадре протяжки. */
const bounds = new WeakMap<object, Box>();
function boundsOf(item: Drawn): Box {
  const known = bounds.get(item.route);
  if (known) return known;
  const xs = item.route.points.map((p) => p.x);
  const ys = item.route.points.map((p) => p.y);
  const box = { x0: Math.min(...xs) - 48, y0: Math.min(...ys) - 48, x1: Math.max(...xs) + 48, y1: Math.max(...ys) + 48 };
  bounds.set(item.route, box);
  return box;
}

const inside = (c: Cover, p: { x: number; y: number }) =>
  c.round ? (p.x - c.x - c.w / 2) ** 2 + (p.y - c.y - c.h / 2) ** 2 < (c.w / 2) ** 2 : p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;

/**
 * Какие карточки закрывают связь. Связь лежит на уровне верхней из своих карточек: её закрывают те,
 * что выше этого уровня и задевают её прямоугольник. И ещё те, что накрыли её порт поверх карточки
 * этого порта: провод, воткнутый в накрытую карточку, уходит под накрывшую, а не начинается посреди неё.
 */
function coversOf(covers: Cover[], item: Drawn, stack: ReadonlyMap<string, number>): Cover[] {
  const from = stack.get(item.source) ?? 0;
  const to = stack.get(item.target) ?? 0;
  const level = Math.max(from, to);
  const box = boundsOf(item);
  const start = item.route.points[0];
  const end = item.route.points[item.route.points.length - 1];
  return covers.filter(
    (c) =>
      (c.rank > level && c.x < box.x1 && c.x + c.w > box.x0 && c.y < box.y1 && c.y + c.h > box.y0) ||
      (c.rank > from && inside(c, start)) ||
      (c.rank > to && inside(c, end)),
  );
}


/** Запас неподвижного слоя за краем экрана, px: пока полотно сдвинулось меньше, слой не перерисовывается, а
 *  кладётся готовой картинкой со сдвигом. */
const STEADY_MARGIN = 320;

/** Номер пути связи: путь тот же объект, пока связь не переложили. По номерам видно, сменилось ли неподвижное. */
const routeIds = new WeakMap<object, number>();
let nextRouteId = 0;
function routeId(route: object): number {
  let id = routeIds.get(route);
  if (id === undefined) routeIds.set(route, (id = ++nextRouteId));
  return id;
}

/** Полотно замерло на столько - связи перекладываются все заново, мс. */
const SETTLE_MS = 200;
/** Чаще этого не рисуется то, что движется само: 30 кадров в секунду с запасом на дрожание кадра - при
 *  60 Гц рисуется каждый второй. Полотно или карточку тянут - рисуется каждый кадр. */
const AMBIENT_MS = 29;

export function LinkCanvas({
  scene,
  ports,
  ice,
  onSettle,
}: {
  scene: MutableRefObject<Scene | null>;
  /** Разметка строк поменялась - замер портов устарел. */
  ports: MutableRefObject<{ dirty: boolean }>;
  /** Ход руки по полотну (ice.ts): брошенное полотно катит этот слой. */
  ice: MutableRefObject<Ice>;
  /** Рука отпустила, бросок кончился. */
  onSettle: () => void;
}) {
  const back = useRef<HTMLCanvasElement>(null);
  const under = useRef<HTMLCanvasElement>(null);
  const steady = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();
  const settle = useRef(onSettle);
  settle.current = onSettle;

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    let away = !document.hasFocus();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Точки фона меняются только со сдвигом и масштабом полотна: пока оно стоит, их холст не трогаем.
    let backKey = "";
    const measured = new Map<string, Map<string, number>>();
    let built: ReturnType<typeof build> = { items: [], lamps: [] };
    let builtFrom: Scene | null = null;
    // Раскладка, по которой прокладываются и рисуются связи.
    let hinted: Layout | null = null;
    let laid: Laid | null = null;
    // Проложено не всё заново: как только полотно замрёт на SETTLE_MS, прокладка повторится целиком.
    let loose = false;
    let changedAt = 0;
    let last = 0;
    let calm = true;
    // Что и когда нарисовано: тот же вид той же сцены второй раз не рисуется.
    let paintedFrom: Scene | null = null;
    let paintedKey = "";
    let paintedAt = 0;
    let wasLive = false;
    // Неподвижный слой с запасом за краем экрана: что в нём нарисовано (key) и при каком виде (at).
    const steadyCache = document.createElement("canvas");
    let steadyKey = "";
    let steadyAt: [number, number, number] | null = null;
    // Часы анимации связей и лампочек, в секундах. Движение выключено в системе - стоят на нуле.
    let clock = 0;
    // Опроса разметки в каждом кадре нет. Размер слоя связей - из ResizeObserver, стопка карточек - из стора, когда
    // у React Flow сменился массив узлов.
    const size = { w: back.current?.clientWidth ?? 0, h: back.current?.clientHeight ?? 0 };
    const sizes = new ResizeObserver(([entry]) => {
      size.w = (entry.target as HTMLElement).clientWidth;
      size.h = (entry.target as HTMLElement).clientHeight;
    });
    if (back.current) sizes.observe(back.current);
    let stack = new Map<string, number>();
    let stackNodes: unknown = null;
    // Геометрия кадра (кто закрывает связи) - одна, пока те же сцена и стопка: кадры лампочек между сменами сцены её
    // не пересчитывают.
    let geomFrom: Scene | null = null;
    let geomStack: Map<string, number> | null = null;
    let geom: { covers: Cover[]; groups: Map<string, { hide: Cover[]; items: Drawn[] }> } | null = null;
    // Движется ли что-то на слое само, без смены сцены: считается при сборке сцены.
    let moving = false;
    const next = () => {
      if (away) timer = window.setTimeout(() => (frame = requestAnimationFrame(draw)), 250);
      else frame = requestAnimationFrame(draw);
    };
    const draw = (now: number) => {
      const low = under.current;
      const fixed = steady.current;
      const high = over.current;
      const base = back.current;
      const current = scene.current;
      if (!low || !fixed || !high || !base || !current) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dt = last ? Math.min(48, now - last) : 16;
      last = now;
      let transform = store.getState().transform;
      if (still) ice.current.glide = null;
      const glide = glideStep(ice.current, transform, dt);
      if (glide) {
        void store.getState().panZoom?.setViewport(glide);
        transform = store.getState().transform;
      }
      // Связи рисуются там же, где полотно, без запаздывания: карточки едут с полотном в том же кадре, и запаздывание
      // связей и карточек, дописанное в колбэке кадра, при неровных кадрах дёргало их назад.
      const shown: [number, number, number] = [...transform];
      // Всё улеглось: рука отпустила, бросок кончился. Сообщаем один раз.
      if (!ice.current.glide && !ice.current.held) {
        if (!calm) settle.current();
        calm = true;
      } else calm = false;
      const painter = current.painter;
      let fresh = false;
      // Порты строк нужны только карточным темам: круглое полотно входит в кольцо по ободу (layLinks, ringEnds).
      if (ports.current.dirty) {
        ports.current.dirty = false;
        const host = base.parentElement;
        if (host && !current.rings) {
          measurePorts(host, measured);
          builtFrom = null;
        }
      }
      if (loose && now - changedAt > SETTLE_MS) {
        loose = false;
        laid = null;
        builtFrom = null;
      }
      if (builtFrom !== current && !current.graph) {
        hinted = current.layout;
        const next = layLinks(hinted, measured, pathKey, laid, current.rings);
        laid = next.laid;
        if (next.partial) {
          loose = true;
          changedAt = now;
        }
        built = build({ ...current, layout: hinted }, laid);
        // Само движется: лампочки и шарики карточных тем.
        moving = built.lamps.length > 0 || (!current.rings && built.items.length > 0);
        builtFrom = current;
        fresh = true;
      }

      const key = [current.theme, transform[0], transform[1], transform[2], size.w, size.h, current.dots].join(",");
      if (key !== backKey) {
        backKey = key;
        const dots = prepare(base, size);
        if (current.dots) grid(dots, size.w, size.h, transform, current);
      }

      const near = transform[2] >= 0.6;
      // Порядок в стопке React Flow меняет сам, мимо сцены: он входит в ключ вида.
      const nodes = store.getState().nodes;
      if (nodes !== stackNodes) {
        stackNodes = nodes;
        stack = stackOf(store.getState().nodeLookup, stack);
      }
      // Само движется: лампочки и шарики мерцают, карточка разворачивается, в графе кружки дышат.
      const live = !still && (current.graph !== null || moving || current.born.size > 0 || current.dying.size > 0);
      const viewKey = [...shown, size.w, size.h, window.devicePixelRatio, ...stack].join();
      // Последний кадр движения рисуется и после его конца: иначе на холсте застрял бы хвост импульса.
      const changed = fresh || current !== paintedFrom || viewKey !== paintedKey;
      if (!changed && !((live || wasLive) && now - paintedAt >= AMBIENT_MS)) return next();
      // Шаг часов - не длиннее кадра в 50 мс (окно не в фокусе - 250): после паузы связь не прыгает.
      if (!still) clock += Math.min(away ? 250 : 50, now - paintedAt) / 1000;
      paintedFrom = current;
      paintedKey = viewKey;
      paintedAt = now;
      wasLive = live;
      // Граф - на нижнем холсте, под карточками. Пустой холст в сборке кадра не участвует: нижний виден
      // только с графом, слои нитей - пока в них есть нити.
      const show = (el: HTMLCanvasElement, on: boolean) => {
        if (el.hidden === on) el.hidden = !on;
      };
      if (current.graph) {
        show(low, true);
        const ctx = prepare(low, size);
        toFlow(ctx, shown);
        drawGraph(ctx, current, current.graph, clock, near);
        prepare(fixed, size);
        prepare(high, size);
        return next();
      }
      show(low, false);
      // Связь лежит на уровне верхней из своих карточек: карточки выше неё её закрывают, ниже - нет.
      // Незакрытые рисуются прямо на холст, закрытые - на черновик, из которого вырезаются закрывающие
      // карточки. Так же с раструбами, шариками и импульсами - они часть связи.
      if (!geom || geomFrom !== current || geomStack !== stack || fresh) {
        geomFrom = current;
        geomStack = stack;
        const covers: Cover[] = current.layout.cards.map((card) => ({ ...frameOf(card, current.rings), id: card.id, rank: stack.get(card.id) ?? 0 }));
        const groups = new Map<string, { hide: Cover[]; items: Drawn[] }>();
        for (const item of built.items) {
          const hide = coversOf(covers, item, stack);
          const key = hide.map((c) => c.id).join("|");
          const group = groups.get(key) ?? { hide, items: [] };
          group.items.push(item);
          groups.set(key, group);
        }
        geom = { covers, groups };
      }
      const { covers, groups } = geom;
      // Неподвижное - связи без движения - лежит на своём холсте под верхним и рисуется, только когда сцена или вид
      // сменились. Каждый кадр рисуется то, что движется: шарики, лампочки и разворот карточек.
      const rings = current.rings;
      // Связи к разворачивающемуся и сворачивающемуся гаснут вместе с ним и рисуются каждый кадр, пока он не встал:
      // неподвижный слой перерисовывается только со сменой сцены, и связь, ушедшая на него посреди хода, пропала бы.
      const fades = new Map<string, number>();
      const unfolding = (id: string) => current.born.has(id) || current.dying.has(id);
      if (rings)
        for (const item of built.items)
          if (unfolding(item.source) || unfolding(item.target))
            fades.set(item.id, Math.min(unfoldAlpha(current, item.source, item.a.round === true, now), unfoldAlpha(current, item.target, item.b.round === true, now)));
      const moves = (item: Drawn) => fades.has(item.id);
      const steadyLinks = (g: CanvasRenderingContext2D, items: Drawn[]) => {
        const calm = items.filter((item) => !moves(item));
        if (rings) {
          for (const item of calm) ringLine(g, item);
          for (const item of items) if (!fades.has(item.id)) ringEnds(g, item);
        } else painter.lines(g, calm, clock, near);
      };
      const liveLinks = (g: CanvasRenderingContext2D, items: Drawn[]) => {
        for (const item of items) {
          const k = fades.get(item.id);
          if (k === undefined || k <= 0) continue;
          ringLine(g, item, k);
        }
        for (const item of items) {
          const pts = item.route.points;
          if (rings) {
            const k = fades.get(item.id) ?? 1;
            if (k <= 0) continue;
            if (fades.has(item.id)) ringEnds(g, item, k);
          } else {
            const shine = flicker(seedOf(item.id), clock, false);
            const a = pts[0];
            const b = pts[pts.length - 1];
            painter.ball(g, a.x, a.y, item.from, shine, near);
            painter.ball(g, b.x, b.y, item.to, shine, near);
          }
        }
      };
      const view = shown;
      const paint = (
        onto: HTMLCanvasElement,
        links: (g: CanvasRenderingContext2D, items: Drawn[]) => void,
        at: [number, number, number] = view,
        sz: { w: number; h: number } = size,
      ): CanvasRenderingContext2D => {
        const top = prepare(onto, sz);
        toFlow(top, at);
        for (const { hide, items } of groups.values()) {
          // Закрытая группа рисуется прямо на холст в клипе "вне каждой закрывающей карточки": клипы пересекаются,
          // и выходит "вне их всех", перекрытие двух карточек тоже закрыто. Черновик с копией на холст на каждую
          // группу стоил дороже всего остального на слое, пока полотно тянут.
          if (hide.length) {
            const area = areaOf(items);
            top.save();
            for (const c of hide) {
              top.beginPath();
              top.rect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
              if (c.round) {
                top.moveTo(c.x + c.w, c.y + c.h / 2);
                top.arc(c.x + c.w / 2, c.y + c.h / 2, c.w / 2, 0, 2 * Math.PI);
              } else top.roundRect(c.x, c.y, c.w, c.h, c.r);
              top.clip("evenodd");
            }
          }
          links(top, items);
          if (hide.length) top.restore();
        }
        return top;
      };
      if (changed) {
        // Пока полотно тянут, неподвижное не меняется - меняется только сдвиг. Оно рисуется в холст с запасом
        // STEADY_MARGIN и кладётся одной картинкой; заново - когда сменились связи, масштаб или кончился запас.
        const dpr = window.devicePixelRatio || 1;
        const [tx, ty, zoom] = view;
        const key = [
          current.theme,
          near,
          size.w,
          size.h,
          dpr,
          zoom,
          ...[...groups.values()].map(
            ({ hide, items }) =>
              hide.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join(";") +
              "/" +
              items
                .map((i) => `${routeId(i.route)}${i.from}${i.to}${moves(i)}`)
                .join(","),
          ),
        ].join("|");
        const fits =
          steadyAt !== null && steadyAt[2] === zoom && Math.abs(tx - steadyAt[0]) <= STEADY_MARGIN && Math.abs(ty - steadyAt[1]) <= STEADY_MARGIN;
        if (key !== steadyKey || !fits) {
          steadyKey = key;
          steadyAt = [tx, ty, zoom];
          const big = { w: size.w + 2 * STEADY_MARGIN, h: size.h + 2 * STEADY_MARGIN };
          paint(steadyCache, steadyLinks, [tx + STEADY_MARGIN, ty + STEADY_MARGIN, zoom], big);
        }
        const g = prepare(fixed, size);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(steadyCache, Math.round((tx - steadyAt![0] - STEADY_MARGIN) * dpr), Math.round((ty - steadyAt![1] - STEADY_MARGIN) * dpr));
      }
      const top = paint(high, liveLinks);
      for (const lamp of built.lamps) {
        // Лампочка - на месте точки в шапке (index.css, .card__dot); накрыта чужой карточкой - не видна.
        const x = lamp.x + (lamp.flat ? 16.5 : 17.5);
        const y = lamp.y + HEAD;
        const rank = stack.get(lamp.id) ?? 0;
        if (covers.some((c) => c.rank > rank && inside(c, { x, y }))) continue;
        painter.lamp(top, x, y, lamp, flicker(seedOf(lamp.id), clock, lamp.work), clock);
      }
      next();
    };
    const onBlur = () => (away = true);
    const onFocus = () => (away = false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      sizes.disconnect();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [store, scene, ports, ice]);

  return (
    <>
      <canvas ref={back} className="links" />
      <canvas ref={under} className="links" />
      <canvas ref={steady} className="links links--over" />
      <canvas ref={over} className="links links--over" />
    </>
  );
}
