// Проверка раскладки графа на обычных assert: node src/shared/graph.check.ts
import assert from "node:assert/strict";
import { settle, type Body } from "./graph.ts";

const body = (x: number, y: number): Body => ({ x, y, vx: 0, vy: 0 });
const gap = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.y - b.y);

// Связанные кружки сходятся к длине пружины, а третий, без связей, отходит от них дальше.
{
  const bodies = new Map([
    ["a", body(0, 0)],
    ["b", body(600, 0)],
    ["c", body(10, 10)],
  ]);
  let fastest = Infinity;
  for (let i = 0; i < 800 && fastest > 0.05; i++) fastest = settle(bodies, [{ from: "a", to: "b" }], { x: 0, y: 0 }, null);
  assert.ok(fastest <= 0.05, `граф не успокоился: ${fastest}`);
  const [a, b, c] = ["a", "b", "c"].map((id) => bodies.get(id)!);
  assert.ok(gap(a, b) < 300, `связь не стянула кружки: ${gap(a, b)}`);
  assert.ok(gap(a, c) > 40 && gap(b, c) > 40, "кружки легли друг на друга");
}

// Кружок под рукой стоит, остальные двигаются.
{
  const bodies = new Map([
    ["held", body(0, 0)],
    ["free", body(5, 0)],
  ]);
  settle(bodies, [], { x: 0, y: 0 }, "held");
  assert.deepEqual([bodies.get("held")!.x, bodies.get("held")!.y], [0, 0]);
  assert.ok(bodies.get("free")!.x > 5, "свободный кружок не оттолкнулся");
}

console.log("graph: все проверки пройдены");
