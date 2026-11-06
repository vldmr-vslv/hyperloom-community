// Проверка чтения размеченного потока: node src/main/command-runs.check.ts
import assert from "node:assert/strict";
import { createRunReader, type CommandRun } from "./command-runs.ts";

/** Маркеры так же, как их печатает оболочка: OSC 133 с BEL на конце. */
const done = (code: number, command: string) => `\u001b]133;D;${code};${command}\u0007`;
const started = "\u001b]133;C\u0007";

// Команда завершилась: читатель отдаёт её строку, код возврата и вывод без управляющих
// последовательностей. Первое приглашение команды за собой не оставляет - его не считаем.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));

  read("PS C:\\projects> ");
  read(done(0, ""));
  assert.deepEqual(runs, [], "приглашение до первой команды сошло за команду");

  read(started);
  read("npm ERR! \u001b[31mупало\u001b[0m\r\n");
  read(done(1, "npm test"));
  assert.deepEqual(runs, [{ command: "npm test", code: 1, output: "npm ERR! упало" }]);

  // Удачная команда доходит тем же путём: что с ней делать, решает не читатель.
  read(started);
  read("ok\r\n");
  read(done(0, "node -v"));
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[1], { command: "node -v", code: 0, output: "ok" });
}

// Маркер разорван между кусками потока: PTY отдаёт что успел, а не по границам команд.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));

  read("\u001b]13");
  read("3;C\u0007сначала");
  read("-потом\u001b]133;D;7;node ");
  read("собрать.js\u0007");
  assert.deepEqual(runs, [{ command: "node собрать.js", code: 7, output: "сначала-потом" }]);
  // Обрывок маркера не должен просочиться в вывод.
  assert.ok(!runs[0].output.includes("133"), `в выводе остался маркер: ${runs[0].output}`);
}

// Чужая последовательность вроде заголовка окна в вывод не попадает и разбора не ломает.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));
  read(started);
  read("\u001b]0;C:\\projects\u0007вывод\r\n");
  read(done(1, "false"));
  assert.deepEqual(runs, [{ command: "false", code: 1, output: "вывод" }]);
}

// Заголовок окна с концом ESC \ вместо BEL: так его шлёт conpty из node-pty, и обратная косая
// оставалась хвостом вывода.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));
  read(started);
  read("вывод\r\n\u001b]0;C:\\WINDOWS\\powershell.exe\u001b\\");
  read(done(3, "node x.js"));
  assert.deepEqual(runs, [{ command: "node x.js", code: 3, output: "вывод" }]);
}

// Вывод длиннее потолка: агенту уезжает хвост, где обычно и стоит ошибка, а не всё подряд.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));
  read(started);
  read("шум\r\n".repeat(4000));
  read("последняя строка\r\n");
  read(done(1, "npm run build"));
  const { output } = runs[0];
  assert.ok(output.length < 6000, `вывод не обрезан: ${output.length}`);
  assert.ok(output.endsWith("последняя строка"), "обрезали хвост вместо начала");
  assert.match(output, /^\[/, "об обрезке не сказано в первой строке");
}

// Идёт ли команда: да с начала вывода, нет с нового приглашения - и после удачной команды, и после
// пустого Enter, у которого команды нет.
{
  const busy: boolean[] = [];
  const read = createRunReader(() => {}, (value) => busy.push(value));
  read("PS C:\\projects> ");
  read(done(0, ""));
  read(started);
  read("ok\r\n\u001b]13");
  read(`3;D;0;node -v\u0007`);
  assert.deepEqual(busy, [false, true, false]);
}

// Секрет, разрезанный границей среза вывода, не уходит хвостом значения: скрытие идёт до среза.
// Длина после скрытия не растёт: короткие значения не раздувают вывод сверх потолка 4000 знаков.
{
  const runs: CommandRun[] = [];
  const read = createRunReader((run) => runs.push(run));
  read(started);
  read("API_TOKEN=" + "s3cretVALUE".repeat(20) + "\r\n" + "y".repeat(3900) + "\r\n");
  read(done(0, "env"));
  assert.ok(!runs[0].output.includes("VALUE"), "хвост секрета уехал в вывод");

  read(started);
  read("KEY=a\r\n".repeat(1000));
  read(done(0, "many"));
  const body = runs[1].output.replace(/^\[[^\]]*\]\n/, "");
  assert.ok(body.length <= 4000, `вывод после скрытия длиннее 4000: ${body.length}`);
}

console.log("command-runs: все проверки пройдены");
