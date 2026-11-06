// Раскладка графа полотна, как в Obsidian: кружки расталкиваются, связи тянут их друг к другу, всё
// слегка тянется к центру. Шаг за кадром, пока граф не успокоится.
// ponytail: попарное отталкивание O(n²) - на сотне кружков ещё быстро; дальше - дерево Барнса-Хата.

export type Body = { x: number; y: number; vx: number; vy: number };

const REPULSE = 9000;
const LENGTH = 120;
const SPRING = 0.025;
const GRAVITY = 0.003;
const DAMP = 0.86;
/** Потолок скорости: в первые кадры после превращения карточек в кружки их иначе разбрасывает. */
const TOP_SPEED = 40;

/** Попарное отталкивание: сила обратна квадрату расстояния. Совпавшие кружки разводятся случайно. */
function repulse(list: Body[]): void {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const f = REPULSE / d2;
      a.vx += (f * dx) / d;
      a.vy += (f * dy) / d;
      b.vx -= (f * dx) / d;
      b.vy -= (f * dy) / d;
    }
  }
}

/** Связь - пружина длиной LENGTH. */
function pull(bodies: Map<string, Body>, links: { from: string; to: string }[]): void {
  for (const link of links) {
    const a = bodies.get(link.from);
    const b = bodies.get(link.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (d - LENGTH) * SPRING;
    a.vx += (f * dx) / d;
    a.vy += (f * dy) / d;
    b.vx -= (f * dx) / d;
    b.vy -= (f * dy) / d;
  }
}

/** Один шаг раскладки. held - кружок под рукой, он стоит. Возвращает наибольшую скорость: по ней
 *  видно, что граф успокоился. */
export function settle(
  bodies: Map<string, Body>,
  links: { from: string; to: string }[],
  center: { x: number; y: number },
  held: string | null,
): number {
  repulse([...bodies.values()]);
  pull(bodies, links);
  let fastest = 0;
  for (const [id, p] of bodies) {
    if (id === held) {
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    p.vx = (p.vx + (center.x - p.x) * GRAVITY) * DAMP;
    p.vy = (p.vy + (center.y - p.y) * GRAVITY) * DAMP;
    const v = Math.hypot(p.vx, p.vy);
    if (v > TOP_SPEED) {
      p.vx *= TOP_SPEED / v;
      p.vy *= TOP_SPEED / v;
    }
    p.x += p.vx;
    p.y += p.vy;
    fastest = Math.max(fastest, v);
  }
  return fastest;
}
