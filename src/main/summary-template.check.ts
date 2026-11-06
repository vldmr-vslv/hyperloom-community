// Проверка логики шаблона сводки тикета на обычных assert: node src/main/summary-template.check.ts
// Скрипт страницы гоняется в пустом контексте node:vm: без document он только объявляет функции.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../../resources/summary/summary.html", import.meta.url), "utf8");
// Комментарий шаблона сам упоминает блок данных - блоки ищутся без комментариев, как их видит браузер.
const markup = html.replace(/<!--[\s\S]*?-->/g, "");
const block = (id: string): string => {
  const match = markup.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  assert.ok(match, `в шаблоне нет блока ${id}`);
  return match[1];
};

type Draft = { flip: number[]; pick: Array<number | null>; own: string[]; commit: boolean; msg: string | null; step: number; sent: boolean };
type Parsed = { data?: any; errors?: string[] };
const page = runInNewContext(
  `${block("summary-logic")}\n;({ parseSummary, counts, initialTab, quizSteps, emptyDraft, readDraft, draftKey, answered, canSend, answerText })`,
  {},
) as {
  parseSummary(text: string): Parsed;
  counts(data: unknown): Record<string, number>;
  initialTab(data: unknown): string;
  quizSteps(data: unknown): Array<{ key: string; index: number }>;
  emptyDraft(): Draft;
  readDraft(stored: string | null): Draft;
  draftKey(pathname: string, text: string): string;
  answered(draft: Draft, index: number): boolean;
  canSend(data: unknown, draft: Draft): boolean;
  answerText(data: unknown, draft: Draft): string;
};
// Объекты из чужого контекста не равны своим по deepEqual: прототипы разные. Сравнение - через JSON.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const fresh = (patch: Partial<Draft> = {}): Draft => ({ ...page.emptyDraft(), ...patch });

// Образец в шаблоне - golosotka issue #2 - разбирается: агент, скопировавший шаблон как есть, получит рабочую страницу.
const sample = block("summary-data");
const { data, errors } = page.parseSummary(sample);
assert.equal(errors, undefined, `образец не разобрался: ${errors}`);
assert.equal(data.project, "golosotka");
assert.equal(data.scratch, "golosotka");
assert.deepEqual(plain(page.counts(data)), { pass: 5, skip: 1, fail: 0, fixed: 1, left: 1, questions: 7 });
assert.equal(data.questions[0].id, "S3");
assert.equal(data.questions[0].proposal, 0, "у S3 агент предлагает вариант а");
// Тег блока данных и ключи данных встречаются в файле по разу: агент, правящий первое вхождение, попадает
// в данные, а не в пример схемы в комментарии.
for (const marker of ['id="summary-data"', '"project":', '"ticket":', '"checks":', '"findings":', '"questions":', '"commit":']) {
  assert.equal(html.split(marker).length - 1, 1, `в шаблоне не одно вхождение ${marker}`);
}
// Схема в комментарии описывает варианты и предложение номером.
assert.match(html, /options: \["вариант а", "вариант б"\]/);
assert.match(html, /proposal: 0 +необязательно: номер варианта с 0/);
// Во всём шаблоне ни одного внешнего адреса: страница не просит ничего, кроме себя.
assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:|\/\/)|@import|url\(/i);
// Бесконечная анимация одна: пульс готовой кнопки отправки.
assert.deepEqual(html.match(/[.\w-]+ \{[^}]*infinite[^}]*\}/g), [".primary.ready { animation: pulse 1.8s ease-in-out infinite; }"]);
assert.match(html, /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/);

