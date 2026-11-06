// Сетка полотна для обхода карточек: клетки под карточками с зазором закрыты, клетки, по которым
// уже прошла связь, дороже. Поиск пути по ней - A* с весом оценки. Поле вокруг всех карточек даёт
// обойти группу снаружи, когда прохода между ними нет.
// ponytail: сетка 16 px и A* на каждую связь. Потолок - сотни связей на большом полотне;
// апгрейд - граф видимости по углам карточек вместо сетки.
import type { Pt, Route } from "./route.ts";

/** round - круг, вписанный в квадрат коробки: кольцо папки на круглом полотне. */
export type Box = { x: number; y: number; w: number; h: number; round?: boolean };

/** Точка внутри коробки с зазором pad: у круга - по расстоянию до середины. */
export function within(b: Box, p: Pt, pad: number): boolean {
  if (b.round) {
    const r = b.w / 2 + pad;
    return (p.x - b.x - b.w / 2) ** 2 + (p.y - b.y - b.h / 2) ** 2 < r * r;
  }
  return p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
}

export const CELL = 16;
/** Зазор от карточки до закрытых клеток, px. */
export const CLEAR = 14;
const MARGIN = 320;
/** Поворот стоит как лишний шаг: путь без нужды не петляет. */
const TURN = 0.8;
/** Клетка под карточкой в мягком поиске: проходима, но дорога. */
const UNDER = 40;
/** Вес оценки остатка пути: больше 1 - поиск меньше расползается в стороны ценой чуть более
 *  длинного пути. Нужен живой перекладке, пока карточку тянут. */
const WEIGHT = 1.8;

export type Grid = {
  boxes: Box[];
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
  used: Float32Array;
  // Буферы поиска общие на все связи одного прохода: метка отличает свежие значения от старых.
  cost: Float32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  pass: number;
};

export function makeGrid(boxes: Box[]): Grid {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const x0 = minX - MARGIN;
  const y0 = minY - MARGIN;
  const cols = Math.ceil((maxX - minX + 2 * MARGIN) / CELL);
  const rows = Math.ceil((maxY - minY + 2 * MARGIN) / CELL);
  const n = cols * rows;
  const blocked = new Uint8Array(n);
  for (const b of boxes) {
    const c0 = Math.max(0, Math.floor((b.x - CLEAR - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((b.x + b.w + CLEAR - x0) / CELL));
    const r0 = Math.max(0, Math.floor((b.y - CLEAR - y0) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((b.y + b.h + CLEAR - y0) / CELL));
    if (!b.round) {
      for (let r = r0; r <= r1; r++) blocked.fill(1, r * cols + c0, r * cols + c1 + 1);
      continue;
    }
    // Круг: закрыта клетка, ближняя точка которой ближе зазора к ободу.
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const reach = (b.w / 2 + CLEAR) ** 2;
    for (let r = r0; r <= r1; r++) {
      const y = Math.max(y0 + r * CELL, Math.min(cy, y0 + (r + 1) * CELL));
      for (let c = c0; c <= c1; c++) {
        const x = Math.max(x0 + c * CELL, Math.min(cx, x0 + (c + 1) * CELL));
        if ((x - cx) ** 2 + (y - cy) ** 2 < reach) blocked[r * cols + c] = 1;
      }
    }
  }
  return {
    boxes,
    x0,
    y0,
    cols,
    rows,
    blocked,
    used: new Float32Array(n),
    cost: new Float32Array(n),
    parent: new Int32Array(n),
    stamp: new Uint32Array(n),
    closed: new Uint32Array(n),
    pass: 0,
  };
}

export function cellOf(g: Grid, p: Pt): number {
  const c = Math.max(0, Math.min(g.cols - 1, Math.floor((p.x - g.x0) / CELL)));
  const r = Math.max(0, Math.min(g.rows - 1, Math.floor((p.y - g.y0) / CELL)));
  return r * g.cols + c;
}

export function centerOf(g: Grid, i: number): Pt {
  return { x: g.x0 + (i % g.cols) * CELL + CELL / 2, y: g.y0 + Math.floor(i / g.cols) * CELL + CELL / 2 };
}

/** Двоичная куча по стоимости: открытый список A*. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    let i = this.ids.length;
    this.ids.push(id);
    this.keys.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.keys[up] <= key) break;
      this.ids[i] = this.ids[up];
      this.keys[i] = this.keys[up];
      i = up;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length === 0) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= ids.length) break;
      const child = l + 1 < ids.length && keys[l + 1] < keys[l] ? l + 1 : l;
      if (keys[child] >= lastKey) break;
      ids[i] = ids[child];
      keys[i] = keys[child];
      i = child;
    }
    ids[i] = lastId;
    keys[i] = lastKey;
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Путь клетками от start до goal. soft: клетки под карточками проходимы, но дороги - когда конец
 * связи накрыт другой карточкой и свободного пути нет, путь идёт под карточками как можно короче.
 * Соседи перебираются прямо в цикле, без вынесенной функции: это самое горячее место перекладки,
 * и она идёт на каждом кадре, пока карточку тянут.
 */
export function search(g: Grid, start: number, goal: number, soft: boolean): number[] | null {
  const pass = ++g.pass;
  const gx = goal % g.cols;
  const gy = Math.floor(goal / g.cols);
  const guess = (i: number) => {
    const dx = Math.abs((i % g.cols) - gx);
    const dy = Math.abs(Math.floor(i / g.cols) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap();
  g.stamp[start] = pass;
  g.cost[start] = 0;
  g.parent[start] = -1;
  heap.push(start, WEIGHT * guess(start));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (g.closed[cur] === pass) continue;
    g.closed[cur] = pass;
    const cx = cur % g.cols;
    const cy = Math.floor(cur / g.cols);
    const p = g.parent[cur];
    const pdx = p < 0 ? 0 : cx - (p % g.cols);
    const pdy = p < 0 ? 0 : cy - Math.floor(p / g.cols);
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const ni = ny * g.cols + nx;
      if (g.closed[ni] === pass || (g.blocked[ni] && ni !== goal && !soft)) continue;
      // Диагональ не срезает угол карточки: обе соседние клетки должны быть свободны.
      if (dx && dy && !soft && (g.blocked[cy * g.cols + nx] || g.blocked[ny * g.cols + cx])) continue;
      const turn = p >= 0 && (dx !== pdx || dy !== pdy) ? TURN : 0;
      const next = g.cost[cur] + step + turn + g.used[ni] + (soft && g.blocked[ni] ? UNDER : 0);
      if (g.stamp[ni] === pass && next >= g.cost[ni]) continue;
      g.stamp[ni] = pass;
      g.cost[ni] = next;
      g.parent[ni] = cur;
      heap.push(ni, next + WEIGHT * guess(ni));
    }
  }
  if (g.stamp[goal] !== pass) return null;
  const path: number[] = [];
  for (let i = goal; i >= 0; i = g.parent[i]) path.push(i);
  return path.reverse();
}

/** Клетки под проложенной связью дорожают: следующие связи идут рядом, а не по ней. */
export function markUsed(g: Grid, route: Route): void {
  for (const p of route.samples) {
    const i = cellOf(g, p);
    g.used[i] += 2.5;
    if (i % g.cols > 0) g.used[i - 1] += 1.2;
    if (i % g.cols < g.cols - 1) g.used[i + 1] += 1.2;
    if (i >= g.cols) g.used[i - g.cols] += 1.2;
    if (i < g.used.length - g.cols) g.used[i + g.cols] += 1.2;
  }
}
