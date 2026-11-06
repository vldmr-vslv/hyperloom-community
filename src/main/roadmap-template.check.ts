// Проверка логики шаблона Roadmap на обычных assert: node src/main/roadmap-template.check.ts
// Блок логики гоняется в пустом контексте node:vm: он только объявляет функции и до document не дотягивается.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Даты страница пишет по часам машины; проверка ставит пояс образца (+05:00), чтобы строки не зависели от машины.
process.env.TZ = "Etc/GMT-5";

const html = readFileSync(new URL("../../resources/roadmap/roadmap.html", import.meta.url), "utf8");
// Комментарий шаблона сам упоминает блок данных - блоки ищутся без комментариев, как их видит браузер.
const markup = html.replace(/<!--[\s\S]*?-->/g, "");
const block = (id: string): string => {
  const match = markup.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  assert.ok(match, `в шаблоне нет блока ${id}`);
  return match[1];
};

type Ticket = { number: string; role: string; start?: number; end?: number; scratch: string; minutes: number };
type Group = {
  slug: string; stage: number; done: number; plan: number; left: number; fact?: number; undated: number;
  closed: [number, number] | null; ahead: [number, number] | null; span: [number, number] | null; tickets: Ticket[];
};
type View = {
  tickets: Ticket[]; groups: Group[]; end: number; plan: number; left: number; open: number; doing: number;
  closed: number; measured: number; fact: number; factPlan: number;
};
const page = runInNewContext(
  `${block("roadmap-logic")}\n;({ parseRoadmap, gantt, statusRole, minutesText, driftText, ticketTimes, ticketStates, news, newsText, factOf })`,
  {},
) as {
  parseRoadmap(text: string): { data?: any; errors?: string[] };
  gantt(data: unknown, now: number): View;
  statusRole(status: string): string;
  minutesText(m: number): string;
  driftText(m: number): string;
  ticketTimes(t: unknown): Times;
  factOf(actual: unknown): number;
  ticketStates(tickets: unknown[]): Record<string, string>;
  news(tickets: unknown[], seen: Record<string, string> | null): Map<string, string>;
  newsText(mark: string): string;
};
type Times = { start?: number; end?: number };
// Объекты из чужого контекста не равны своим по deepEqual: прототипы разные. Сравнение - через JSON.
const plain = (value: unknown): any => JSON.parse(JSON.stringify(value));
const at = (iso: string): number => Date.parse(iso);
const hhmm = (ms?: number): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString().slice(11, 16));

// Образец - скаут в середине работы: 01 и 02 закрыты с фактом 18 и 49 минут, 03 в работе, 04 ждёт.
const sample = block("roadmap-data");
const parsed = page.parseRoadmap(sample);
assert.equal(parsed.errors, undefined, `образец не разобрался: ${parsed.errors}`);

// Календарь от "сейчас" 12:00 (07:00 UTC): закрытые по факту, 03 в работе со started 10:49 кончается через свою оценку
// (90 мин) от "сейчас", 04 ждёт за ним 65 минут. Часы ниже в UTC.
const now = at("2026-10-14T12:00:00+05:00");
const view = page.gantt(parsed.data, now);
assert.deepEqual(plain(view.tickets.map((t) => [t.number, t.role, hhmm(t.start), hhmm(t.end)])), [
  ["01", "done", "05:00", "05:18"], ["02", "done", "05:00", "05:49"], ["03", "doing", "05:49", "08:30"], ["04", "waiting", "08:30", "09:35"],
]);
assert.deepEqual([view.end, view.plan, view.left, view.open, view.doing, view.closed, view.measured, view.fact, view.factPlan],
  [at("2026-10-14T14:35:00+05:00"), 210, 155, 2, 1, 2, 2, 67, 55]);