// Битые данные называют поле, а не падают.
const broken = (value: unknown): unknown => plain(page.parseSummary(JSON.stringify(value)).errors ?? []);
assert.match(page.parseSummary("{ нет").errors![0], /JSON/);
assert.deepEqual(broken([]), ["данные - не объект"]);
const ok = { project: "p", ticket: { number: 7, title: "Т" }, checks: [], findings: [], questions: [] };
assert.deepEqual(broken(ok), []);
const okData = page.parseSummary(JSON.stringify(ok)).data;
assert.equal(okData.ticket.number, "7");
assert.equal(okData.scratch, undefined, "скретч необязателен");
assert.deepEqual(broken({ ...ok, project: "", scratch: 3 }), ["project: нужна строка", "scratch: нужна строка"]);
assert.deepEqual(broken({ ...ok, ticket: { title: "Т" } }), ["ticket.number: нужна строка или число"]);
assert.deepEqual(broken({ ticket: {}, checks: {}, findings: {}, questions: null }), [
  "project: нужна строка",
  "ticket.number: нужна строка или число",
  "ticket.title: нужна строка",
  "checks: нужен массив",
  "findings: нужен массив",
  "questions: нужен массив",
]);
// Проверки: вердикт из трёх, свойство прототипа вердиктом не считается.
const check = { what: "тесты", verdict: "pass", evidence: "ok" };
assert.deepEqual(broken({ ...ok, checks: [check, { ...check, verdict: "skip" }, { ...check, verdict: "fail" }] }), []);
assert.deepEqual(broken({ ...ok, checks: [{ ...check, verdict: "toString" }, { ...check, verdict: "PASS", evidence: "" }, "x"] }), [
  "checks[0].verdict: нужно pass, fail или skip",
  "checks[1].verdict: нужно pass, fail или skip",
  "checks[1].evidence: нужна строка",
  "checks[2]: нужен объект",
]);
assert.deepEqual(broken({ ...ok, note: 3 }), ["note: нужна строка"]);
// Находки: tier вместо прежней severity.
const finding = { id: "S1", tier: "lock", text: "т", outcome: "fixed" };
assert.deepEqual(broken({ ...ok, findings: [finding, { ...finding, tier: "hard" }, { ...finding, tier: "purpose" }] }), []);
assert.deepEqual(broken({ ...ok, findings: [{ ...finding, tier: "toString" }] }), ["findings[0].tier: нужно hard, purpose или lock"]);
assert.deepEqual(broken({ ...ok, findings: [{ id: "S1", severity: "high", text: "т", outcome: "fixed" }] }), [
  "findings[0].severity: поля больше нет, тяжесть - tier",
  "findings[0].tier: нужно hard, purpose или lock",
]);
assert.deepEqual(broken({ ...ok, findings: [{ ...finding, id: undefined, outcome: "left" }] }), [
  "findings[0].id: нужна строка",
  "findings[0].reason: нужна строка",
]);
assert.deepEqual(broken({ ...ok, findings: [{ ...finding, line: 0, file: 3 }] }), ["findings[0].file: нужна строка", "findings[0].line: нужно целое от 1"]);
// Вопросы: варианты списком, предложение номером варианта; без вариантов предложение - текст.
const question = { id: "S3", text: "в", options: ["а", "б"] };
assert.deepEqual(broken({ ...ok, questions: [question, { ...question, proposal: 1, tier: "hard" }, { id: "Q", text: "в", proposal: "текстом" }] }), []);
assert.deepEqual(broken({ ...ok, questions: [{ ...question, proposal: 2 }, { ...question, proposal: -1 }, { ...question, proposal: 0.5 }] }), [
  "questions[0].proposal: нет варианта с номером 2",
  "questions[1].proposal: нет варианта с номером -1",
  "questions[2].proposal: нет варианта с номером 0.5",
]);
assert.deepEqual(broken({ ...ok, questions: [{ ...question, proposal: "а" }] }), ["questions[0].proposal: у вопроса с options нужен номер варианта с 0"]);
assert.deepEqual(broken({ ...ok, questions: [{ ...question, options: ["одна"] }, { ...question, options: ["а", ""] }, { ...question, tier: "high" }] }), [
  "questions[0].options: нужно от 2 до 10 строк",
  "questions[1].options: нужно от 2 до 10 строк",
  "questions[2].tier: нужно hard, purpose или lock",
]);
assert.deepEqual(broken({ ...ok, questions: ["строкой", { text: "без id", proposal: 3 }] }), [
  "questions[0]: нужен объект",
  "questions[1].id: нужна строка",
  "questions[1].proposal: нужна строка",
]);
// Коммит необязателен, но если есть - с сообщением.
assert.deepEqual(broken({ ...ok, commit: { message: "feat: x" } }), []);
assert.deepEqual(broken({ ...ok, commit: { command: "git commit" } }), ["commit.message: нужна строка"]);
assert.deepEqual(broken({ ...ok, commit: "git commit" }), ["commit: нужен объект"]);

// Начальная вкладка: есть вопросы - Ревью, нет - Проверка.
assert.equal(page.initialTab(data), "review");
assert.equal(page.initialTab(okData), "check");

