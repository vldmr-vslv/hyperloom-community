// Проверка круглого полотна на обычных assert: node src/renderer/src/rings.check.ts
// Сегменты на ободе не ложатся друг на друга; связи между кольцами и карточками их не пересекают.
import assert from "node:assert/strict";
import { ROOT_CARD_ID, type Card, type Layout } from "../../shared/canvas-model.ts";
import { layLinks } from "./link-routes.ts";
import { centerOf, layoutAngles, ringLayout, ringR, RIM, spotAround } from "./rings.ts";
import { FORCE_DEFAULT, stepForces } from "./forces.ts";

const overlaps = (items: { id: string; want?: number; span: number }[]) => {
  const at = layoutAngles(items);
  const span = new Map(items.map((it) => [it.id, it.span]));
  const sorted = [...at].sort((p, q) => p[1] - q[1]);
  return sorted.filter(([id, a], i) => {
    const [next, b] = sorted[(i + 1) % sorted.length];
    const d = sorted.length === 1 ? 360 : (b - a + 360) % 360 || 360;
    return d < (span.get(id)! + span.get(next)!) / 2 - 0.01;
  }).length;
};

// Закрытые сегменты между двумя открытыми не зажимаются: уходят в свободную дугу.
assert.equal(
  overlaps([
    { id: "expoints", want: 10, span: 38 },
    { id: "Hyperloom", want: 60, span: 38 },
    { id: "KeelChart", want: -20, span: 38 },
    { id: "esmcraft", span: 38 },
    { id: "aggrgtr", span: 38 },
    { id: "core.ts", want: 125, span: 10 },
  ]),
  0,
);
assert.equal(overlaps(Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, span: 30 }))), 0);
assert.equal(overlaps([{ id: "a", want: 0, span: 38 }, { id: "b", want: 4, span: 38 }, { id: "c", span: 38 }]), 0);
// Без открытых первый сегмент - сверху.
assert.equal(Math.round(layoutAngles([{ id: "a", span: 38 }, { id: "b", span: 38 }]).get("a")!), 270);

/** Полотно: корень, кольца проектов по кругу, у каждого кольца карточки, поставленные как новые (spotAround). */
function canvas(seed: number): Layout {
  let rnd = seed;
  const next = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const card = (id: string, kind: Card["kind"], x: number, y: number, w = 320, h = 220): Card => ({ id, kind, path: id, position: { x, y }, size: { width: w, height: h } });
  let layout: Layout = { version: 2, cards: [card(ROOT_CARD_ID, "folder", 0, 0)], edges: [], hidden: [] } as unknown as Layout;
  const rings = 2 + Math.floor(next() * 3);
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * 2 * Math.PI + next();
    const id = `p${i}`;
    layout = { ...layout, cards: [...layout.cards, card(id, "folder", Math.cos(a) * 720, Math.sin(a) * 720)], edges: [...layout.edges, { id: `${ROOT_CARD_ID}->${id}`, from: ROOT_CARD_ID, to: id }] };
    for (let k = 0; k < 1 + Math.floor(next() * 3); k++) {
      const kid = `${id}#${k}`;
      const at = spotAround(ringLayout(layout), id, { width: 320, height: 220 });
      layout = { ...layout, cards: [...layout.cards, card(kid, k === 0 ? "note" : "terminal", at.x, at.y)], edges: [...layout.edges, { id: `${id}->${kid}`, from: id, to: kid }] };
    }
  }
  return ringLayout(layout);
}

for (let seed = 1; seed <= 10; seed++) {
  const layout = canvas(seed);
  const { laid } = layLinks(layout, new Map(), (p) => p, null, true);
  const byId = new Map(layout.cards.map((c) => [c.id, c]));
  for (const edge of layout.edges) {
    const route = laid.routes.get(edge.id)!;
    for (const card of layout.cards) {
      if (card.id === edge.from || card.id === edge.to) continue;
      const inside = route.samples.filter((p) => {
        if (card.kind === "folder") {
          const c = centerOf(card);
          return Math.hypot(p.x - c.x, p.y - c.y) < ringR(card) + RIM;
        }
        return p.x > card.position.x && p.x < card.position.x + card.size.width && p.y > card.position.y && p.y < card.position.y + card.size.height;
      }).length;
      assert.equal(inside, 0, `расстановка ${seed}: связь ${edge.id} прошла через ${card.id} (${byId.get(card.id)!.kind})`);
    }
  }
}

// Силы со столкновениями: карточка, брошенная на кольцо, съезжает с него; кольцо, тянутое рукой, стоит.
{
  const ring: Card = { id: "p", kind: "folder", path: "p", position: { x: 0, y: 0 }, size: { width: 260, height: 260 } };
  const card: Card = { id: "c", kind: "terminal", path: "c", position: { x: 60, y: 80 }, size: { width: 320, height: 220 } };
  const bodies = [ring, card].map((c) => ({ id: c.id, card: c, ...centerOf(c), vx: 0, vy: 0 }));
  for (let i = 0; i < 60; i++) stepForces(bodies, new Map(), { ...FORCE_DEFAULT, collide: true }, 1, "p");
  const [r, c] = bodies;
  assert.deepEqual([r.x, r.y], [130, 130], "тянутое рукой кольцо сдвинулось");
  const qx = Math.max(c.x - 160, Math.min(r.x, c.x + 160));
  const qy = Math.max(c.y - 110, Math.min(r.y, c.y + 110));
  assert.ok(Math.hypot(r.x - qx, r.y - qy) >= ringR(ring) + RIM + FORCE_DEFAULT.gap - 0.5, "карточка осталась на кольце");
}


// Кольцо тянут: задетая связь - прямая кривая без обхода, как в прототипе, и прокладка помечена неполной; полотно
// замерло (prev = null) - связь снова обходит кольцо, стоящее между концами.
{
  const ring = (id: string, x: number): Card => ({ id, kind: "folder", path: id, position: { x, y: 0 }, size: { width: 200, height: 200 } });
  const still: Layout = { version: 2, cards: [ring("a", 0), ring("mid", 400), ring("b", 800)], edges: [{ id: "a->b", from: "a", to: "b" }], hidden: [] } as unknown as Layout;
  const first = layLinks(still, new Map(), (p) => p, null, true);
  const around = first.laid.routes.get("a->b")!;
  const through = (route: typeof around) => route.samples.some((p) => Math.hypot(p.x - 500, p.y - 100) < 100);
  assert.ok(!through(around), "связь прошла сквозь кольцо");
  const dragged: Layout = { ...still, cards: [ring("a", 10), ring("mid", 400), ring("b", 800)] };
  const moving = layLinks(dragged, new Map(), (p) => p, first.laid, true);
  assert.equal(moving.partial, true);
  assert.equal(moving.laid.routes.get("a->b")!.points.length, 33, "в движении связь не прямая кривая");
  assert.ok(!through(layLinks(dragged, new Map(), (p) => p, null, true).laid.routes.get("a->b")!), "замершее полотно без обхода");
}


console.log("rings: все проверки пройдены");
