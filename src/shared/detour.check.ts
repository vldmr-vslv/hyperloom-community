// Проверка обхода карточек на обычных assert: node src/shared/detour.check.ts
import assert from "node:assert/strict";
import { passes, routeLinks, type Box } from "./detour.ts";
import { bezier, type Route } from "./route.ts";

/** Точки пути внутри прямоугольника, кроме первых и последних 30 px: там связь выходит из своей
 *  карточки и входит в чужую. */
function inside(route: Route, box: Box): number {
  return route.samples.filter(
    (p) => p.s > 30 && p.s < route.length - 30 && p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h,
  ).length;
}

const source: Box = { x: 0, y: 0, w: 200, h: 200 };
const target: Box = { x: 600, y: 0, w: 200, h: 200 };
const from = { x: 200, y: 18 };
const to = { x: 600, y: 18 };

// Между карточками пусто - связь остаётся прямой кривой от порта к порту.
{
  const routes = routeLinks([source, target], [{ id: "a", from, to }], new Map());
  assert.deepEqual(routes.get("a")!.points, bezier(from, to).points);
}

// Карточка на пути - связь её обходит, концы на месте.
{
  const wall: Box = { x: 320, y: -100, w: 160, h: 260 };
  const route = routeLinks([source, target, wall], [{ id: "a", from, to }], new Map()).get("a")!;
  assert.equal(inside(route, wall), 0, "связь прошла под карточкой");
  assert.deepEqual(route.points[0], from);
  assert.deepEqual(route.points.at(-1), to);
}

// Цель левее источника - обход снаружи, а не петля под своими карточками.
{
  const left: Box = { x: 0, y: 400, w: 200, h: 200 };
  const right: Box = { x: 300, y: 0, w: 200, h: 200 };
  const route = routeLinks([left, right], [{ id: "a", from: { x: 500, y: 18 }, to: { x: 0, y: 418 } }], new Map()).get("a")!;
  assert.equal(inside(route, left) + inside(route, right), 0, "петля ушла под карточку");
}

// Проложенная связь из keep не перекладывается, а новая идёт рядом с ней, не по ней.
{
  const kept = bezier(from, to);
  const routes = routeLinks([source, target], [{ id: "b", from: { x: 200, y: 30 }, to: { x: 600, y: 30 } }], new Map([["a", kept]]));
  assert.equal(routes.get("a"), kept);
  assert.ok(routes.has("b"));
}

// Путь через прямоугольник с зазором - надо перекладывать; мимо - нет.
{
  const route = bezier(from, to);
  assert.ok(passes(route, { x: 380, y: 0, w: 40, h: 40 }));
  assert.ok(!passes(route, { x: 380, y: 300, w: 40, h: 40 }));
}

console.log("detour: все проверки пройдены");
