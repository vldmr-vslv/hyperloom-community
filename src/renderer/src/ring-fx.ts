// Связи круглого полотна (тёмная тема, _scratch/root-dial) на слое связей: линия с ореолом и свет по кромке на
// обоих концах.
import type { Drawn, Frame } from "./themes/painter";


type P = { x: number; y: number };

function poly(g: CanvasRenderingContext2D, pts: P[], color: string, width: number, alpha: number, cap: CanvasLineCap = "round"): void {
  if (pts.length < 2 || alpha <= 0) return;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = cap;
  g.stroke();
}



/** Точки кромки рамки от места p в обе стороны на spread px, o - яркость, к краям гаснет до нуля. У кольца - по
 *  дуге обода, у карточки - по контуру со скруглёнными углами. */
export function edgeFade(f: Frame, p: P, spread: number): (P & { o: number })[] {
  const out: (P & { o: number })[] = [];
  if (f.round) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const r = f.w / 2 - 1;
    const a0 = Math.atan2(p.y - cy, p.x - cx);
    for (let d = -spread; d <= spread; d += 3) out.push({ x: cx + r * Math.cos(a0 + d / r), y: cy + r * Math.sin(a0 + d / r), o: 1 - Math.abs(d) / spread });
    return out;
  }
  const pts = outline(f);
  let i0 = 0;
  let near = Infinity;
  pts.forEach((q, i) => {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < near) {
      near = d;
      i0 = i;
    }
  });
  const half = Math.round(spread / 2);
  const n = pts.length;
  for (let d = -half; d <= half; d++) out.push({ ...pts[(((i0 + d) % n) + n) % n], o: 1 - Math.abs(d) / half });
  return out;
}

/** Контур скруглённого прямоугольника точками через ~2 px, по часовой от верхней грани. */
function outline(f: Frame): P[] {
  const r = f.r;
  const x0 = f.x + r;
  const x1 = f.x + f.w - r;
  const y0 = f.y + r;
  const y1 = f.y + f.h - r;
  const out: P[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 2));
    for (let i = 0; i < n; i++) out.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  };
  const turn = (cx: number, cy: number, a0: number) => {
    const n = Math.max(2, Math.round((r * Math.PI) / 4));
    for (let i = 0; i < n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  line(x0, y0 - r, x1, y0 - r);
  turn(x1, y0, -90);
  line(x1 + r, y0, x1 + r, y1);
  turn(x1, y1, 0);
  line(x1, y1 + r, x0, y1 + r);
  turn(x0, y1, 90);
  line(x0 - r, y1, x0 - r, y0);
  turn(x0, y0, 180);
  return out;
}

/** Ступеней яркости у света по кромке: куски одной ступени собраны в один контур. */
const LEVELS = 8;
/** Контуры света по ступеням: кромка та же, пока не сдвинулся конец связи. */
const levelsOf = new WeakMap<object, Path2D[]>();

/** Свет по кромке: куски по 8 px, яркость куска - по его середине, округлённая до ступени. Каждая ступень - один
 *  контур на два штриха: по куску на штрих в каждом кадре было самым дорогим на слое связей. */
export function edgeLight(g: CanvasRenderingContext2D, edge: (P & { o: number })[], color: string, scale = 1): void {
  let paths = levelsOf.get(edge);
  if (!paths) {
    paths = Array.from({ length: LEVELS }, () => new Path2D());
    for (let i = 0; i < edge.length - 1; i += 4) {
      const seg = edge.slice(i, i + 5);
      const level = Math.min(LEVELS - 1, Math.floor(seg[seg.length >> 1].o * LEVELS));
      seg.forEach((p, k) => (k === 0 ? paths![level].moveTo(p.x, p.y) : paths![level].lineTo(p.x, p.y)));
    }
    levelsOf.set(edge, paths);
  }
  g.strokeStyle = color;
  g.lineCap = "butt";
  paths.forEach((path, level) => {
    const o = ((level + 0.5) / LEVELS) * scale;
    g.globalAlpha = 0.25 * o;
    g.lineWidth = 7;
    g.stroke(path);
    g.globalAlpha = o;
    g.lineWidth = 2;
    g.stroke(path);
  });
  g.globalAlpha = 1;
}

/** Связь: широкий ореол и тонкая линия цвета проекта. k - общая яркость (гаснет с карточкой). */
export function ringLine(g: CanvasRenderingContext2D, item: Drawn, k = 1): void {
  const pts = item.route.points;
    poly(g, pts, item.to, 7, 0.16 * k);
    poly(g, pts, item.to, 1.6, k);
  g.globalAlpha = 1;
}

type Edges = { a: (P & { o: number })[]; b: (P & { o: number })[] };
/** Точки света на концах по пути связи: путь новый, только когда связь переложили, а концы сдвигаются только с ней. */
const edgesOf = new WeakMap<object, Edges>();
function endsOf(item: Drawn): Edges {
  const known = edgesOf.get(item.route);
  if (known) return known;
  const pts = item.route.points;
  const edges = { a: edgeFade(item.a, pts[0], item.a.round ? 24 : 80), b: edgeFade(item.b, pts[pts.length - 1], 80) };
  edgesOf.set(item.route, edges);
  return edges;
}

/** Свет на обоих концах связи. */
export function ringEnds(g: CanvasRenderingContext2D, item: Drawn, fade = 1): void {
  const k = fade;
  const { a, b } = endsOf(item);
  edgeLight(g, a, item.from === item.to ? item.to : item.from, k);
  edgeLight(g, b, item.to, k);
}