const [scout] = plain(view.groups);
assert.deepEqual([scout.slug, scout.stage, scout.done, scout.plan, scout.left, scout.fact, scout.undated], ["scout", 0, 2, 210, 155, 67, 0]);
assert.deepEqual(scout.tickets.map((t: Ticket) => t.number), ["03", "04", "01", "02"], "в работе, ждёт, закрытые");
assert.deepEqual([scout.closed.map(hhmm), scout.ahead.map(hhmm)], [["05:00", "05:49"], ["05:49", "09:35"]]);

// Скретчи из пути: в работе сверху, ждущие посередине, закрытые снизу; путь не из скретча идёт в скретч страницы.
const split = plain(parsed.data);
["_scratch/a/issues/01-x.md", "_scratch/a/issues/02-x.md", "_scratch\\b\\issues\\03-x.md", "notes/04.md"].forEach((p, i) => (split.tickets[i].path = p));
assert.deepEqual(plain(page.gantt(split, now).groups.map((g) => [g.slug, g.stage])), [["b", 0], ["scout", 1], ["a", 2]]);

// Очередь: в работе и за тобой первыми, дальше скретч за скретчем, но блокировка раньше заблокированного; снятый на
// календарь не встаёт; тикет в работе без started начинается в очереди.
const base = { title: "Т", status: "ready-for-agent", blockedBy: [], estimate: { agent: 10, lead: 5, windows: 1, raw: { agent: 8, lead: 4 } }, criteria: { done: 0, total: 1 } };
const queue = (tickets: Array<Record<string, unknown>>) => ({ scratch: { slug: "s", title: "S" }, calibration: { factor: 1, tickets: 0, scope: "none" }, tickets });
const q = page.gantt(page.parseRoadmap(JSON.stringify(queue([
  { ...base, number: "x1", path: "_scratch/x/issues/1.md", blockedBy: ["y1"] },
  { ...base, number: "y1", path: "_scratch/y/issues/1.md" },
  { ...base, number: "z1", path: "_scratch/z/issues/1.md", status: "in-progress" },
  { ...base, number: "h1", path: "_scratch/h/issues/1.md", status: "ready-for-human" },
  { ...base, number: "w1", path: "_scratch/x/issues/2.md", status: "wontfix" },
]))).data, now);
assert.deepEqual(plain(q.tickets.map((t) => [t.number, hhmm(t.start)])).sort(), [["h1", "07:15"], ["x1", "07:45"], ["y1", "07:30"], ["z1", "07:00"]]);
assert.deepEqual(plain(q.groups.map((g) => [g.slug, g.stage])), [["z", 0], ["h", 0], ["y", 1], ["x", 1]]);

// Закрытый без started и замера начинается в finished минус оценка; без дат он вне календаря, в undated; все закрыты,
// значит очередь пуста и её конец равен "сейчас".
const closed = page.gantt(page.parseRoadmap(JSON.stringify(queue([
  { ...base, number: "1", path: "_scratch/x/issues/1.md", status: "closed", finished: "2026-10-14T11:30:00+05:00" },
  { ...base, number: "2", path: "_scratch/x/issues/2.md", status: "closed" },
]))).data, now);
assert.deepEqual(plain(closed.tickets.map((t) => [hhmm(t.start), hhmm(t.end)])), [["06:15", "06:30"], [null, null]]);
assert.deepEqual(plain([closed.groups[0].stage, closed.groups[0].undated, closed.groups[0].ahead, closed.end === now]), [2, 1, null, true]);

// Факт закрытого - работа агента и человека (agent + lead), без простоя; конец на календаре - started плюс minutes,
// время от старта до коммита. Замер без agent и lead - факт minutes, как раньше. 91 + 49 = 140.
const active = page.gantt(page.parseRoadmap(JSON.stringify(queue([
  { ...base, number: "1", path: "_scratch/x/issues/1.md", status: "closed", started: "2026-10-13T18:00:00+05:00",
    actual: { minutes: 757, windows: 1, agent: 71, lead: 20, idle: 666 } },
  { ...base, number: "2", path: "_scratch/x/issues/2.md", status: "closed", started: "2026-10-14T10:00:00+05:00",
    actual: { minutes: 49, windows: 1 } },
]))).data, now);
assert.deepEqual(plain([active.fact, active.groups[0].fact, hhmm(active.tickets[0].end)]), [140, 140, "01:37"]);
assert.deepEqual([page.factOf({ minutes: 757, windows: 1, agent: 71, lead: 20, idle: 666 }), page.factOf({ minutes: 49, windows: 1 })], [91, 49]);
assert.equal(page.driftText(0), "в срок");
assert.deepEqual(["45 мин", "2 ч", "1 ч 5 мин"], [45, 120, 65].map(page.minutesText));

