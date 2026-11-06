// Проверка модели канваса на обычных assert: node src/shared/canvas-model.check.ts
import assert from "node:assert/strict";
import { knownCards } from "./canvas-model.ts";
import { addCard, colorOf, frozenCards, hideEntry, isHidden, RENDER_BUDGET, initialLayout, isLayout, pathKey, projectColors, removeCard, setCollapsed, setColor, unhideEntry, updateCard, visibleCards } from "./canvas-model.ts";

// Первый запуск: ровно одна карточка, и она указывает на каталог проектов.
{
  const layout = initialLayout("C:/projects");
  assert.equal(layout.cards.length, 1);
  assert.equal(layout.cards[0].path, "C:/projects");
  assert.equal(layout.cards[0].kind, "folder");
  assert.deepEqual(layout.edges, []);
}

// Карточку двигают и меняют её размер; чужие карточки и исходная раскладка не трогаются.
{
  const before = initialLayout("C:/projects");
  const moved = updateCard(before, "root", { position: { x: 120, y: -40 } });
  assert.deepEqual(moved.cards[0].position, { x: 120, y: -40 });
  assert.deepEqual(moved.cards[0].size, before.cards[0].size);
  assert.deepEqual(before.cards[0].position, { x: 0, y: 0 });

  const resized = updateCard(moved, "root", { size: { width: 500, height: 300 } });
  assert.deepEqual(resized.cards[0].size, { width: 500, height: 300 });
  assert.deepEqual(resized.cards[0].position, { x: 120, y: -40 });

  // Неизвестный идентификатор ничего не меняет.
  assert.deepEqual(updateCard(before, "нет-такой", { position: { x: 9, y: 9 } }), before);
}

// Раскладка переживает круг через JSON: то, что записали, то и прочитали.
{
  const saved = updateCard(initialLayout("C:/projects"), "root", {
    position: { x: 120, y: -40 },
    size: { width: 500, height: 300 },
  });
  const back: unknown = JSON.parse(JSON.stringify(saved));
  assert.ok(isLayout(back));
  assert.deepEqual(back, saved);
}

// Подпись корня ложится в раскладку и читается обратно; подпись не строкой - не раскладка.
{
  const titled = updateCard(initialLayout("C:/projects"), "root", { title: "Root" });
  const back: unknown = JSON.parse(JSON.stringify(titled));
  assert.ok(isLayout(back));
  assert.equal(back.cards[0].title, "Root");
  const bad = { version: 2, cards: [{ ...titled.cards[0], title: 7 }], edges: [] };
  assert.equal(isLayout(bad), false);
}

