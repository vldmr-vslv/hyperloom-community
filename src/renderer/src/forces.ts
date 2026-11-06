// Силы круглого полотна, как граф в Obsidian (_scratch/root-dial, тикет 05): связи тянут кольца и карточки друг к
// другу до длины связи, все отталкиваются, слабая сила тянет к середине; столкновения не дают положить одно на
// другое. Тянутое рукой стоит, остальные расступаются. Силы остывают по часам и засыпают, когда всё замерло.
// ponytail: перебор всех пар; потолок - сотни карточек, дальше - сетка или дерево Барнса-Хата.
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { ROOT_CARD_ID, type Card, type Layout } from "../../shared/canvas-model.ts";
import type { Pt } from "../../shared/route.ts";
import { centerOf, isRing, ringR, RIM } from "./rings.ts";

export type Forces = { forces: boolean; link: number; dist: number; repel: number; center: number; collide: boolean; gap: number };
/** По умолчанию силы выключены: полотно ведёт себя как раньше, пока их не включили. */
export const FORCE_DEFAULT: Forces = { forces: false, link: 0.4, dist: 160, repel: 0.4, center: 0.15, collide: false, gap: 28 };
export const FORCE_ROWS: [keyof Forces, string, number, number, number][] = [
  ["link", "Притяжение по связям", 0, 1, 0.05],
  ["dist", "Длина связи", 40, 400, 10],
  ["repel", "Отталкивание", 0, 1, 0.05],
  ["center", "К середине", 0, 1, 0.05],
];

const KEY = "hyperloom.forces";

export function initialForces(): Forces {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object") return { ...FORCE_DEFAULT };
    const out = { ...FORCE_DEFAULT };
    for (const key of Object.keys(FORCE_DEFAULT) as (keyof Forces)[]) {
      const v = (saved as Record<string, unknown>)[key];
      if (typeof v === typeof FORCE_DEFAULT[key]) (out as Record<string, unknown>)[key] = v;
    }
    return out;
  } catch {
    // Хранилище недоступно или в нём не JSON: силы как в первый раз.
    return { ...FORCE_DEFAULT };
  }
}

export function saveForces(forces: Forces): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(forces));
  } catch {
    // Хранилище недоступно: настройки продержатся до закрытия окна.
  }
}

type Body = { id: string; card: Card; x: number; y: number; vx: number; vy: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Протяжённость тела от середины в сторону (ux, uy): у кольца - радиус с кромкой (у корня - с декором), у карточки -
 *  до её края. */
function extent(b: Body, ux: number, uy: number): number {
  if (isRing(b.card)) return ringR(b.card) + (b.id === ROOT_CARD_ID ? 66 : RIM);
  return Math.min(b.card.size.width / 2 / (Math.abs(ux) || 1e-6), b.card.size.height / 2 / (Math.abs(uy) || 1e-6));
}

const massOf = (b: Body) => (b.id === ROOT_CARD_ID ? 6 : isRing(b.card) ? 2 : 1);

/** Насколько сдвинуть b от a, чтобы между ними остался зазор gap; null - и так не задевают. */
function separation(a: Body, b: Body, gap: number): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ra = isRing(a.card);
  const rb = isRing(b.card);
  if (ra && rb) {
    const d = Math.hypot(dx, dy) || 0.01;
    const need = extent(a, 1, 0) + extent(b, 1, 0) + gap;
    return d < need ? { x: (dx / d) * (need - d), y: (dy / d) * (need - d) } : null;
  }
  if (!ra && !rb) {
    const ox = a.card.size.width / 2 + b.card.size.width / 2 + gap - Math.abs(dx);
    const oy = a.card.size.height / 2 + b.card.size.height / 2 + gap - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    return ox < oy ? { x: (Math.sign(dx) || 1) * ox, y: 0 } : { x: 0, y: (Math.sign(dy) || 1) * oy };
  }
  // Кольцо и карточка: от ближайшей точки карточки до середины кольца.
  const ring = ra ? a : b;
  const card = ra ? b : a;
  const flip = ra ? -1 : 1;
  const r = extent(ring, 1, 0) + gap;
  const w = card.card.size.width / 2;
  const h = card.card.size.height / 2;
  const qx = clamp(ring.x, card.x - w, card.x + w);
  const qy = clamp(ring.y, card.y - h, card.y + h);
  const ex = ring.x - qx;
  const ey = ring.y - qy;
  const d = Math.hypot(ex, ey);
  let move: Pt;
  if (d > 0) {
    if (d >= r) return null;
    move = { x: (ex / d) * (r - d), y: (ey / d) * (r - d) };
  } else {
    const cx = ring.x - card.x;
    const cy = ring.y - card.y;
    const ox = w + r - Math.abs(cx);
    const oy = h + r - Math.abs(cy);
    move = ox < oy ? { x: (Math.sign(cx) || 1) * ox, y: 0 } : { x: 0, y: (Math.sign(cy) || 1) * oy };
  }
  // move сдвигает кольцо от карточки; нужен сдвиг b от a: кольцо - это a, и тогда b сдвигается обратно.
  return { x: move.x * flip, y: move.y * flip };
}