// Тег блока данных встречается в файле один раз, а ключи данных - только в блоке данных: агент, правящий первое
// вхождение, попадает в данные, а не в пример схемы в комментарии. "tickets" в данных дважды - у calibration и
// список тикетов, - и оба там.
assert.equal(html.split('id="roadmap-data"').length - 1, 1, 'в шаблоне не одно вхождение id="roadmap-data"');
for (const marker of ['"scratch":', '"calibration":', '"tickets":', '"blockedBy":', '"estimate":']) {
  const inData = sample.split(marker).length - 1;
  assert.ok(inData > 0 && html.split(marker).length - 1 === inData, `${marker} встречается вне блока данных`);
}
// Во всём шаблоне ни одного внешнего адреса: страница не просит ничего, кроме себя.
assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:|\/\/)|@import|url\(/i);

// Статусы: роли разбора, всё прочее - ждёт; ключ прототипа объекта ролью не считается.
assert.deepEqual(
  ["closed", "in-progress", "ready-for-human", "wontfix", "ready-for-agent", "needs-triage", "toString"].map(page.statusRole),
  ["done", "doing", "human", "dropped", "waiting", "waiting", "waiting"],
);

// Битые данные называют поле, а не падают.
const broken = (value: unknown): string[] => plain(page.parseRoadmap(JSON.stringify(value)).errors ?? []);
assert.match(page.parseRoadmap("{ нет").errors![0], /JSON/);
assert.deepEqual(broken([]), ["данные - не объект"]);
const ticket = {
  number: 1,
  title: "Т",
  path: "_scratch/x/issues/01-t.md",
  blockedBy: [],
  status: "ready-for-agent",
  estimate: { agent: 10, lead: 5, windows: 1, raw: { agent: 8, lead: 4 } },
  criteria: { done: 0, total: 3 },
};
const ok = { scratch: { slug: "x", title: "Х" }, calibration: { factor: 1.25, tickets: 3, scope: "project" }, tickets: [ticket] };
assert.deepEqual(broken(ok), []);
assert.equal(page.parseRoadmap(JSON.stringify(ok)).data.tickets[0].number, "1", "номер - строкой");
const withTicket = (patch: Record<string, unknown>) => ({ ...ok, tickets: [{ ...ticket, ...patch }] });
const cases: Array<[unknown, string[]]> = [
  [{ ...ok, scratch: "x" }, ["scratch: нужен объект"]],
  [{ ...ok, scratch: { slug: "", title: "Х", spec: 3 } }, ["scratch.slug: нужна строка", "scratch.spec: нужна строка"]],
  [{ ...ok, calibration: { factor: 0, tickets: -1, scope: "мой" } }, [
    "calibration.factor: нужно число больше 0",
    "calibration.tickets: нужно целое от 0",
    "calibration.scope: нужно project, all или none",
  ]],
  [{ ...ok, tickets: [] }, ["tickets: нужен непустой массив"]],
  [{ ...ok, tickets: [ticket, ticket] }, ["tickets[1].number: номер 1 уже есть"]],
  [withTicket({ number: null, title: "", path: 5 }), [
    "tickets[0].number: нужна строка или число",
    "tickets[0].title: нужна строка",
    "tickets[0].path: нужна строка",
  ]],
  [withTicket({ blockedBy: "01", status: "" }), ["tickets[0].blockedBy: нужен массив номеров", "tickets[0].status: нужна строка"]],
  [withTicket({ estimate: { agent: -1, lead: "5", windows: 1.5 } }), [
    "tickets[0].estimate.agent: нужны минуты, число от 0",
    "tickets[0].estimate.lead: нужны минуты, число от 0",
    "tickets[0].estimate.windows: нужно целое от 0",
    "tickets[0].estimate.raw: нужны минуты agent и lead, числа от 0",
  ]],
  [withTicket({ started: "вчера", actual: { minutes: 10 }, criteria: { done: 4, total: 3 } }), [
    "tickets[0].started: нужно время ISO",
    "tickets[0].actual: нужны minutes, число от 0, и windows, целое от 0",
    "tickets[0].criteria: нужны done и total, целые от 0, done не больше total",
  ]],
  [withTicket({ actual: { minutes: 10, windows: 1, agent: "5", lead: -1, idle: null } }), [
    "tickets[0].actual.agent: нужны минуты, число от 0",
    "tickets[0].actual.lead: нужны минуты, число от 0",
    "tickets[0].actual.idle: нужны минуты, число от 0",
  ]],
  [withTicket({ actual: { minutes: 10, windows: 1, agent: 5 } }), [
    "tickets[0].actual: agent и lead только вместе",
  ]],
  [withTicket({ finished: "потом" }), ["tickets[0].finished: нужно время ISO"]],
  [withTicket({ blockedBy: ["7"] }), ["tickets[0].blockedBy: нет тикета 7"]],
  [{ ...ok, tickets: [{ ...ticket, blockedBy: [2] }, { ...ticket, number: 2, blockedBy: [1] }] }, ["tickets: блокировки по кругу через тикет 1"]],
];
for (const [value, expected] of cases) assert.deepEqual(broken(value), expected, JSON.stringify(value));