// Испорченный или чужой файл раскладкой не считается - приложение начнёт с первого запуска.
{
  for (const broken of [
    null,
    42,
    "{}",
    {},
    { version: 2, cards: [], edges: [] },
    // Раскладка прошлой версии: вида карточки в ней нет, чем рисовать - неизвестно.
    { version: 1, cards: [{ id: "root", kind: "folder", path: "C:/x", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    // Карточка без вида и с чужим видом: рисовать нечем в обоих случаях.
    { version: 2, cards: [{ id: "root", path: "C:/x", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    { version: 2, cards: [{ id: "root", kind: "терминал", path: "C:/x", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    { version: 99, cards: [{ id: "root", kind: "folder", path: "C:/x", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    { version: 2, cards: [{ id: "root", kind: "folder", path: "C:/x", position: { x: "0", y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    { version: 2, cards: [{ id: "root", kind: "folder", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [] },
    { version: 2, cards: [{ id: "root", kind: "folder", path: "C:/x", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }], edges: [{ id: "e1", from: "root" }] },
  ]) {
    assert.equal(isLayout(broken), false, `принято за раскладку: ${JSON.stringify(broken)}`);
  }
}

// Выбранная папка ложится на полотно карточкой, от родителя к ней проведена стрелка.
{
  const before = initialLayout("C:/projects");
  const after = addCard(before, "root", "C:/projects/site", "folder");

  assert.equal(after.cards.length, 2);
  const added = after.cards.find((card) => card.path === "C:/projects/site");
  assert.ok(added);
  assert.equal(after.edges.length, 1);
  assert.equal(after.edges[0].from, "root");
  assert.equal(after.edges[0].to, added.id);

  // Исходная раскладка не тронута.
  assert.equal(before.cards.length, 1);
  assert.deepEqual(before.edges, []);
}
// Та же папка второй раз двойника не заводит, чужой родитель ничего не меняет.
{
  const once = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  assert.deepEqual(addCard(once, "root", "C:/projects/site", "folder"), once);
  assert.deepEqual(addCard(once, "нет-такой", "C:/projects/other", "folder"), once);
  // Каталог проектов, выбранный диалогом, - это уже лежащая корневая карточка.
  assert.deepEqual(addCard(once, "root", "C:/projects", "folder"), once);
}

// Файл из карточки папки ложится своей карточкой со стрелкой от папки, а не от корня.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const after = addCard(withFolder, "C:/projects/site", "C:/projects/site/readme.md", "file");

  const file = after.cards.find((card) => card.path === "C:/projects/site/readme.md");
  assert.ok(file);
  assert.equal(file.kind, "file");
  assert.equal(after.edges.length, 2);
  assert.equal(after.edges[1].from, "C:/projects/site");
  assert.equal(after.edges[1].to, file.id);

  // Карточка папки осталась папкой.
  assert.equal(after.cards[1].kind, "folder");
}

// Карточка файла со стрелкой от папки переживает круг через JSON - то есть и перезапуск.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const saved = addCard(withFolder, "C:/projects/site", "C:/projects/site/logo.png", "file");
  const back: unknown = JSON.parse(JSON.stringify(saved));

  assert.ok(isLayout(back));
  assert.deepEqual(back, saved);
  assert.equal(back.cards[2].kind, "file");
}

// Карточка папки со стрелкой переживает круг через JSON - то есть и перезапуск приложения.
{
  const saved = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const back: unknown = JSON.parse(JSON.stringify(saved));
  assert.ok(isLayout(back));
  assert.deepEqual(back, saved);
}


// Терминал в папке: своя карточка со стрелкой от папки, при этом карточка самой папки цела.
// Путь у них общий, поэтому идентификатор терминала отличается от идентификатора папки.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const after = addCard(withFolder, "C:/projects/site", "C:/projects/site", "terminal");

  const terminal = after.cards.find((card) => card.kind === "terminal");
  assert.ok(terminal, "карточка терминала не создалась");
  assert.equal(terminal.path, "C:/projects/site");
  assert.notEqual(terminal.id, "C:/projects/site");
  assert.equal(after.cards.length, 3);
  assert.equal(after.edges.at(-1)?.from, "C:/projects/site");
  assert.equal(after.edges.at(-1)?.to, terminal.id);

  // Карточка папки осталась папкой и на месте.
  assert.equal(after.cards.find((card) => card.id === "C:/projects/site")?.kind, "folder");
}


// Карточка терминала переживает круг через JSON - то есть и перезапуск приложения.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const saved = addCard(withFolder, "C:/projects/site", "C:/projects/site", "terminal");
  const back: unknown = JSON.parse(JSON.stringify(saved));

  assert.ok(isLayout(back), "раскладка с терминалом не прочиталась обратно");
  assert.deepEqual(back, saved);
}

// Карточку терминала закрыли: с полотна уходит она сама и стрелка к ней, папка остаётся.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const withTerminal = addCard(withFolder, "C:/projects/site", "C:/projects/site", "terminal");
  const terminal = withTerminal.cards.find((card) => card.kind === "terminal");
  assert.ok(terminal);

  const after = removeCard(withTerminal, terminal.id);
  assert.deepEqual({ ...after, places: undefined }, { ...withFolder, places: undefined }, "закрытие карточки оставило след на полотне");

  // Чужой идентификатор полотно не трогает.
  assert.deepEqual(removeCard(withTerminal, "нет-такой"), withTerminal);
}





// Заметка ложится карточкой со стрелкой от папки и переживает круг через JSON.
// Путь у неё - сам файл заметки, а не папка: карточек заметок в папке бывает несколько.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const saved = addCard(withFolder, "C:/projects/site", "C:/projects/site/note.md", "note");

  const note = saved.cards.find((card) => card.kind === "note");
  assert.ok(note, "карточка заметки не создалась");
  assert.equal(note.path, "C:/projects/site/note.md");
  assert.equal(note.id, "C:/projects/site/note.md");
  assert.equal(saved.edges.at(-1)?.from, "C:/projects/site");
  assert.equal(saved.edges.at(-1)?.to, note.id);

  // Вторая заметка в той же папке - это другой файл, поэтому и карточка другая.
  const two = addCard(saved, "C:/projects/site", "C:/projects/site/note-2.md", "note");
  assert.equal(two.cards.filter((card) => card.kind === "note").length, 2);

  const back: unknown = JSON.parse(JSON.stringify(two));
  assert.ok(back && isLayout(back), "раскладка с заметкой не прочиталась обратно");
  assert.deepEqual(back, two);
}

// Закрытие папки уносит с полотна всё, что из неё выросло, - на любую глубину, вместе со
// стрелками. Соседняя ветка и корень остаются, исходная раскладка не тронута.
{
  const withFolder = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const withNested = addCard(withFolder, "C:/projects/site", "C:/projects/site/api", "folder");
  const withFile = addCard(withNested, "C:/projects/site/api", "C:/projects/site/api/main.ts", "file");
  const withNote = addCard(withFile, "C:/projects/site", "C:/projects/site/note.md", "note");
  const withTerminal = addCard(withNote, "C:/projects/site", "C:/projects/site", "terminal");
  const before = addCard(withTerminal, "root", "C:/projects/other", "folder");
  assert.equal(before.cards.length, 7);

  const after = removeCard(before, "C:/projects/site");
  assert.deepEqual(
    after.cards.map((card) => card.id),
    ["root", "C:/projects/other"],
    "каскад оставил на полотне потомков закрытой папки",
  );
  assert.deepEqual(after.edges.map((edge) => edge.to), ["C:/projects/other"]);

  // Раскладка, с которой закрывали, осталась прежней: закрытие возвращает новую,
  // и отказ в подтверждении - это просто отказ от неё.
  assert.equal(before.cards.length, 7);
  assert.equal(before.edges.length, 6);
}




// Видимая область: карточка видна, если хоть краем попала в прямоугольник экрана.
{
  const two = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const placed = updateCard(two, "root", { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } });
  const layout = updateCard(placed, "C:/projects/site", {
    position: { x: 500, y: 0 },
    size: { width: 100, height: 100 },
  });

  // Экран накрывает корень целиком, до дальней папки не достаёт.
  assert.deepEqual([...visibleCards(layout, { x: -50, y: -50, width: 200, height: 200 })], ["root"]);
  // Заехал краем - видна: карточка перестаёт рисоваться, только уйдя за край целиком.
  assert.deepEqual([...visibleCards(layout, { x: 90, y: 90, width: 200, height: 200 })], ["root"]);
  // Экран между карточками: не видно ни одной.
  assert.deepEqual([...visibleCards(layout, { x: 200, y: 0, width: 100, height: 100 })], []);
  // Край в край - это уже не видна: общей площади ноль.
  assert.deepEqual([...visibleCards(layout, { x: 100, y: 0, width: 100, height: 100 })], []);
}

// Заморожено то, что не попало на экран: перерисовывать уехавшую за край нечего.
{
  const two = addCard(initialLayout("C:/projects"), "root", "C:/projects/site", "folder");
  const placed = updateCard(two, "root", { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } });
  const layout = updateCard(placed, "C:/projects/site", {
    position: { x: 500, y: 0 },
    size: { width: 100, height: 100 },
  });

  const screen = { x: -50, y: -50, width: 200, height: 200 };
  const frozen = frozenCards(layout, visibleCards(layout, screen), new Map());
  assert.deepEqual([...frozen], ["C:/projects/site"]);
}

// Карточек на экране больше бюджета: замирают те, к которым дольше всего не обращались.
{
  let layout = initialLayout("C:/projects");
  for (let i = 0; i < RENDER_BUDGET; i += 1) {
    layout = addCard(layout, "root", `C:/projects/p${i}`, "folder");
  }
  // Экран накрывает всё полотно: корень плюс тридцать карточек - на одну больше бюджета.
  const visible = visibleCards(layout, { x: -1000, y: -1000, width: 20000, height: 20000 });
  assert.equal(visible.size, RENDER_BUDGET + 1);

  // Ни к одной не обращались: мёрзнет последняя по порядку раскладки, а не случайная.
  assert.deepEqual([...frozenCards(layout, visible, new Map())], ["C:/projects/p29"]);

  // К ней обратились - она оттаяла, мёрзнет следующая по давности.
  const touched = new Map([["C:/projects/p29", 5]]);
  assert.deepEqual([...frozenCards(layout, visible, touched)], ["C:/projects/p28"]);

  // На экране меньше бюджета: из видимых не мёрзнет никто.
  const few = visibleCards(layout, { x: -1000, y: -1000, width: 20000, height: 2000 });
  assert.ok(few.size > 0 && few.size < RENDER_BUDGET);
  const frozen = frozenCards(layout, few, new Map());
  assert.equal([...few].some((id) => frozen.has(id)), false);
}









// Свёрнутость, цвета проектов и скрытые записи живут в раскладке и читаются обратно.
{
  const root = initialLayout("C:/projects");
  const folded = setCollapsed(root, "root", true);
  assert.equal(folded.cards[0].collapsed, true);
  assert.equal("collapsed" in setCollapsed(folded, "root", false).cards[0], false);

  const colored = setColor(setColor(root, "C:\\projects\\site", "#AA00BB"), "C:/projects/site", "#112233");
  assert.deepEqual(colored.colors, { "C:/projects/site": "#112233" });
  assert.equal(colorOf(colored, "C:\\projects\\site\\app\\src"), "#112233");
  assert.equal(colorOf(colored, "C:/projects/other"), undefined);
  assert.equal(setColor(root, "C:/projects/site", "red"), root);

  // Цвет только у проекта: подпапка проекта и папка с проектами свой теряют, подпапка берёт цвет проекта.
  const stale = setColor(setColor(colored, "C:/projects/site/ui", "#445566"), "C:/projects", "#778899");
  const projects = projectColors(stale, (path) => path === "C:/projects/site");
  assert.deepEqual(projects.colors, { "C:/projects/site": "#112233" });
  assert.equal(colorOf(projects, "C:/projects/site/ui/x"), "#112233");
  assert.equal(projectColors(colored, () => true), colored, "чистить нечего - раскладка та же");

  const hidden = hideEntry(hideEntry(root, "C:\\projects\\_old"), "c:/projects/_OLD");
  assert.equal(hidden.hidden?.length, 1);
  assert.ok(isHidden(hidden, "C:/projects/_old"));
  assert.equal(isHidden(unhideEntry(hidden, "C:/projects/_old"), "C:\\projects\\_old"), false);

  const back: unknown = JSON.parse(JSON.stringify({ ...colored, hidden: hidden.hidden, cards: folded.cards }));
  assert.ok(isLayout(back), "раскладка с цветом, скрытыми и свёрнутой карточкой не прочиталась");
  assert.equal(isLayout({ ...root, colors: { a: "red" } }), false, "цвет не в виде #rrggbb принят");
  assert.equal(isLayout({ ...root, hidden: [1] }), false, "скрытая запись числом принята");
}




// Ключ пути сворачивает . и ..: файл, названный от папки агента с .., и тот же файл полным путём - одна карточка.
{
  assert.equal(pathKey("C:\\a\\xpnts\\../_scratch/x.summary.html"), pathKey("C:\\a\\_scratch\\x.summary.html"));
  assert.equal(pathKey("C:/a/xpnts/../_scratch/x.summary.html"), "c:/a/_scratch/x.summary.html");
  assert.equal(pathKey("C:/a/./b"), pathKey("C:/a/b"));
  assert.equal(pathKey("C:/a/b/../../c/"), "c:/c");
  assert.equal(pathKey("C:/.."), "c:", "выше корня диска не уходит и не падает");
  assert.equal(pathKey("C:/../.."), "c:");
  assert.equal(pathKey("/a/../.."), "", "корень без диска");
  assert.equal(pathKey("../x/./y"), "../x/y", "в начале относительного пути .. остаётся");
  assert.equal(pathKey("C:\\Proj\\..data\\a.md"), "c:/proj/..data/a.md", "имя с точками - не сегмент ..");
  assert.equal(pathKey("C:\\Proj\\Notes\\"), "c:/proj/notes", "прежнее поведение без точек");
}


// Раскладка с карточкой незнакомого вида читается без неё: без её связей и без стрелок потока, а не уезжает в .broken.
{
  const root = initialLayout("C:/projects");
  const file = addCard(root, "root", "C:/projects/a.md", "file");
  const fileId = file.cards[1].id;
  const raw = JSON.parse(JSON.stringify(file));
  raw.cards.push({ ...raw.cards[1], id: "чужая", kind: "zzz" });
  raw.edges.push({ id: "root->чужая", from: "root", to: "чужая" });
  raw.edges.push({ id: "поток", from: fileId, to: "root", manual: true });
  assert.equal(isLayout(raw), false);
  const known = knownCards(raw);
  assert.ok(isLayout(known));
  assert.deepEqual(known, file);
  // Не раскладка вовсе - отдаётся как есть, и её отвергнет isLayout.
  assert.equal(knownCards("мусор"), "мусор");
  const agent = JSON.parse(JSON.stringify(file));
  agent.cards.push({ ...agent.cards[1], id: "agent:x#1", kind: "agent", command: "claude" });
  assert.deepEqual(knownCards(agent), file);
}

// Терминал на полотне один: второй не заводится, пока есть первый.
{
  const one = addCard(initialLayout("C:/p"), "root", "C:/p", "terminal");
  assert.equal(one.cards.length, 2);
  assert.equal(addCard(one, "root", "C:/p", "terminal"), one);
}

console.log("canvas-model: все проверки пройдены");
