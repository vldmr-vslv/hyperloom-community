// Пути связей полотна: где у связи концы и как она обходит карточки. Пока карточку тянут, перекладываются
// только связи, которых это касается; полотно замерло - слой связей перекладывает все заново, чтобы
// они разошлись по коридорам (LinkCanvas.tsx).
import { ROOT_CARD_ID, type Card, type Layout } from "../../shared/canvas-model.ts";
import { direct, passes, routeLinks, type Box, type Want } from "../../shared/detour.ts";
import type { Pt, Route } from "../../shared/route.ts";
import { centerOf, isRing, rectPort, rimPort, type Port } from "./rings.ts";

/** Высота шапки карточки: из её середины выходят и в неё входят связи. */
export const HEAD = 18;
/** Высота свёрнутой карточки: одна шапка. */
export const FOLDED_HEIGHT = 36;
/** Ручная стрелка входит в цель ниже шапки: в шапку входит жгут агента, и конец стрелки лёг бы
 *  в его раструб. Раструб доходит до 46 px от верха карточки. */

export function heightOf(card: Card): number {
  return card.collapsed ? FOLDED_HEIGHT : card.size.height;
}

/** Пропорция картинки на продолжении заднего слоя корня (ширина к высоте). Та же пропорция задаёт
 *  ширину продолжения в CSS: карточка корня отдаёт её переменной --art-ratio. */
export const ROOT_ART_RATIO = 820 / 729;
/** Сколько продолжения прячется под самой карточкой: ширина скругления её угла. */
const ROOT_ART_TUCK = 18;


/**
 * Прямоугольник карточки, который обходят связи. У развёрнутого корня в него входит и продолжение
 * заднего слоя влево с картинкой: иначе связи шли бы по ней. На круглом полотне (rings) кольцо - круг.
 * below - панель ДЕЙСТВИЯ под карточкой агента: для связей это та же плита.
 */
export function boxOf(card: Card, rings = false, below = 0): Box {
  if (rings && isRing(card)) return { x: card.position.x, y: card.position.y, w: card.size.width, h: card.size.height, round: true };
  const h = heightOf(card) + below;
  const art = card.id === ROOT_CARD_ID && !card.collapsed ? h * ROOT_ART_RATIO - ROOT_ART_TUCK : 0;
  return { x: card.position.x - art, y: card.position.y, w: card.size.width + art, h };
}

/** Концы связи: из правого края начала - из строки открытой записи или из шапки - в левый край конца. */
function endsOf(a: Card, b: Card, portY: number | undefined): { from: Pt; to: Pt } {
  const out = !a.collapsed && portY !== undefined ? portY : HEAD;
  const into = HEAD;
  return {
    from: { x: a.position.x + a.size.width, y: a.position.y + out },
    to: { x: b.position.x, y: b.position.y + into },
  };
}

/** Концы связи на круглом полотне: кольцо отдаёт точку обода в сторону другого конца, карточка - сторону,
 *  обращённую к нему. Сперва ставится начало (к середине конца), потом конец - к точке начала. */
export function ringEnds(a: Card, b: Card): { from: Pt; to: Pt; nf: Pt; nt: Pt } {
  const port = (card: Card, toward: Pt): Port =>
    isRing(card) ? rimPort(card, toward) : rectPort(card, toward, heightOf(card));
  const from = port(a, centerOf(b));
  const to = port(b, from);
  return { from, to, nf: { x: from.nx, y: from.ny }, nt: { x: to.nx, y: to.ny } };
}

/** Всё, что обходят связи: карточки с панелью ДЕЙСТВИЯ и спутники агентов, по ключу (у спутников - карточка и номер). */
export function obstacles(layout: Layout, rings: boolean): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const card of layout.cards) {
    out.set(card.id, boxOf(card, rings));
  }
  return out;
}

/** Проложенные связи и то, по чему они прокладывались: по этому видно, что устарело. */
export type Laid = { routes: Map<string, Route>; ends: Map<string, string>; boxes: Map<string, Box> };

const endKey = (w: Want) => `${w.from.x},${w.from.y},${w.to.x},${w.to.y},${w.nf?.x},${w.nf?.y},${w.nt?.x},${w.nt?.y}`;
const sameBox = (a: Box | undefined, b: Box) =>
  a !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.round === b.round;

/**
 * Пути всех связей раскладки. prev - прошлая прокладка: связи, у которых концы на месте и путь не
 * задевает сдвинутую карточку, берутся из неё как есть. partial - проложено не всё заново: когда полотно
 * замрёт, прокладку стоит повторить целиком (prev = null). rings - круглое полотно: концы на ободах колец и
  * сторонах карточек, строки списков портов не дают.
 */
export function layLinks(
  layout: Layout,
  ports: ReadonlyMap<string, ReadonlyMap<string, number>>,
  portKey: (path: string) => string,
  prev: Laid | null,
  rings = false,
): { laid: Laid; partial: boolean } {
  const cards = new Map(layout.cards.map((card) => [card.id, card]));
  const boxes = obstacles(layout, rings);
  const wants: Want[] = [];
  for (const edge of layout.edges) {
    const a = cards.get(edge.from);
    const b = cards.get(edge.to);
    if (!a || !b) continue;
    if (rings) {
      wants.push({ id: edge.id, ...ringEnds(a, b) });
      continue;
    }
    const portY = ports.get(a.id)?.get(portKey(b.path));
    wants.push({ id: edge.id, ...endsOf(a, b, portY) });
  }
  const ends = new Map(wants.map((w) => [w.id, endKey(w)]));
  if (!prev) return { laid: { routes: routeLinks([...boxes.values()], wants, new Map()), ends, boxes }, partial: false };
  const moved = [...boxes].filter(([id, box]) => !sameBox(prev.boxes.get(id), box)).map(([, box]) => box);
  const keep = new Map<string, Route>();
  const want: Want[] = [];
  for (const w of wants) {
    const route = prev.routes.get(w.id);
    if (route && prev.ends.get(w.id) === ends.get(w.id) && !moved.some((box) => passes(route, box))) keep.set(w.id, route);
    else want.push(w);
  }
  const partial = want.length > 0 || moved.length > 0 || keep.size !== prev.routes.size || boxes.size !== prev.boxes.size;
  // Круглое полотно в движении (тянут рукой, работают силы): задетые связи - прямыми кривыми, как в прототипе. Обход
  // по сетке на каждом кадре перескакивал между коридорами, и связи дёргались; полотно замрёт - обход проложится целиком.
  if (rings && moved.length > 0) {
    for (const w of want) keep.set(w.id, direct(w));
    return { laid: { routes: keep, ends, boxes }, partial: true };
  }
  // Ничего не сдвинулось - сетку не строим вовсе: окно перерисовывается и без движения карточек.
  const routes = want.length > 0 ? routeLinks([...boxes.values()], want, keep) : keep;
  return { laid: { routes, ends, boxes }, partial };
}
