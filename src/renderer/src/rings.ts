// Геометрия круглого полотна (тёмная тема, _scratch/root-dial): папки и корень - кольца, остальные карточки
// растут от них. Связи входят в кольцо по ободу, в карточку - в сторону, обращённую к другому концу. Чистые
// функции без DOM: их зовут App, слой связей и кольцо.
import { ROOT_CARD_ID, type Card, type Layout, type Size } from "../../shared/canvas-model.ts";
import type { Pt } from "../../shared/route.ts";

/** Внешняя кромка кольца над радиусом R: лента с путём занимает R + 5 .. R + 17, связи входят сюда. */
export const RIM = 17;
/** Скругление угла карточки на круглом полотне: плита "керамика Atlas" почти прямоугольная. */
export const CARD_R = 4;

export const isRing = (card: Card): boolean => card.kind === "folder";

/** Радиус корня и кольца папки. Корень крупнее: в середине картинка, её круг - 0.66 радиуса (RootCore). */
export const ROOT_R = 210;
export const FOLDER_R = 112;

export function ringR(card: Card): number {
  return card.id === ROOT_CARD_ID ? ROOT_R : FOLDER_R;
}

/** Сторона квадрата, в который вписано кольцо вместе с лентой. */
export function ringSide(card: Card): number {
  return 2 * (ringR(card) + RIM + 1);
}

/** Раскладка круглого полотна: у колец свой размер, свёрнутых колец нет. В файл не пишется: в других темах
 *  папки остаются карточками своего размера. */
export function ringLayout(layout: Layout): Layout {
  return {
    ...layout,
    cards: layout.cards.map((card) => {
      if (!isRing(card)) return card;
      const side = ringSide(card);
      return { ...card, size: { width: side, height: side }, collapsed: undefined };
    }),
  };
}

export function centerOf(card: Card): Pt {
  return { x: card.position.x + card.size.width / 2, y: card.position.y + card.size.height / 2 };
}

/** Порт связи: точка на краю и нормаль края наружу. */
export type Port = Pt & { nx: number; ny: number };

/** Порт на ободе кольца в сторону toward. */
export function rimPort(card: Card, toward: Pt): Port {
  const c = centerOf(card);
  const r = ringR(card) + RIM;
  const a = Math.atan2(toward.y - c.y, toward.x - c.x);
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Порт карточки: сторона, обращённая к toward (с поправкой на пропорции карточки), точка на ней - напротив
 * toward, но не ближе r + 14 к углу. Нормаль - перпендикуляр к стороне: связь входит прямо, а не в угол.
 */
export function rectPort(card: Card, toward: Pt, height = card.size.height, r = CARD_R): Port {
  const w = card.size.width;
  const cx = card.position.x + w / 2;
  const cy = card.position.y + height / 2;
  const dx = (toward.x - cx) / (w / 2);
  const dy = (toward.y - cy) / (height / 2);
  const pad = r + 14;
  if (Math.abs(dx) > Math.abs(dy)) {
    const sx = Math.sign(dx) || 1;
    return { x: cx + (sx * w) / 2, y: clamp(toward.y, cy - height / 2 + pad, cy + height / 2 - pad), nx: sx, ny: 0 };
  }
  const sy = Math.sign(dy) || 1;
  return { x: clamp(toward.x, cx - w / 2 + pad, cx + w / 2 - pad), y: cy + (sy * height) / 2, nx: 0, ny: sy };
}

/** Угол от a к b, градусы 0..360. */
export function angleTo(a: Pt, b: Pt): number {
  return ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 360) + 360) % 360;
}

const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Место новой карточки у кольца: не ложится на другие кольца и карточки, а среди таких мест - там, где на
 * кольце свободнее от его связей. Возвращает левый верхний угол. Полотно сдвигается, поэтому за краем экрана
 * место есть всегда: штраф только за наложение.
 * ponytail: перебор 36 направлений против всех карточек; на сотне карточек это 3600 проверок за открытие.
 */
