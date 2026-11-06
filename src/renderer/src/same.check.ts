// Проверка same: узел полотна, равный прежнему по содержимому, равен; сменившееся место, функция или Map - нет.
import assert from "node:assert/strict";
import { same } from "./same.ts";

const fn = () => 0;
const map = new Map([["a", 1]]);
const node = (x: number, extra: object = {}) => ({
  id: "c",
  position: { x, y: 2 },
  style: { "--pc": "#fff" },
  data: { path: "p", onHover: fn, traces: map, ring: { at: { x: 1, y: 1 }, kids: [{ id: "k", at: { x: 3, y: 4 } }] }, ...extra },
});

assert.equal(same(node(1), node(1)), true, "тот же узел, собранный заново");
assert.equal(same(node(1), node(2)), false, "сдвинулось место");
assert.equal(same(node(1), node(1, { onHover: () => 0 })), false, "новая функция");
assert.equal(same(node(1), node(1, { traces: new Map(map) })), false, "Map по ссылке");
assert.equal(same(node(1), node(1, { ring: { at: { x: 1, y: 1 }, kids: [{ id: "k", at: { x: 3, y: 5 } }] } })), false, "сдвинулся сосед кольца");
assert.equal(same(node(1), node(1, { extra: undefined })), false, "лишнее поле");
assert.equal(same([1, 2], [1, 2, 3]), false, "длина массива");
assert.equal(same(NaN, NaN), false, "NaN не равен");
console.log("same: все проверки пройдены");
