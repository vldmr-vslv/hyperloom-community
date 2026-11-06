import { Fragment, useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizeControl, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import type { CommandRun } from "../../main/command-runs";
import type { FolderEntry, FolderRead } from "../../preload";
import type { Pt } from "../../shared/route";
import { isInside, pathKey, ROOT_CARD_ID, type CardKind } from "../../shared/canvas-model";
import { BrowserBody, isVideo } from "./Browser";
import { CardMenu } from "./CardMenu";
import terminalIcon from "./assets/windows-terminal.png";
import { age } from "./ring-svg";
import { shellOf, type Look } from "./card-look";
import { editCommand, type EditStatus } from "./Editor";
import { FileBody } from "./File";
import { useFolder } from "./folder";
import { RingNode, type RingInfo } from "./Ring";
import { flyCenter } from "./freeze";
import { ROOT_ART_RATIO } from "./link-routes";
import { Icon } from "./Icon";
import { Menu, useMenu } from "./Menu";
import { NoteBody } from "./Note";
import { TerminalBody } from "./Terminal";

/** Карточка родит потомка: папку или файл из списка, терминал и заметку из меню. */
/** command - не используется (всегда undefined). at - середина новой карточки на круглом
 *  полотне: подпапка встаёт напротив своего сегмента. */
export type OpenCard = (parentId: string, path: string, kind: CardKind, command?: string, at?: Pt) => void;
export type CloseCard = (id: string) => void;
/** В терминале карточки пошла команда или закончилась. */
export type ReportRun = (id: string, busy: boolean) => void;
/** Меню карточки правит раскладку: свернуть, покрасить проект, скрыть или вернуть запись. */
export type FoldCard = (id: string, collapsed: boolean) => void;
export type PaintFolder = (path: string, hex: string) => void;
export type HideEntry = (path: string, hidden: boolean) => void;
/** Где на полотне карточка этого пути. Карточки нет - undefined. */
export type CardAt = (path: string) => { x: number; y: number; width: number; height: number } | undefined;

/** Имя вида для чтения с экрана: цветом оболочки вид виден глазами, а не словами. */
const KIND_TITLES: Record<Look | "image", string> = {
  root: "Каталог проектов",
  folder: "Папка",
  file: "Файл",
  image: "Картинка",
  terminal: "Терминал",
  note: "Заметка",
};

/** Плита "керамика Atlas" на круглом полотне: имя папки для метки, место входа связи от левого верхнего угла
 *  карточки (side - сторона: x - левая или правая, y - верх или низ) и фаза появления и закрытия. */
export type Atlas = { parent: string; port: { x: number; y: number; side: "x" | "y" } | null; phase: "born" | "dying" | null };

/** Метка вида в строке над именем. */
const ATLAS_TAGS: Record<CardKind, string> = {
  folder: "FOLDER",
  file: "FILE",
  terminal: "TERMINAL",
  note: "NOTE",
};
const BARS = [1, 2, 1, 3, 1, 1, 2, 1, 2];

/** Наименьший размер карточки на круглом полотне, как в прототипе (CARD[kind].min). */
const ATLAS_MIN: Partial<Record<CardKind, [number, number]>> = { terminal: [320, 200], note: [200, 120], file: [280, 160] };


export type CardNode = Node<
  {
    path: string;
    name: string;
    kind: CardKind;
    title?: string;
    nameRoot: (title?: string) => void;
    /** В терминале карточки идёт команда. */
    running: boolean;
    /** Полотно показано графом: карточка - кружок, сама она спрятана, но живёт (graph-view.ts). */
    graph: boolean;
    showGraph: () => void;
    collapsed: boolean;
    /** Цвет проекта этой карточки: свой или ближайшей покрашенной папки выше. */
    color: string;
    /** Каталог проектов: путь в карточке папки показан от него. */
    rootPath: string;
    /** Подпапка раскрывается в той же карточке деревом, а не открывается своей карточкой. */
    tree: boolean;
    /** Скрытые записи списков по пути. */
    hidden: string[];
    colorOf: (path: string) => string;
    cardAt: CardAt;
    openCard: OpenCard;
    closeCard: CloseCard;
    foldCard: FoldCard;
    paintFolder: PaintFolder;
    hideEntry: HideEntry;
    /** Строки списка перерисовались: связи из них надо перемерить. */
    markPorts: () => void;
    reportRun: ReportRun;
    /** Круглое полотно: папка и корень рисуются кольцом (Ring.tsx). */
    ring?: RingInfo;
    /** Круглое полотно: остальные карточки - плитой Atlas. */
    atlas?: Atlas;
  },
  "card"
>;

export type Data = CardNode["data"];

/** Запись папки: уже на полотне - камера летит к её карточке, нет - карточка открывается. */
function useOpenEntry(id: string, data: Data) {
  const flow = useReactFlow();
  return (entry: FolderEntry) => {
    const at = data.cardAt(entry.path);
    if (at) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      flyCenter(flow, at.x + at.width / 2, at.y + at.height / 2, 1, still ? 0 : 500);
      return;
    }
    data.openCard(id, entry.path, entry.isDirectory ? "folder" : "file");
  };
}

