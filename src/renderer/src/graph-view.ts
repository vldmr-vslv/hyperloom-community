// Граф полотна: карточки становятся кружками и расходятся раскладкой (shared/graph.ts), связи - прямые
// от кружка к кружку. Карточки при этом не снимаются, а прячутся: в терминале и агенте живут процессы,
// и снятая карточка закрыла бы их. Раскладка графа живёт в окне: места карточек в раскладке полотна
// он не трогает.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { NodeChange, ReactFlowInstance } from "@xyflow/react";
import { cardName, type Card, type Layout } from "../../shared/canvas-model";
import { settle, type Body } from "../../shared/graph";
import type { CardNode } from "./Card";
import { shellOf } from "./card-look";
import { flyCenter } from "./freeze";
import { still } from "./ice";
import { heightOf } from "./link-routes";
import { CANVAS_MOVE } from "./Menu";

/** Кружок графа: размер по виду карточки. */
const DOT: Record<string, number> = { root: 34, folder: 22, terminal: 14, file: 12, image: 12, note: 12 };

function dotOf(card: Card): number {
  return DOT[shellOf(card.id, card.kind, cardName(card))] ?? 12;
}

function centerOf(card: Card): { x: number; y: number } {
  return { x: card.position.x + card.size.width / 2, y: card.position.y + heightOf(card) / 2 };
}

/** Узел карточки в виде кружка графа. dim - кружок не рядом с тем, что под мышью. */
export function asDot(node: CardNode, card: Card, bodies: ReadonlyMap<string, Body>, dim: boolean): CardNode {
  const size = dotOf(card);
  const body = bodies.get(card.id) ?? centerOf(card);
  return {
    ...node,
    position: { x: body.x - size / 2, y: body.y - size / 2 },
    width: size,
    height: size,
    measured: { width: size, height: size },
    className: dim ? "gnode gnode--dim" : "gnode",
    data: { ...node.data, graph: true },
  };
}

export function useGraph(layout: MutableRefObject<Layout | null>, flow: ReactFlowInstance) {
  const [graph, setGraph] = useState(false);
  const bodies = useRef(new Map<string, Body>());
  const center = useRef({ x: 0, y: 0 });
  const held = useRef<string | null>(null);
  const leaving = useRef(false);
  // tick перерисовывает кружки за шагом раскладки, kick будит раскладку, когда тронули кружок.
  const [tick, setTick] = useState(0);
  const [kick, setKick] = useState(0);

  /** В граф: кружки стартуют с мест карточек и расходятся, центр раскладки - середина карточек. */
  const enter = useCallback(() => {
    const cards = layout.current?.cards ?? [];
    bodies.current = new Map(cards.map((card) => [card.id, { ...centerOf(card), vx: 0, vy: 0 }]));
    const n = cards.length || 1;
    center.current = {
      x: cards.reduce((sum, card) => sum + centerOf(card).x, 0) / n,
      y: cards.reduce((sum, card) => sum + centerOf(card).y, 0) / n,
    };
    leaving.current = false;
    window.dispatchEvent(new Event(CANVAS_MOVE));
    setGraph(true);
    setKick((k) => k + 1);
    window.setTimeout(() => void flow.fitView({ padding: 0.3, duration: still() ? 0 : 600 }), still() ? 50 : 1400);
  }, [layout, flow]);

  /** Из графа: кружки съезжаются на места своих карточек, потом возвращаются карточки. focus - камера
   *  летит к этой карточке, иначе вписывает всё полотно. */
  const leave = useCallback(
    (focus?: string) => {
      const cards = new Map((layout.current?.cards ?? []).map((card) => [card.id, card]));
      const from = new Map([...bodies.current].map(([id, body]) => [id, { x: body.x, y: body.y }]));
      const duration = still() ? 0 : 500;
      const done = () => {
        setGraph(false);
        held.current = null;
        const card = focus ? cards.get(focus) : undefined;
        const at = card && centerOf(card);
        window.setTimeout(
          () => (at ? flyCenter(flow, at.x, at.y, 1, duration) : void flow.fitView({ padding: 0.08, duration })),
          30,
        );
      };
      leaving.current = true;
      if (still()) return done();
      const began = performance.now();
      const tween = (now: number) => {
        const k = Math.min(1, (now - began) / 380);
        const e = 1 - (1 - k) ** 3;
        for (const [id, body] of bodies.current) {
          const a = from.get(id);
          const card = cards.get(id);
          if (!a || !card) continue;
          const b = centerOf(card);
          body.x = a.x + (b.x - a.x) * e;
          body.y = a.y + (b.y - a.y) * e;
        }
        setTick((t) => t + 1);
        if (k < 1) requestAnimationFrame(tween);
        else done();
      };
      requestAnimationFrame(tween);
    },
    [layout, flow],
  );

  // Раскладка идёт по кадру, пока кружки не успокоятся; тронули кружок - снова.
  useEffect(() => {
    if (!graph) return;
    const links = () => layout.current?.edges ?? [];
    if (still()) {
      for (let i = 0; i < 400; i++) settle(bodies.current, links(), center.current, held.current);
      setTick((t) => t + 1);
      return;
    }
    let frame = 0;
    let calm = 0;
    const step = () => {
      if (leaving.current) return;
      const fastest = settle(bodies.current, links(), center.current, held.current);
      setTick((t) => t + 1);
      calm = fastest < 0.05 ? calm + 1 : 0;
      if (calm < 20) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [graph, kick, layout]);

  /** В графе тянут кружок: карточка остаётся на своём месте, двигается тело раскладки. */
  const drag = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position") continue;
        const body = bodies.current.get(change.id);
        const card = layout.current?.cards.find((one) => one.id === change.id);
        if (body && card && change.position) {
          body.x = change.position.x + dotOf(card) / 2;
          body.y = change.position.y + dotOf(card) / 2;
        }
        held.current = change.dragging ? change.id : null;
      }
      setKick((k) => k + 1);
    },
    [layout],
  );

  return { graph, tick, bodies: bodies.current, enter, leave, drag };
}
