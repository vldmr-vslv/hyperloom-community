import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultHighlightStyle, HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { themeOf } from "./themes";

/** Что с правкой: есть несохранённое; файл сменился на диске, пока в карточке его правили. */
export type EditStatus = { dirty: boolean; stale: boolean };

/** Команда редактору из шапки карточки: сохранить или взять файл с диска поверх своей правки. Шапка и редактор - разные
 *  ветки карточки, поэтому команда идёт событием окна с путём файла. */
const EDIT_COMMAND = "editor-command";
type EditCommand = { path: string; command: "save" | "disk" };
export const editCommand = (path: string, command: EditCommand["command"]) =>
  window.dispatchEvent(new CustomEvent<EditCommand>(EDIT_COMMAND, { detail: { path, command } }));

/** Редактор - в цветах карточки: фон и текст переднего слоя, шрифт терминала. */
const look = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "var(--front)", fontSize: "12px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-gutters": { backgroundColor: "var(--front)", color: "var(--text-muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text)" },
  // --focus-wash на 8% почти прозрачен: выделенный текст не отличим от невыделенного.
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--focus) 35%, transparent)",
  },
  // Панель поиска по файлу - поверхность приложения, а не белая форма браузера.
  ".cm-panels": { backgroundColor: "var(--surface-raised)", color: "var(--text)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-textfield": {
    border: "1px solid var(--border-strong)",
    borderRadius: "6px",
    backgroundColor: "var(--surface-sunken)",
    color: "var(--text)",
  },
  ".cm-button": {
    border: "1px solid var(--button-edge)",
    borderRadius: "6px",
    backgroundImage: "none",
    backgroundColor: "var(--button)",
    color: "var(--text)",
  },
  ".cm-panel.cm-search label, .cm-panel.cm-search [name=close]": { color: "var(--text-muted)" },
});

/** Подписи панели поиска и перехода к строке - по-русски, как всё приложение. */
const phrases = EditorState.phrases.of({
  Find: "Найти",
  Replace: "Заменить",
  next: "дальше",
  previous: "назад",
  all: "все",
  "match case": "регистр",
  regexp: "регулярное",
  "by word": "слово целиком",
  replace: "заменить",
  "replace all": "заменить все",
  close: "закрыть",
  "Go to line": "Перейти к строке",
  go: "перейти",
});

/**
 * Палитра круглого полотна (тёмная тема), как подсветка файлов в прототипе: заголовки светлые жирные, строки и код
 * зелёные, ключевые слова и атрибуты сиреневые, числа янтарные, комментарии серые, теги и ключи синие.
 */
const atlasHighlight = HighlightStyle.define([
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: "#e8ecf4", fontWeight: "700" },
  { tag: [t.monospace, t.string, t.special(t.string), t.regexp, t.attributeValue], color: "#b6e35a" },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.bool, t.null, t.attributeName, t.self], color: "#a98bff" },
  { tag: [t.number, t.integer, t.float], color: "#f5b83d" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: "#6f6f6c" },
  { tag: [t.propertyName, t.tagName, t.typeName, t.className, t.angleBracket], color: "#5b9cf5" },
  { tag: [t.link, t.url], color: "#5b9cf5", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
]);

/** Палитра подсветки под тему: у тёмной (круглое полотно) - палитра прототипа, у прочих тёмных - One Dark, у светлых -
 *  встроенная. Ею же красит код чат. */
export function highlightStyle(): HighlightStyle {
  const theme = themeOf(document.documentElement.dataset.theme ?? "");
  if (theme.id === "dark") return atlasHighlight;
  return theme.dark ? oneDarkHighlightStyle : defaultHighlightStyle;
}

function highlight() {
  return syntaxHighlighting(highlightStyle());
}

/**
 * Редактор текстового файла. Язык подсветки - по имени файла, из набора CodeMirror; незнакомое имя -
 * без подсветки. Ctrl+S пишет файл; до этого правка живёт только в карточке. Файл сменился на диске
 * (правил агент) - без несохранённого текст подтягивается, с ним - остаётся свой, а шапка говорит,
 * что файл сменился. Переводы строк файла сохраняются: CodeMirror держит строки через \n.
 */
export function Editor({
  path,
  text,
  onSave,
  onStatus,
}: {
  path: string;
  /** Текст файла на диске - как его прочитал главный процесс. */
  text: string;
  onSave: (text: string) => Promise<boolean>;
  onStatus: (status: EditStatus) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Что сейчас лежит на диске, в его собственных переводах строк; и что со правкой.
  const saved = useRef(text);
  // Последний текст с диска, даже если своя правка его не пустила в редактор: его берёт команда "disk".
  const disk = useRef(text);
  disk.current = text;
  const status = useRef<EditStatus>({ dirty: false, stale: false });
  const handlers = useRef({ onSave, onStatus });
  handlers.current = { onSave, onStatus };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const report = (next: EditStatus) => {
      if (next.dirty === status.current.dirty && next.stale === status.current.stale) return;
      status.current = next;
      handlers.current.onStatus(next);
    };
    const save = async () => {
      const current = view.current?.state.doc.toString() ?? "";
      const out = saved.current.includes("\r\n") ? current.replace(/\n/g, "\r\n") : current;
      if (await handlers.current.onSave(out)) {
        saved.current = out;
        report({ dirty: false, stale: false });
      }
      return true;
    };
    const lang = new Compartment();
    const colors = new Compartment();
    const editor = new EditorView({
      parent: node,
      state: EditorState.create({
        doc: saved.current,
        extensions: [
          Prec.highest(keymap.of([{ key: "Mod-s", run: () => (void save(), true) }])),
          basicSetup,
          look,
          phrases,
          // Карточка узкая: длинная строка переносится, а не уезжает вбок.
          EditorView.lineWrapping,
          colors.of(highlight()),
          lang.of([]),
          EditorView.updateListener.of((update) => {
            // Правка руками, а не подстановка текста с диска: у той стоит пометка "external".
            if (update.docChanged && !update.transactions.some((tr) => tr.isUserEvent("external"))) {
              report({ ...status.current, dirty: true });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    const name = path.split(/[\\/]/).pop() ?? path;
    void LanguageDescription.matchFilename(languages, name)
      ?.load()
      .then((support) => editor.dispatch({ effects: lang.reconfigure(support) }));
    const retheme = () => editor.dispatch({ effects: colors.reconfigure(highlight()) });
    window.addEventListener("theme-change", retheme);
    const command = (event: Event) => {
      const { detail } = event as CustomEvent<EditCommand>;
      if (detail.path !== path) return;
      if (detail.command === "save") return void save();
      saved.current = disk.current;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: disk.current }, userEvent: "external" });
      report({ dirty: false, stale: false });
    };
    window.addEventListener(EDIT_COMMAND, command);
    return () => {
      window.removeEventListener("theme-change", retheme);
      window.removeEventListener(EDIT_COMMAND, command);
      editor.destroy();
      view.current = null;
    };
  }, [path]);

  // Файл перечитан с диска. Своя же запись возвращается тем же текстом - её пропускаем.
  useEffect(() => {
    const editor = view.current;
    if (!editor || text === saved.current) return;
    if (status.current.dirty) {
      status.current = { ...status.current, stale: true };
      handlers.current.onStatus(status.current);
      return;
    }
    saved.current = text;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      userEvent: "external",
    });
  }, [text]);

  return <div ref={host} className="card__editor nodrag nowheel" />;
}