/** Видимые записи: без скрытых, открытые - наверх. */
function shown(entries: FolderEntry[], data: Data): FolderEntry[] {
  const hidden = new Set(data.hidden.map(pathKey));
  const lively = (entry: FolderEntry) => (data.cardAt(entry.path) !== undefined ? 1 : 0);
  // sort устойчивый: внутри своей группы записи идут, как их отдал диск, - папки, потом файлы.
  return entries.filter((entry) => !hidden.has(pathKey(entry.path))).sort((a, b) => lively(b) - lively(a));
}

/** Состояния списка: читается, папки нет, не читается, пусто. */
function ListNote({ contents }: { contents: FolderRead | undefined }) {
  if (contents === undefined) return <div className="card__note">читаю...</div>;
  // Карточка остаётся на полотне: папка может вернуться, а связи и позиция нужны и без неё.
  if (contents === "missing") return <div className="card__missing">папки нет на диске</div>;
  if (contents === null) return <div className="card__note">папка не читается</div>;
  return <div className="card__note">пусто</div>;
}

/** Что делается с подпапкой в дереве, кроме раскрытия: своя карточка, терминал, заметка. */
type BranchActions = {
  card: () => void;
  terminal: () => void;
  note: () => void;
};

/** Меню записи: открыть и скрыть из списков; у подпапки в дереве - ещё карточки для неё. */
function EntryMenu({
  anchor,
  entry,
  actions,
  onOpen,
  onHide,
  onClose,
}: {
  anchor: HTMLElement;
  entry: FolderEntry;
  actions?: BranchActions;
  onOpen: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  return (
    <Menu anchor={anchor} label={entry.name} onClose={onClose}>
      <button type="button" role="menuitem" onClick={() => (onClose(), onOpen())}>
        <Icon name={entry.isDirectory ? "folder" : "file"} /> Открыть
      </button>
      {actions && (
        <>
          <button type="button" role="menuitem" onClick={() => (onClose(), actions.card())}>
            <Icon name="folder" /> Открыть отдельной карточкой
          </button>
          <button type="button" role="menuitem" onClick={() => (onClose(), actions.terminal())}>
            <Icon name="terminal" /> Терминал
          </button>
          <button type="button" role="menuitem" onClick={() => (onClose(), actions.note())}>
            <Icon name="note" /> Заметка
          </button>
        </>
      )}
      <button type="button" role="menuitem" onClick={() => (onClose(), onHide())}>
        <Icon name="eye" /> Скрыть
      </button>
    </Menu>
  );
}

/** Плитка папки на Root: значок, имя, язычок с меню. */
function Tile({ entry, data, onOpen }: { entry: FolderEntry; data: Data; onOpen: () => void }) {
  const menu = useMenu();
  const open = data.cardAt(entry.path) !== undefined;
  return (
    <div
      className={open ? "tile tile--open" : "tile"}
      style={{ "--pc": data.colorOf(entry.path) } as CSSProperties}
      data-path={entry.path}
    >
      <button type="button" className="tile__main nodrag" onClick={onOpen}>
        <Icon name="folder" />
        <span className="tile__name">{entry.name}</span>
      </button>
      <button
        type="button"
        className="tile__tab nodrag"
        aria-label={`Меню папки ${entry.name}`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        <Icon name="right" />
      </button>
      {menu.anchor && (
        <EntryMenu
          anchor={menu.anchor}
          entry={entry}
          onOpen={onOpen}
          onHide={() => data.hideEntry(entry.path, true)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/**
 * Строка папки или файла: значок, имя, меню "Открыть / Скрыть". В дереве у подпапки стрелка
 * раскрытия (expanded), нажатие раскрывает её на месте, а меню заводит для неё карточки (actions).
 */
function Row({
  entry,
  data,
  onOpen,
  expanded,
  actions,
}: {
  entry: FolderEntry;
  data: Data;
  onOpen: () => void;
  expanded?: boolean;
  actions?: BranchActions;
}) {
  const menu = useMenu();
  const open = data.cardAt(entry.path) !== undefined;
  const branch = expanded !== undefined;
  return (
    <li
      className={[
        "row",
        open && "row--open",
        expanded && "row--expanded",
      ]
        .filter(Boolean)
        .join(" ")}
      data-path={entry.path}
      style={
        open
          ? ({ "--pc": data.colorOf(entry.path) } as CSSProperties)
          : undefined
      }
    >
      <button type="button" className="row__main nodrag" onClick={onOpen} aria-expanded={branch ? expanded : undefined}>
        {/* У файла в дереве стрелки нет, но место под неё есть: значки строк стоят в один столбец. */}
        {(branch || data.tree) && (
          <span className={branch ? "row__chevron" : "row__chevron row__chevron--none"} aria-hidden="true">
            {branch && <Icon name="right" />}
          </span>
        )}
        <Icon name={entry.isDirectory ? "folder" : "file"} />
        {/* Косая черта после имени папки отличает её от файла не одним значком. */}
        <span className="row__name">{entry.isDirectory ? `${entry.name}/` : entry.name}</span>
      </button>
      <button
        type="button"
        className="row__tab nodrag"
        aria-label={`Меню ${entry.name}`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        <Icon name="dots" />
      </button>
      {menu.anchor && (
        <EntryMenu
          anchor={menu.anchor}
          entry={entry}
          actions={actions}
          onOpen={onOpen}
          onHide={() => data.hideEntry(entry.path, true)}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/**
 * Уровень дерева папки: записи, а под раскрытой подпапкой - её содержимое уровнем глубже, со своим
 * чтением и слежением за диском. Карточки для подпапки растут от карточки дерева (id).
 */
function TreeLevel({
  id,
  path,
  data,
  expanded,
  onToggle,
}: {
  id: string;
  path: string;
  data: Data;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
}) {
  const contents = useFolder(path);
  const open = useOpenEntry(id, data);
  // Уровень дочитывается позже карточки: из его строк тоже выходят связи, их места перемеряются.
  useLayoutEffect(() => {
    data.markPorts();
  });
  if (!contents || contents === "missing" || contents.total === 0) {
    return (
      <li className="tree__note">
        <ListNote contents={contents} />
      </li>
    );
  }
  const rest = contents.total - contents.entries.length;
  const actions = (entry: FolderEntry): BranchActions => ({
    card: () => open(entry),
    terminal: () => data.openCard(id, entry.path, "terminal"),
    note: () =>
      void window.noteApi.create(entry.path).then((file) => {
        if (file) data.openCard(id, file, "note");
      }),
  });
  return (
    <>
      {shown(contents.entries, data).map((entry) => {
        if (!entry.isDirectory) return <Row key={entry.path} entry={entry} data={data} onOpen={() => open(entry)} />;
        const unfolded = expanded.has(pathKey(entry.path));
        return (
          <Fragment key={entry.path}>
            <Row
              entry={entry}
              data={data}
              onOpen={() => onToggle(entry.path)}
              expanded={unfolded}
              actions={actions(entry)}
            />
            {unfolded && (
              <li className="tree__branch">
                <ul className="rows tree__level">
                  <TreeLevel id={id} path={entry.path} data={data} expanded={expanded} onToggle={onToggle} />
                </ul>
              </li>
            )}
          </Fragment>
        );
      })}
      {rest > 0 && <li className="card__note">...и ещё {rest}</li>}
    </>
  );
}

/** Root: папки каталога проектов плитками, файлы строками под ними. */
function RootBody({ id, data }: { id: string; data: Data }) {
  const contents = useFolder(data.path);
  const open = useOpenEntry(id, data);
  // Из плиток и строк выходят связи к открытым записям: после отрисовки их места перемеряются.
  useLayoutEffect(() => {
    data.markPorts();
  });
  if (!contents || contents === "missing" || contents.total === 0) return <ListNote contents={contents} />;
  const entries = shown(contents.entries, data);
  return (
    // nodrag и nowheel: внутри карточки прокрутка списка, а не перетаскивание и зум полотна.
    <div className="root__body scroll nodrag nowheel">
      <div className="tiles">
        {entries
          .filter((entry) => entry.isDirectory)
          .map((entry) => (
            <Tile key={entry.path} entry={entry} data={data} onOpen={() => open(entry)} />
          ))}
      </div>
      <ul className="rows root__files">
        {entries
          .filter((entry) => !entry.isDirectory)
          .map((entry) => (
            <Row key={entry.path} entry={entry} data={data} onOpen={() => open(entry)} />
          ))}
      </ul>
    </div>
  );
}

/** Путь папки от каталога проектов: полный путь длинный и одинаковый в начале у всех. */
function shortPath(path: string, root: string): string {
  if (!isInside(path, root)) return path;
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  return name + path.slice(root.replace(/[\\/]+$/, "").length).replace(/\\/g, "/");
}

/** Папка: путь с копированием полного и строки содержимого. */
function FolderBody({ id, data }: { id: string; data: Data }) {
  const contents = useFolder(data.path);
  const open = useOpenEntry(id, data);
  useLayoutEffect(() => {
    data.markPorts();
  });
  const [copied, setCopied] = useState(false);
  // Раскрытые подпапки дерева. Живут в карточке: вид папки на этот сеанс, а не часть раскладки.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(pathKey(path))) next.add(pathKey(path));
      return next;
    });
  const copy = () =>
    void navigator.clipboard.writeText(data.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  const rest = contents && contents !== "missing" ? contents.total - contents.entries.length : 0;
  return (
    <>
      <div className="card__path">
        <span className="card__path-text" title={data.path}>
          {shortPath(data.path, data.rootPath)}
        </span>
        <button type="button" className="copy nodrag" onClick={copy} title="Скопировать полный путь">
          {copied ? "скопировано" : <Icon name="copy" />}
        </button>
      </div>
      {!contents || contents === "missing" || contents.total === 0 ? (
        <ListNote contents={contents} />
      ) : data.tree ? (
        <ul className="rows rows--tree scroll nodrag nowheel">
          <TreeLevel id={id} path={data.path} data={data} expanded={expanded} onToggle={toggle} />
        </ul>
      ) : (
        <ul className="rows scroll nodrag nowheel">
          {shown(contents.entries, data).map((entry) => (
            <Row key={entry.path} entry={entry} data={data} onOpen={() => open(entry)} />
          ))}
          {rest > 0 && <li className="card__note">...и ещё {rest}</li>}
        </ul>
      )}
    </>
  );
}

/** Шапка карточки: лампочка, имя, меню и крестик. */
function CardHead({
  id,
  data,
  edit,
  onClose,
  menu,
  fileMode,
  onFileMode,
}: {
  id: string;
  data: Data;
  /** Правка файла в редакторе карточки. */
  edit: EditStatus;
  onClose: () => void;
  menu: ReactNode;
  /** Круглое полотно: html-файл открыт кодом или страницей в карточке. */
  fileMode?: FileMode;
  onFileMode?: (mode: FileMode) => void;
}) {
  // Крестик у папки уносит и всё, что из неё выросло; у терминала - его процесс; у файла
  // и заметки - только карточку, файл остаётся на диске. Корневая карточка не закрывается: без неё
  // полотно пустое, а завести первую заново нечем.
  const closable = id !== ROOT_CARD_ID;
  const title =
    data.kind === "folder"
      ? "Закрыть карточку и всё, что из неё выросло"
      : data.kind === "file" || data.kind === "note"
        ? "Закрыть карточку, файл останется на диске"
        : "Закрыть карточку и завершить оболочку";
  // Расширение файла - плашкой сразу за именем: md, png и json читаются раньше имени. Точка в начале
  // имени (.gitignore) - это не расширение.
  const dot = data.kind === "file" || data.kind === "note" ? data.name.lastIndexOf(".") : -1;
  const ext = dot > 0 ? data.name.slice(dot + 1) : undefined;
  const kind = KIND_TITLES[shellOf(id, data.kind, data.name)];
  if (data.atlas) {
    return (
      <AtlasHead
        data={data}
        edit={edit}
        fileMode={fileMode}
        onFileMode={onFileMode}
        close={
          closable && (
            <button type="button" className="card__close nodrag" onClick={onClose} title={title} aria-label={title}>
              <Icon name="close" />
            </button>
          )
        }
      />
    );
  }
  return (
    <header className={data.atlas ? "card__bar card__bar--atlas" : "card__bar"}>
      {data.atlas && (
        <AtlasTag
          data={data}
        />
      )}
      {/* Лампочка цвета проекта: по ней карточку относят к проекту, не читая пути. */}
      <span className="card__dot" role="img" aria-label={kind} title={kind} />
      <span className="card__title" title={ext ? data.name : undefined}>
        {
          ext ? data.name.slice(0, dot) : data.name
        }
      </span>
      {ext && <span className="card__ext">{ext}</span>}
      {/* Правка в редакторе: не сохранена, а если файл за это время сменился на диске - так и сказано. */}
      <EditMarks path={data.path} edit={edit} />
      {menu}
      {closable && (
        <button type="button" className="card__close nodrag" onClick={onClose} title={title} aria-label={title}>
          <Icon name="close" />
        </button>
      )}
    </header>
  );
}

/** Как открыт html-файл на круглом полотне: кодом или страницей в самой карточке. */
export type FileMode = "code" | "page";

const FILE_TABS = [
  ["code", "КОД", "Открыть кодом"],
  ["page", "БРАУЗЕР", "Открыть страницей в карточке"],
  ["ext", "ПК", "Открыть в браузере Windows"],
] as const;


/** Значок перед именем на плите: у терминала - его знак, у файла и заметки - контур. */
function HeadIcon({ data }: { data: Data }) {
  if (data.kind === "terminal") return <img className="card__lead" src={terminalIcon} alt="" title="терминал" />;
  return <Icon name={data.kind === "note" ? "note" : "file"} />;
}

/** Когда файл менялся: "ИЗМ. 5 МИН" справа в шапке, как в прототипе. Время берётся с диска и пересчитывается раз в
 *  полминуты. */
function useFileAge(path: string, on: boolean): string | null {
  const [mtime, setMtime] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () => void window.fileApi.read(path).then((info) => live && setMtime(info?.mtime ?? null));
    read();
    const timer = window.setInterval(() => (read(), tick((n) => n + 1)), 30000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [path, on]);
  return on && mtime ? `ИЗМ. ${age(mtime).toUpperCase()}` : null;
}

/**
  * Шапка плиты "керамика Atlas", как в прототипе: строка метки, значок и крупное имя; справа у
  * html-файла вкладки КОД, БРАУЗЕР, ПК, у файла - когда менялся; круглый красный крестик у всех.
 */
/** Правка файла в шапке: файл сменился на диске, пока его правили, - плашка, щелчок по ней берёт версию с диска; есть
 *  несохранённое - значок сохранения (то же, что Ctrl+S). */
function EditMarks({ path, edit }: { path: string; edit: EditStatus }) {
  return (
    <>
      {edit.stale && (
        <button type="button" className="card__edit nodrag" title="Файл сменился на диске, пока его правили. Щелчок - взять версию с диска, своя правка пропадёт" onClick={() => editCommand(path, "disk")}>
          изменён снаружи
        </button>
      )}
      {(edit.dirty || edit.stale) && (
        <button type="button" className="card__save nodrag" title={edit.stale ? "Сохранить свою правку поверх (Ctrl+S)" : "Сохранить (Ctrl+S)"} aria-label="Сохранить" onClick={() => editCommand(path, "save")}>
          <Icon name="save" />
        </button>
      )}
    </>
  );
}

function AtlasHead(props: {
  data: Data;
  edit: EditStatus;
  fileMode?: FileMode;
  onFileMode?: (mode: FileMode) => void;
  close: ReactNode;
}) {
  const { data, edit, fileMode, onFileMode, close } = props;
  const html = data.kind === "file" && /\.html?$/i.test(data.path);
  const fileAge = useFileAge(data.path, data.kind === "file" && !html);
  // Плашка справа на 2.5 с: "ОТКРЫТ ВНЕ" после ПК, итог "копировать файл".
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(timer);
  }, [flash]);
  // Имена, как в прототипе: у терминала и заметки - чем они являются, путь - в подсказке.
  const title = data.kind === "terminal" ? "терминал" : data.kind === "note" ? "заметка" : data.name;
  return (
    <header className="card__bar card__bar--atlas">
      <AtlasTag
        data={data}
      />
      {data.kind === "file" ? (
        // Значок файла тянется наружу, как из проводника: в мессенджер, в папку.
        <span
          className="card__grab nodrag nopan"
          draggable
          title="Перетащить файл в мессенджер или папку"
          onDragStart={(event) => (event.preventDefault(), window.fileApi.drag(data.path))}
        >
          <HeadIcon data={data} />
        </span>
      ) : (
        <HeadIcon data={data} />
      )}
      <span
        className="card__title"
        title={data.path}
      >
        {title}
      </span>
      <EditMarks path={data.path} edit={edit} />
      <span className="card__gap" />
      {html && (
        <span className="card__tabs nodrag">
          {FILE_TABS.map(([mode, label, tip]) => (
            <button
              key={mode}
              type="button"
              className={(fileMode ?? "code") === mode ? "on" : undefined}
              title={tip}
              onClick={() => {
                if (mode === "ext") {
                  void window.fileApi.outside(data.path);
                  setFlash({ text: "ОТКРЫТ ВНЕ", at: Date.now() });
                } else onFileMode?.(mode);
              }}
            >
              {label}
            </button>
          ))}
        </span>
      )}
      {flash && <span className="card__ago card__ago--out">{flash.text}</span>}
      {!flash && fileAge && <span className="card__ago">{fileAge}</span>}
      {close}
    </header>
  );
}


/** Строка над именем на плите Atlas: штрихкод, вид и папка; справа квадрат цвета проекта. */
function AtlasTag({ data }: { data: Data }) {
  return (
    <span
      className="card__tag"
    >
      <span className="card__bars" aria-hidden="true">
        {BARS.map((w, i) => (
          <i key={i} style={{ width: w }} />
        ))}
      </span>
      <span className="card__tag-text">
        {ATLAS_TAGS[data.kind]} /{" "}
        {
          data.atlas!.parent.toUpperCase()
        }
      </span>
      {
        <i className="card__sq" aria-hidden="true" />
      }
    </span>
  );
}


/**
 * Карточка на полотне из двух слоёв: задний несёт шапку и говорит о виде карточки, передний у всех
 * одинаковый. Файл и заметка - один передний слой. Свёрнутая карточка - одна шапка.
 */
export function CardNodeView(props: NodeProps<CardNode>) {
  // Папка и корень на круглом полотне - кольцо: свой вид и своё поведение, остальное карточка ниже.
  if (props.data.ring) return <RingCard id={props.id} data={props.data} />;
  return <CardShell {...props} />;
}

function RingCard({ id, data }: { id: string; data: Data }) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <RingNode id={id} data={data} />
    </>
  );
}

function CardShell({ id, data }: NodeProps<CardNode>) {
  const { openCard, path } = data;
  const openTerminal = useCallback(() => openCard(id, path, "terminal"), [openCard, path, id]);
  // Имя файла спрашивается диалогом в главном процессе, и он же заводит файл на диске:
  // карточка появляется, только когда заметке есть что показывать.
  const openNote = useCallback(() => {
    void window.noteApi.create(path).then((file) => {
      if (file) openCard(id, file, "note");
    });
  }, [openCard, path, id]);
  const { closeCard: close } = data;
  const closeCard = useCallback(() => close(id), [close, id]);
  // Обработчики берутся из данных по отдельности, а не целым data: они уходят внутрь терминала
  // и карточки файла, где смена обработчика не должна значить ничего, а сам объект данных нов
  // при смене любого своего поля.
  const { reportRun } = data;
  // Команда упала - карточка вспыхивает красным. Номер вспышки идёт ключом в разметку:
  // каждое падение перезапускает её, а не теряется в уже идущей.
  const [flash, setFlash] = useState(0);
  const [edit, setEdit] = useState<EditStatus>({ dirty: false, stale: false });
  // Круглое полотно: html-файл открыт кодом или страницей в самой карточке (вкладки шапки).
  const [fileMode, setFileMode] = useState<FileMode>("code");
  const onDone = useCallback(
    (run: CommandRun) => {
      if (run.code !== 0) setFlash((count) => count + 1);
    },
    [],
  );
  const onRun = useCallback((busy: boolean) => reportRun(id, busy), [reportRun, id]);

  const look = shellOf(id, data.kind, data.name);
  // Текстовому файлу и заметке задний слой не нужен: карточка - это сам передний слой.
  const flat = look === "file" || look === "note";
  const kind = [
    "card",
    `card--${look}`,
    flat && "card--flat",
    data.collapsed && "card--folded",
    data.running && "card--run",
    data.atlas && "card--atlas",
    data.atlas?.phase && `card--${data.atlas.phase} card--port-${data.atlas.port?.side ?? "y"}`,
  ];
  const body = (
    // Тело отделено от шапки, потому что заморозка гасит только его: у карточки, которую сейчас
    // не рисуют, имя остаётся видимым.
    <div className="card__body">
      {id === ROOT_CARD_ID && <RootBody id={id} data={data} />}
      {data.kind === "folder" && id !== ROOT_CARD_ID && <FolderBody id={id} data={data} />}
      {data.kind === "file" &&
        ((data.atlas && fileMode === "page") || /\.pdf$/i.test(data.path) || isVideo(data.path) ? (
          <BrowserBody path={data.path} />
        ) : (
          <FileBody
            path={data.path}
            onStatus={setEdit}
          />
        ))}
      {data.kind === "note" && (
        <NoteBody
          path={data.path}
        />
      )}
      {data.kind === "terminal" && (
        <TerminalBody
          path={data.path}
          card={id}
          onDone={onDone}
          onRun={onRun}
        />
      )}
    </div>
  );
  // Кружок графа стоит рядом с карточкой, а не вместо неё: снятая карточка закрыла бы свой терминал.
  const working = data.running;
  return (
    <>
      {data.graph && (
        <div className={working ? "gdot gdot--work" : "gdot"} style={{ "--pc": data.color } as CSSProperties} title={data.path}>
          <span className="gdot__label">{data.name}</span>
        </div>
      )}
      {/* Размер - одним уголком справа снизу, виден, когда мышь над карточкой. */}
      {!data.collapsed && !data.graph && (
        <NodeResizeControl className="resize" position="bottom-right" minWidth={data.atlas ? (ATLAS_MIN[data.kind]?.[0] ?? 220) : 220} minHeight={data.atlas ? (ATLAS_MIN[data.kind]?.[1] ?? 120) : 120}>
          <span className="resize__grip" aria-hidden="true" />
        </NodeResizeControl>
      )}
      {/* Точки крепления стрелок: слева входит родительская, справа выходят к потомкам. */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div
        className={[...kind, data.graph && "card--hidden"].filter(Boolean).join(" ")}
        // У корня - пропорция картинки на продолжении заднего слоя: из неё же обход связей считает его ширину.
        style={
          {
            "--pc": data.color,
            ...(id === ROOT_CARD_ID && { "--art-ratio": ROOT_ART_RATIO }),
            ...(data.atlas?.port && { "--port-x": `${data.atlas.port.x}px`, "--port-y": `${data.atlas.port.y}px` }),
          } as CSSProperties
        }
      >
        {flash > 0 && <div key={flash} className="card__flash" aria-hidden="true" />}
        <CardHead
          id={id}
          data={data}
          edit={edit}
          onClose={closeCard}
          fileMode={fileMode}
          onFileMode={setFileMode}
          menu={
            <CardMenu
              id={id}
              data={data}
              onTerminal={openTerminal}
              onNote={openNote}
            />
          }
        />
        {/* Свёрнутая карточка прячет тело, но не снимает его: терминал внутри живёт дальше. */}
        {flat ? body : <div className="card__front">{body}</div>}
      </div>
    </>
  );
}