// Даты по часам. В образце 01 начат в 10:00 с фактом 18 минут - кончился в 10:18; 03 в работе - конца нет.
const [s01, , s03, s04] = parsed.data.tickets;
assert.deepEqual(plain(page.ticketTimes(s01)), { start: at("2026-10-14T10:00:00+05:00"), end: at("2026-10-14T10:18:00+05:00") });
assert.deepEqual(plain(page.ticketTimes(s03)), { start: at("2026-10-14T10:49:00+05:00") });
assert.deepEqual(plain(page.ticketTimes(s04)), {});
// Без started конец закрытого - finished; started с фактом важнее finished; у незакрытого конца нет.
const old = { ...ticket, status: "closed", finished: "2026-09-30T06:38:01+05:00" };
assert.deepEqual(plain(page.ticketTimes(old)), { end: at(old.finished) });
const measured = { ...old, started: "2026-09-29T12:00:00+05:00", actual: { minutes: 30, windows: 1 } };
assert.equal(page.ticketTimes(measured).end, at("2026-09-29T12:30:00+05:00"));
assert.deepEqual(plain(page.ticketTimes({ ...old, status: "in-progress" })), {});

// Новое с прошлого просмотра. Снимок - номер и статус; в прошлый раз 01 был в работе, 03 ждал, 04 не было.
const states = plain(page.ticketStates(parsed.data.tickets));
assert.deepEqual(states, { "01": "closed", "02": "closed", "03": "in-progress", "04": "ready-for-agent" });
const seen = { "01": "in-progress", "02": "closed", "03": "needs-triage" };
assert.deepEqual(plain([...page.news(parsed.data.tickets, seen)]), [["01", "doing"], ["03", "waiting"], ["04", "new"]]);
assert.deepEqual(plain([...page.news(parsed.data.tickets, { ...states, "04": "needs-triage" })]), [], "статус другой, роль та же - ждёт");
assert.deepEqual(plain([...page.news(parsed.data.tickets, null)]), [], "прошлого снимка нет - нового нет");
assert.deepEqual(["new", "waiting"].map(page.newsText), ["новый", "было: ждёт"]);

console.log("roadmap-template: все проверки пройдены");
