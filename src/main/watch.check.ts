// Проверка слежения за папкой на реальном диске: node src/main/watch.check.ts
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchFolder } from "./watch.ts";

/** Уведомления с диска ждём не дольше этого: слежение обещает отклик, а не мгновенный отклик. */
const WAIT_MS = 3000;

/** Пауза, за которую хвосты прошлых событий успевают осесть, а слежение - выдать уведомление. */
const SETTLE_MS = 500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Считает уведомления и умеет дождаться нужного их числа. */
function counter() {
  let count = 0;
  let wake: (() => void) | null = null;
  return {
    get count(): number {
      return count;
    },
    onChange: (): void => {
      count += 1;
      wake?.();
    },
    reset: (): void => {
      count = 0;
    },
    async until(target: number, what: string): Promise<void> {
      const deadline = Date.now() + WAIT_MS;
      while (count < target) {
        if (Date.now() >= deadline) {
          assert.fail(`не дождались: ${what} (уведомлений ${count}, ждали ${target})`);
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 50);
        });
      }
      wake = null;
    },
  };
}

type Counter = ReturnType<typeof counter>;

/**
 * Одно изменение на диске - одно ожидаемое уведомление. Счётчик сбрасывается перед действием,
 * иначе шаг зачтётся по хвостам предыдущего: тогда проверка ничего не проверяет.
 */
async function change(seen: Counter, what: string, act: () => Promise<unknown>): Promise<void> {
  await wait(SETTLE_MS);
  seen.reset();
  await act();
  await seen.until(1, what);
}

/** Общая папка прогона: чистится на старте, поэтому упавший прогон не копит мусор в Temp. */
const ROOT = join(tmpdir(), "hyperloom-watch");
await rm(ROOT, { recursive: true, force: true });
await mkdir(ROOT);
let made = 0;

/** Своя папка на каждую проверку: чужие файлы в ней не мешают считать уведомления. */
async function tempFolder(): Promise<string> {
  const dir = join(ROOT, String((made += 1)));
  await mkdir(dir);
  return dir;
}

// Файл, созданный и удалённый снаружи, доходит уведомлением.
{
  const dir = await tempFolder();
  const file = join(dir, "снаружи.txt");
  const seen = counter();
  const stop = watchFolder(dir, seen.onChange);

  await change(seen, "файл создан снаружи", () => writeFile(file, ""));
  await change(seen, "файл удалён снаружи", () => rm(file));

  stop();
  await rm(dir, { recursive: true, force: true });
}

// Папку удалили с диска: уведомление приходит, и на этом всё - лавины уведомлений нет.
{
  const parent = await tempFolder();
  const dir = join(parent, "проект");
  await mkdir(dir);
  const seen = counter();
  const stop = watchFolder(dir, seen.onChange);

  await change(seen, "папка удалена с диска", () => rm(dir, { recursive: true, force: true }));

  // Windows на удалённой папке сыплет событиями без конца; они не должны доходить наружу.
  seen.reset();
  await wait(SETTLE_MS);
  assert.ok(seen.count <= 1, `после удаления папки лавина уведомлений: ${seen.count}`);

  stop();
  await rm(parent, { recursive: true, force: true });
}

// Папка вернулась на место: уведомление приходит, и слежение внутри неё снова работает.
{
  const parent = await tempFolder();
  const dir = join(parent, "проект");
  await mkdir(dir);
  const seen = counter();
  const stop = watchFolder(dir, seen.onChange);

  await change(seen, "папка удалена с диска", () => rm(dir, { recursive: true, force: true }));
  await change(seen, "папка вернулась на место", () => mkdir(dir));
  await change(seen, "файл в вернувшейся папке", () => writeFile(join(dir, "после.txt"), ""));

  stop();
  await rm(parent, { recursive: true, force: true });
}

// Массовая операция: сотни файлов подряд сходятся в одно уведомление, а не в сотни.
{
  const dir = await tempFolder();
  const seen = counter();
  const stop = watchFolder(dir, seen.onChange);

  await wait(SETTLE_MS);
  seen.reset();
  for (let i = 0; i < 300; i += 1) await writeFile(join(dir, `файл-${i}.txt`), "");
  await seen.until(1, "массовая запись в папку");
  await wait(SETTLE_MS);
  assert.ok(seen.count <= 3, `массовая операция дала уведомлений: ${seen.count}`);

  stop();
  await rm(dir, { recursive: true, force: true });
}

// Слежение за файлом: правка самого файла доходит, а сосед по папке уведомления не даёт.
// Иначе карточка файла уводила бы агенту содержимое, которое никто не менял.
{
  const dir = await tempFolder();
  const file = join(dir, "свой.txt");
  await writeFile(file, "было\n");
  const seen = counter();
  const stop = watchFolder(file, seen.onChange);

  await change(seen, "сам файл изменился", () => writeFile(file, "стало\n"));

  await wait(SETTLE_MS);
  seen.reset();
  await writeFile(join(dir, "чужой.txt"), "");
  await wait(SETTLE_MS);
  assert.equal(seen.count, 0, "сосед по папке разбудил слежение за файлом");

  stop();
  await rm(dir, { recursive: true, force: true });
}

// Слежение прекращено: изменения на диске больше не доходят.
{
  const dir = await tempFolder();
  const seen = counter();
  const stop = watchFolder(dir, seen.onChange);

  await change(seen, "файл создан снаружи", () => writeFile(join(dir, "до.txt"), ""));

  await wait(SETTLE_MS);
  stop();
  seen.reset();
  await writeFile(join(dir, "после.txt"), "");
  await wait(SETTLE_MS);
  assert.equal(seen.count, 0, "после остановки уведомления продолжают приходить");

  await rm(dir, { recursive: true, force: true });
}

await rm(ROOT, { recursive: true, force: true });
console.log("watch: все проверки пройдены");
