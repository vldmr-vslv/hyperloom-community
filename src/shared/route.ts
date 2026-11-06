// Геометрия связей полотна: путь от порта к порту и его выборка по длине. Чистые функции без DOM,
// поэтому модуль проверяется обычным node. Рисует по этим путям слой связей (LinkCanvas.tsx).

export type Pt = { x: number; y: number };
/** Точка выборки: положение, нормаль к пути и расстояние от начала. */
export type Sample = { x: number; y: number; nx: number; ny: number; s: number };
/** Путь связи: точки кривой и их выборка через каждые STEP px - по ней рисуются жгут и импульс. */
export type Route = { points: Pt[]; samples: Sample[]; length: number };

/** Шаг выборки пути, px. */
export const STEP = 4;

/** Выборка по длине с нормалями: из неё рисуются нити жгута и бежит импульс. */
export function sample(points: Pt[]): { samples: Sample[]; length: number } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const length = cum[cum.length - 1];
  const samples: Sample[] = [];
  let seg = 0;
  for (let s = 0; s <= length; s += STEP) {
    while (seg < points.length - 2 && cum[seg + 1] < s) seg++;
    const a = points[seg];
    const b = points[seg + 1] ?? a;
    const span = cum[seg + 1] - cum[seg] || 1;
    const t = (s - cum[seg]) / span;
    const tx = (b.x - a.x) / span;
    const ty = (b.y - a.y) / span;
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -ty, ny: tx, s });
  }
  // Конец пути - всегда в выборке: шагом до него обычно не доходит, и связь обрывалась бы
  // не доходя до своей точки.
  const last = samples[samples.length - 1];
  const end = points[points.length - 1];
  if (last && length - last.s > 0.01) samples.push({ ...last, x: end.x, y: end.y, s: length });
  return { samples, length };
}

/** Кубическая кривая Безье точками: первая точка - начало, последняя - конец. */
function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, parts: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= parts; i++) {
    const u = i / parts;
    const v = 1 - u;
    points.push({
      x: v * v * v * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * b.x,
      y: v * v * v * a.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * b.y,
    });
  }
  return points;
}

/**
 * Связь от порта к порту, как в редакторах узлов: выходит из правого края начала вправо и входит
 * в левый край конца слева; out и back - нормали краёв наружу, если связь выходит и входит не по горизонтали. Изгиб - как у кривой React Flow: полрасстояния, а если конец левее
 * начала - петля растёт с корнем из обратного расстояния.
 */
export function bezier(from: Pt, to: Pt, out?: Pt, back?: Pt): Route {
  if (out && back) {
    // Концы с нормалями (круглое полотно): связь выходит и входит по нормали своего края.
    const k = Math.min(170, Math.hypot(to.x - from.x, to.y - from.y) * 0.42);
    const bent = cubic(from, { x: from.x + out.x * k, y: from.y + out.y * k }, { x: to.x + back.x * k, y: to.y + back.y * k }, to, 32);
    return { points: bent, ...sample(bent) };
  }
  const dx = to.x - from.x;
  const reach = dx >= 0 ? dx / 2 : 0.25 * 25 * Math.sqrt(-dx);
  const points = cubic(from, { x: from.x + reach, y: from.y }, { x: to.x - reach, y: to.y }, to, 32);
  return { points, ...sample(points) };
}

/** Середина пути: сюда ложатся кнопки ручной стрелки. */
export function midpoint(route: Route): Pt {
  const { samples, length } = route;
  const at = samples[Math.min(samples.length - 1, Math.round(length / 2 / STEP))];
  return at ? { x: at.x, y: at.y } : route.points[0];
}

/** На каком расстоянии по пути от кромки жгут вливается в путь связи, px. */
const JOIN = 64;

/**
 * Выборка жгута от носика до носика раструбов: из носика жгут выходит прямо, по оси раструба, и на
 * JOIN px от кромки плавно вливается в путь связи. Путь у кромки бывает и под углом - по нему жгут
 * выходил бы из бока раструба, а не из носика. reach - от кромки до начала жгута, px. Связь выходит
 * с правого ребра источника и входит в левое ребро цели; короткая связь - одна кривая от носика
 * к носику. Тот же путь с тем же reach отдаёт прежний объект: слой нитей держит путь в видеокарте,
 * пока объект тот же (strands.ts).
 */
export function tipped(route: Route, reach: number): { samples: Sample[]; length: number } {
  const known = tips.get(route);
  if (known?.reach === reach) return known.path;
  const path = tip(route, reach);
  tips.set(route, { reach, path });
  return path;
}

const tips = new WeakMap<Route, { reach: number; path: { samples: Sample[]; length: number } }>();

function tip(route: Route, reach: number): { samples: Sample[]; length: number } {
  const { samples, length } = route;
  const first = samples[0];
  const end = samples[samples.length - 1];
  const from = { x: first.x + reach, y: first.y };
  const to = { x: end.x - reach, y: end.y };
  const k = (JOIN - reach) * 0.55;
  const i0 = samples.findIndex((p) => p.s >= JOIN);
  let i1 = samples.length - 1;
  while (i1 > 0 && samples[i1].s > length - JOIN) i1--;
  if (i0 < 1 || i1 - i0 < 2) {
    return sample(cubic(from, { x: from.x + k, y: from.y }, { x: to.x - k, y: to.y }, to, 12));
  }
  const heading = (i: number) => {
    const p = samples[i - 1];
    const q = samples[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  };
  const q0 = samples[i0];
  const d0 = heading(i0);
  const q1 = samples[i1];
  const d1 = heading(i1);
  const points: Pt[] = [
    ...cubic(from, { x: from.x + k, y: from.y }, { x: q0.x - d0.x * k, y: q0.y - d0.y * k }, q0, 12),
    ...samples.slice(i0 + 1, i1),
    ...cubic(q1, { x: q1.x + d1.x * k, y: q1.y + d1.y * k }, { x: to.x - k, y: to.y }, to, 12),
  ];
  return sample(points);
}