// Квиз - только вопросы: ни находок, ни коммита в шагах.
assert.deepEqual(plain(page.quizSteps(data).map((step) => step.key)), ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
assert.deepEqual(plain(page.quizSteps(okData)), [], "без вопросов квиза нет");

// Черновик: битое и чужое значение хранилища - пустой черновик; коммит по умолчанию - закоммитить.
const empty = { flip: [], pick: [], own: [], commit: true, msg: null, step: 0, sent: false };
assert.deepEqual(plain(page.readDraft(null)), empty);
assert.deepEqual(plain(page.readDraft("{ нет")), empty);
assert.deepEqual(plain(page.readDraft('{"marked":[2],"answers":["да"]}')), empty, "черновик прежней страницы не читается");
assert.deepEqual(plain(page.readDraft('{"flip":[1,"x",-1],"pick":[0,null,"а",-2],"own":["сам",5],"commit":false,"msg":"fix: y","step":3,"sent":true}')), {
  flip: [1],
  pick: [0, null, null, null],
  own: ["сам", ""],
  commit: false,
  msg: "fix: y",
  step: 3,
  sent: true,
});
// Правка сообщения коммита живёт в черновике: записанный и прочитанный черновик тот же.
const edited = fresh({ msg: "feat: свой текст", pick: [1] });
assert.deepEqual(plain(page.readDraft(JSON.stringify(edited))), plain(edited));

// Ключ: та же страница и те же данные - тот же ключ; другие данные или другая страница - другой.
const key = page.draftKey("/13.summary.html", sample);
assert.equal(page.draftKey("/13.summary.html", sample), key);
assert.notEqual(page.draftKey("/13.summary.html", sample + " "), key);
assert.notEqual(page.draftKey("/14.summary.html", sample), key);

// Ответ на вопрос - выбранный вариант или свой текст; пробелы - не ответ.
assert.equal(page.answered(fresh({ pick: [0] }), 0), true);
assert.equal(page.answered(fresh({ own: ["свой"] }), 0), true);
assert.equal(page.answered(fresh({ own: ["  "], pick: [null] }), 0), false);
const all = fresh({ pick: [0, 1, 0, 0, 1, 0, null], own: ["", "", "", "", "", "", "пришли"] });
assert.equal(page.canSend(data, all), true);
assert.equal(page.canSend(data, { ...all, own: [] }), false, "последний вопрос без ответа");
assert.equal(page.canSend(data, { ...all, sent: true }), false);
assert.equal(page.canSend(okData, fresh()), true, "без вопросов отправить можно сразу");

// Текст ответа: развороты находок по id, вариант словами, согласие, дополнение, коммит.
const text = page.answerText(data, { ...all, flip: [0, 1], own: ["и проверь на dev", "", "", "", "", "", "пришли"] });
assert.match(text, /^Ответ на сводку тикета 2 "Вход через VK ID/);
assert.match(text, /\n\nПоправить, хотя ты оставил:\n- S1: Заглушка входа на проде\.\n\nОткатить:\n- S2: Сессия в базе/);
assert.match(text, /\n\nОстальные находки - как есть\.\n\nВопрос S3:/);
assert.match(text, /Вопрос S3: У форм выхода[^\n]*\nОтвет: а\) оставить до настоящего входа \(как предложил агент\)\nДополнение: и проверь на dev\n/);
assert.match(text, /Вопрос S4: [^\n]*\nОтвет: б\) включить сейчас\n\n/, "не тот вариант, что предложил агент, - без пометки");
assert.match(text, /Вопрос S8: [^\n]*\nОтвет: а\) внести в брендбук с поднятием версии\n/, "у вопроса без предложения пометки нет");
assert.match(text, /Вопрос S5, S9-S15: [^\n]*\nОтвет: пришли\n/, "свой ответ без варианта");
assert.match(text, /\n\nКоммит: закоммить\.$/);
assert.match(page.answerText(data, all), /\n\nВсе находки - как есть\.\n/);
assert.doesNotMatch(page.answerText(okData, fresh()), /находки|Коммит|Вопрос/);
// Сообщение коммита: правленое - строками в конце, неправленое и пустое - нет, при "не коммитить" - нет.
const withMsg = page.answerText(data, { ...all, msg: "feat: login stub\n\nbody" });
assert.match(withMsg, /\nКоммит: закоммить\.\nСообщение коммита:\nfeat: login stub\n\nbody$/);
assert.doesNotMatch(page.answerText(data, { ...all, msg: data.commit.message }), /Сообщение коммита/);
assert.doesNotMatch(page.answerText(data, { ...all, msg: "   " }), /Сообщение коммита/);
const noCommit = page.answerText(data, { ...all, commit: false, msg: "feat: другое" });
assert.match(noCommit, /\nКоммит: пока не коммитить\.$/);

console.log("summary-template: все проверки пройдены");
