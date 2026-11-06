// Ожидание в проверках (*.check.ts), которые ждут живой процесс: опрос условия до срока.
import assert from "node:assert/strict";

/** Ждать, пока test() не станет правдой. Срок вышел - проверка падает с тем, что вернёт what(). */
export async function waitUntil(
  test: () => boolean | Promise<boolean>,
  ms: number,
  what: () => string,
  step = 50,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() >= deadline) assert.fail(what());
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}