/** Один шаг сил: alpha - температура, held - тело под рукой, оно не двигается. */
export function stepForces(bodies: Body[], parents: ReadonlyMap<string, string>, phys: Forces, alpha: number, held: string | null): void {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const push = (b: Body, fx: number, fy: number) => {
    b.vx += fx / massOf(b);
    b.vy += fy / massOf(b);
  };
  if (phys.forces) {
    const mid = bodies.reduce((m, b) => ({ x: m.x + b.x / bodies.length, y: m.y + b.y / bodies.length }), { x: 0, y: 0 });
    for (const b of bodies) {
      const p = byId.get(parents.get(b.id) ?? "");
      if (p) {
        const d = Math.hypot(b.x - p.x, b.y - p.y) || 1;
        const ux = (b.x - p.x) / d;
        const uy = (b.y - p.y) / d;
        const k = (d - extent(p, ux, uy) - extent(b, ux, uy) - phys.dist) * phys.link * 0.06 * alpha;
        push(b, -ux * k, -uy * k);
        push(p, ux * k, uy * k);
      }
      push(b, (mid.x - b.x) * phys.center * 0.004 * alpha, (mid.y - b.y) * phys.center * 0.004 * alpha);
    }
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i];
        const q = bodies[j];
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const ux = (q.x - p.x) / d;
        const uy = (q.y - p.y) / d;
        const gap = Math.max(0, d - extent(p, ux, uy) - extent(q, ux, uy));
        const k = (phys.repel * 30 * alpha) / (1 + gap / 120);
        push(p, -ux * k, -uy * k);
        push(q, ux * k, uy * k);
      }
  }
  for (const b of bodies) {
    if (b.id === held) {
      b.vx = b.vy = 0;
      continue;
    }
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= 0.55;
    b.vy *= 0.55;
  }
  if (!phys.collide) return;
  for (let it = 0; it < 3; it++)
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i];
        const q = bodies[j];
        const sep = separation(p, q, phys.gap);
        if (!sep || (p.id === held && q.id === held)) continue;
        const ip = p.id === held ? 0 : 1 / massOf(p);
        const iq = q.id === held ? 0 : 1 / massOf(q);
        p.x -= (sep.x * ip) / (ip + iq);
        p.y -= (sep.y * ip) / (ip + iq);
        q.x += (sep.x * iq) / (ip + iq);
        q.y += (sep.y * iq) / (ip + iq);
      }
}

/**
 * Силы на полотне: пока не остыли, шаг каждый кадр, а положения уходят в раскладку не чаще раза в 33 мс. Остывание
 * по часам: при медленных кадрах силы гаснут за те же ~4 с. moving - силы двигают карточки прямо сейчас: раскладку в
 * это время App пишет на диск не чаще раза в секунду.
 */
export function useForces(
  on: boolean,
  phys: Forces,
  canvas: MutableRefObject<Layout | null>,
  place: (moves: ReadonlyMap<string, Pt>) => void,
  held: MutableRefObject<string | null>,
) {
  const sim = useRef({ alpha: 0, at: 0, drawAt: 0, frame: 0, bodies: new Map<string, Body>() });
  const moving = useRef(false);
  const live = on && (phys.forces || phys.collide);
  const settings = useRef({ live, phys, place });
  settings.current = { live, phys, place };

  const tick = useCallback((now: number) => {
    const s = sim.current;
    s.frame = 0;
    const { live, phys, place } = settings.current;
    const layout = canvas.current;
    if (!live || !layout || (s.alpha < 0.02 && held.current === null)) {
      moving.current = false;
      s.at = 0;
      return;
    }
    // Тела - из раскладки: новые карточки входят, закрытые уходят, тянутая рукой стоит там, где рука.
    const ids = new Set(layout.cards.map((card) => card.id));
    for (const id of [...s.bodies.keys()]) if (!ids.has(id)) s.bodies.delete(id);
    for (const card of layout.cards) {
      const known = s.bodies.get(card.id);
      const at = centerOf(card);
      if (!known || card.id === held.current) s.bodies.set(card.id, { id: card.id, card, x: at.x, y: at.y, vx: 0, vy: 0 });
      else known.card = card;
    }
    const parents = new Map(layout.edges.map((e) => [e.to, e.from]));
    stepForces([...s.bodies.values()], parents, phys, s.alpha, held.current);
    const dt = Math.min(100, now - (s.at || now - 16.7));
    s.at = now;
    s.alpha *= Math.pow(0.985, dt / 16.7);
    moving.current = true;
    if (now - s.drawAt >= 33) {
      s.drawAt = now;
      const moves = new Map<string, Pt>();
      for (const b of s.bodies.values()) {
        if (b.id === held.current) continue;
        const x = Math.round(b.x - b.card.size.width / 2);
        const y = Math.round(b.y - b.card.size.height / 2);
        if (x !== b.card.position.x || y !== b.card.position.y) moves.set(b.id, { x, y });
      }
      if (moves.size) place(moves);
    }
    s.frame = requestAnimationFrame(tick);
  }, [canvas, held]);

  /** Толчок: силы разогреваются до a и просыпаются. */
  const reheat = useCallback(
    (a = 0.6) => {
      const s = sim.current;
      if (!settings.current.live) return;
      s.alpha = Math.max(s.alpha, a);
      if (!s.frame) s.frame = requestAnimationFrame(tick);
    },
    [tick],
  );

  useEffect(() => {
    if (live) reheat(0.8);
  }, [live, phys, reheat]);
  // Номер кадра обнуляется вместе с отменой: иначе reheat считал бы, что цикл идёт, и силы больше не просыпались бы
  // (StrictMode в разработке снимает и ставит эффекты дважды).
  useEffect(
    () => () => {
      cancelAnimationFrame(sim.current.frame);
      sim.current.frame = 0;
    },
    [],
  );
  return { reheat, moving };
}