export function spotAround(layout: Layout, ringId: string, size: Size): Pt {
  const ring = layout.cards.find((card) => card.id === ringId);
  if (!ring) return { x: 0, y: 0 };
  const c = centerOf(ring);
  const byId = new Map(layout.cards.map((card) => [card.id, card]));
  const used: number[] = [];
  for (const edge of layout.edges) {
    const other = edge.from === ringId ? byId.get(edge.to) : edge.to === ringId ? byId.get(edge.from) : undefined;
    if (other) used.push(angleTo(c, centerOf(other)));
  }
  const { width: w, height: h } = size;
  const hits = (x: number, y: number) => {
    let bad = 0;
    for (const o of layout.cards) {
      if (isRing(o)) {
        const oc = centerOf(o);
        const qx = clamp(oc.x, x - w / 2, x + w / 2);
        const qy = clamp(oc.y, y - h / 2, y + h / 2);
        bad += Math.hypot(oc.x - qx, oc.y - qy) < ringR(o) + (o.id === ROOT_CARD_ID ? 80 : 26) ? 1 : 0;
      } else {
        const oc = centerOf(o);
        bad += Math.abs(oc.x - x) < (o.size.width + w) / 2 + 16 && Math.abs(oc.y - y) < (o.size.height + h) / 2 + 16 ? 1 : 0;
      }
    }
    return bad;
  };
  let best = { score: -Infinity, x: c.x, y: c.y };
  for (let a = 0; a < 360; a += 10) {
    const d = ringR(ring) + 60 + Math.hypot(w, h) / 2;
    const x = c.x + d * Math.cos((a * Math.PI) / 180);
    const y = c.y + d * Math.sin((a * Math.PI) / 180);
    const room = used.length ? Math.min(...used.map((u) => gap(a, u))) : 180;
    const score = room - 1000 * hits(x, y);
    if (score > best.score) best = { score, x, y };
  }
  return { x: Math.round(best.x - w / 2), y: Math.round(best.y - h / 2) };
}

/**
 * Раскладка по кольцу. Открытое (подпапка своим кольцом, карточка) стоит на направлении к своему узлу: want, и
 * открытые только расталкивают друг друга. Закрытые раскладываются по свободным дугам между открытыми: каждый в
 * дугу, где на одного выходит больше места, внутри дуги - поровну. Толкать закрытые нельзя: зажатые между двумя
 * открытыми, они не перепрыгнули бы через них и легли бы друг на друга.
 * want - направление к узлу, нет - закрытое; span - ширина в градусах.
 */
export function layoutAngles(items: { id: string; want?: number; span: number }[]): Map<string, number> {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const open = items.filter((it) => it.want !== undefined).map((it) => ({ ...it, a: norm(it.want!) }));
  for (let k = 0; k < 60 && open.length > 1; k++) {
    open.sort((p, q) => p.a - q.a);
    for (let i = 0; i < open.length; i++) {
      const p = open[i];
      const q = open[(i + 1) % open.length];
      const d = q.a - p.a + (i === open.length - 1 ? 360 : 0);
      const need = (p.span + q.span) / 2 + 3;
      if (d >= need) continue;
      p.a = norm(p.a - (need - d) / 2);
      q.a = norm(q.a + (need - d) / 2);
    }
  }
  open.sort((p, q) => p.a - q.a);
  const out = new Map(open.map((it) => [it.id, it.a]));
  const closed = items.filter((it) => it.want === undefined);
  if (closed.length === 0) return out;
  // Свободные дуги между открытыми; открытых нет - одна дуга на весь круг, первая закрытая - сверху.
  const arcs = open.length
    ? open.map((p, i) => {
        const q = open[(i + 1) % open.length];
        const from = p.a + p.span / 2 + 3;
        const to = q.a - q.span / 2 - 3 + (i === open.length - 1 || q.a <= p.a ? 360 : 0);
        return { from, len: Math.max(0, to - from), ids: [] as { id: string; span: number }[] };
      })
    : [{ from: -90 - 180 / closed.length, len: 360, ids: [] as { id: string; span: number }[] }];
  for (const it of closed) {
    const best = arcs.reduce((a, b) => (b.len / (b.ids.length + 1) > a.len / (a.ids.length + 1) ? b : a));
    best.ids.push(it);
  }
  for (const arc of arcs) {
    const step = arc.len / Math.max(1, arc.ids.length);
    arc.ids.forEach((it, j) => out.set(it.id, norm(arc.from + (j + 0.5) * step)));
  }
  return out;
}


