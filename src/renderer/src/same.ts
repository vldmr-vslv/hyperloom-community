/**
 * Равны ли два значения по содержимому: простые объекты и массивы сравниваются поэлементно на глубину depth, остальное
 * (функции, Map, Set, экземпляры классов) - по ссылке. Узлы полотна собираются заново на каждое изменение раскладки, и
 * узел, равный прежнему, отдаётся прежним объектом: React Flow тогда не перерисовывает карточку. Функция по ссылке, а
 * не "считать равными": иначе карточка осталась бы со старым замыканием.
 */
export function same(a: unknown, b: unknown, depth = 6): boolean {
  if (a === b) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], depth - 1)) return false;
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const one = a as Record<string, unknown>;
  const two = b as Record<string, unknown>;
  const keys = Object.keys(one);
  if (keys.length !== Object.keys(two).length) return false;
  for (const key of keys) if (!(key in two) || !same(one[key], two[key], depth - 1)) return false;
  return true;
}
