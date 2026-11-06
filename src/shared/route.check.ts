// Проверка геометрии связей на обычных assert: node src/shared/route.check.ts
import assert from "node:assert/strict";
import { bezier, midpoint, sample, STEP, tipped } from "./route.ts";

const near = (a: number, b: number, what: string, within = 0.5) =>
  assert.ok(Math.abs(a - b) < within, `${what}: ${a} против ${b}`);

// Выборка прямой: шаг STEP, длина верная, нормаль перпендикулярна пути.
{
  const { samples, length } = sample([
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ]);
  assert.equal(length, 40);
  assert.equal(samples.length, 40 / STEP + 1);
  assert.deepEqual([samples[1].nx, samples[1].ny], [-0, 1]);
}

// Кривая от порта к порту выходит вправо, входит слева, концы на месте; середина - на полпути.
{
  const route = bezier({ x: 0, y: 0 }, { x: 300, y: 120 });
  const [a, b] = [route.points[0], route.points.at(-1)!];
  assert.deepEqual(a, { x: 0, y: 0 });
  near(b.x, 300, "конец x");
  near(b.y, 120, "конец y");
  assert.ok(route.points[1].x > 0 && Math.abs(route.points[1].y) < 1, "выход не вправо");
  const mid = midpoint(route);
  // Середина берётся из выборки: точность - полшага выборки вдоль пути.
  near(mid.x, 150, "середина x", STEP / 2);
  near(mid.y, 60, "середина y", STEP / 2);
  // Конец левее начала - петля, а не прямой отрезок назад.
  const back = bezier({ x: 300, y: 0 }, { x: 0, y: 200 });
  assert.ok(back.points[4].x > 300, "петля не вышла вправо");
}

// Жгут из носика: начинается в reach правее кромки на той же высоте, выходит горизонтально,
// кончается в reach левее кромки цели - даже когда путь у кромки идёт круто вверх.
{
  const route = bezier({ x: 0, y: 0 }, { x: 60, y: -400 });
  const { samples } = tipped(route, 26);
  const [first, second, last] = [samples[0], samples[1], samples.at(-1)!];
  near(first.x, 26, "начало жгута x");
  near(first.y, 0, "начало жгута y");
  assert.ok(Math.abs(second.y - first.y) < 1, "жгут выходит не по оси раструба");
  near(last.x, 34, "конец жгута x");
  near(last.y, -400, "конец жгута y");
}

console.log("route: все проверки пройдены");
