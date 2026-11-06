// Прокладка связей в обход карточек: сперва прямая кривая от порта к порту; задевает карточку -
// путь по сетке (route-grid.ts), натянутый и сглаженный в плавную кривую. Связи в одном коридоре
// идут рядом, а не друг по другу: клетки, по которым связь уже прошла, дороже.
import { bezier, sample, STEP, type Pt, type Route } from "./route.ts";
import { CLEAR, cellOf, centerOf, makeGrid, markUsed, search, within, type Box, type Grid } from "./route-grid.ts";

export type { Box } from "./route-grid.ts";

/** Отрезок от порта наружу, прежде чем путь пойдёт по сетке, px. */
const STUB = 24;
/** Сглаживание срезает угол на восьмую часть соседних отрезков: при 96 px кривая отходит от вершины
 *  на 12 px по каждой оси, а свободная клетка стоит от карточки на CLEAR + CELL / 2 = 22 px. */
const MAX_SEG = 96;
/** Зазор плавной кривой до карточки, px. */
const GAP = 8;

function pack(points: Pt[]): Route {
  return { points, ...sample(points) };
}

/** Оставляет только точки, где путь меняет направление. */
function corners(points: Pt[]): Pt[] {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 0.01) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Прямая a-b идёт только по свободным клеткам, где нет чужих связей; клетки концов не считаются. */
function sight(g: Grid, a: Pt, b: Pt, ends: number[]): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP);
  for (let k = 1; k < n; k++) {
    const i = cellOf(g, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    if (!ends.includes(i) && (g.blocked[i] || g.used[i] > 0)) return false;
  }
  return true;
}

/** Натягивает путь сетки: из каждой точки прямо к самой дальней видимой. Ступеньки сетки уходят,
 *  углы у карточек и отступ от чужих связей остаются. */
function pull(g: Grid, points: Pt[], ends: number[]): Pt[] {
  const out = [points[0]];
  for (let at = 0; at < points.length - 1; ) {
    let next = points.length - 1;
    while (next > at + 1 && !sight(g, points[at], points[next], ends)) next--;
    out.push(points[next]);
    at = next;
  }
  return out;
}

/** Сглаживание срезанием углов: концы на месте, углы становятся дугами. */
function chaikin(points: Pt[], rounds: number): Pt[] {
  let p = points;
  for (let round = 0; round < rounds; round++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Дробит отрезки длиннее MAX_SEG: иначе сглаживание длинного обхода срезало бы угол карточки. */
function densify(points: Pt[]): Pt[] {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / MAX_SEG);
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Касательная сплайна в точке i: на концах - по нормали порта (out - из начала, back - наружу из конца),
 *  как выходит связь из порта; внутри - не длиннее соседних отрезков, иначе у близких точек кривая
 *  перелетает и даёт крюк. */
function tangent(points: Pt[], i: number, out: Pt, back: Pt): Pt {
  const n = points.length;
  if (i === 0 || i === n - 1) {
    const a = points[i === 0 ? 0 : n - 2];
    const b = points[i === 0 ? 1 : n - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return i === 0 ? { x: out.x * len, y: out.y * len } : { x: -back.x * len, y: -back.y * len };
  }
  const x = (points[i + 1].x - points[i - 1].x) / 2;
  const y = (points[i + 1].y - points[i - 1].y) / 2;
  const room =
    0.9 *
    Math.min(
      Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
      Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y),
    );
  const k = Math.min(1, room / (Math.hypot(x, y) || 1));
  return { x: x * k, y: y * k };
}

/** Гладкая кривая через точки обхода: сплайн Эрмита с касательными как у Катмулла-Рома. */
function spline(points: Pt[], from: Pt, into: Pt): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const m0 = tangent(points, i, from, into);
    const m1 = tangent(points, i + 1, from, into);
    const parts = Math.max(6, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 12));
    for (let k = 1; k <= parts; k++) {
      const t = k / parts;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      out.push({
        x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
        y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
      });
    }
  }
  return out;
}

/** Кривая годится: проходит не ближе GAP к карточкам и не идёт по чужой связи дольше 60 px. У концов
 *  проверка мягче: первые и последние 30 px выходят из своей карточки, а 60 px - веер связей из одной
 *  шапки, он расходится сам. */
function clear(g: Grid, route: Route): boolean {
  let run = 0;
  for (const p of route.samples) {
    if (p.s < 30 || p.s > route.length - 30) {
      run = 0;
      continue;
    }
    for (const b of g.boxes) if (within(b, p, GAP)) return false;
    const fan = p.s < 60 || p.s > route.length - 60;
    run = !fan && g.used[cellOf(g, p)] >= 9 ? run + 1 : 0;
    if (run > 15) return false;
  }
  return true;
}

/** Нормали по умолчанию: связь выходит вправо из начала и входит в конец слева. */
const RIGHT: Pt = { x: 1, y: 0 };
const LEFT: Pt = { x: -1, y: 0 };

/** Прямая кривая от порта к порту: без нормалей - прежняя, горизонтальная. */
export function direct(link: Want): Route {
  return link.nf || link.nt ? bezier(link.from, link.to, link.nf ?? RIGHT, link.nt ?? LEFT) : bezier(link.from, link.to);
}

function routeOne(g: Grid, link: Want): Route {
  const { from, to } = link;
  const nf = link.nf ?? RIGHT;
  const nt = link.nt ?? LEFT;
  const straight = direct(link);
  if (clear(g, straight)) return straight;
  const out = { x: from.x + nf.x * STUB, y: from.y + nf.y * STUB };
  const into = { x: to.x + nt.x * STUB, y: to.y + nt.y * STUB };
  const start = cellOf(g, out);
  const goal = cellOf(g, into);
  const cells = search(g, start, goal, false) ?? search(g, start, goal, true);
  if (!cells) return straight;
  const middle = pull(g, corners(cells.map((i) => centerOf(g, i))), [start, goal]).slice(1, -1);
  const smooth = pack(spline([from, out, ...middle, into, to], nf, nt));
  if (clear(g, smooth)) return smooth;
  // Сплайн задел карточку - углы срезаются мельче: кривая жёстче, зато вдоль прохода.
  return pack(chaikin(densify([from, out, ...middle, into, to]), 3));
}

/** nf и nt - нормали краёв на концах, наружу: из начала связь выходит по nf, в конец входит против nt.
 *  Нет - горизонталь, слева направо. */
export type Want = { id: string; from: Pt; to: Pt; nf?: Pt; nt?: Pt };

/** Прокладывает связи из want; маршруты из keep не трогает, но их клетки считает занятыми. */
export function routeLinks(boxes: Box[], want: Want[], keep: Map<string, Route>): Map<string, Route> {
  const out = new Map(keep);
  if (boxes.length === 0) {
    for (const link of want) out.set(link.id, direct(link));
    return out;
  }
  const g = makeGrid(boxes);
  for (const route of keep.values()) markUsed(g, route);
  for (const link of want) {
    const route = routeOne(g, link);
    markUsed(g, route);
    out.set(link.id, route);
  }
  return out;
}

/** Путь проходит через прямоугольник с зазором: такую связь надо переложить, когда он сдвинулся. */
export function passes(route: Route, box: Box): boolean {
  return route.samples.some((p) => within(box, p, CLEAR));
}
