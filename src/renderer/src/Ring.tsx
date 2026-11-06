// Папка и корень на круглом полотне (тёмная тема, _scratch/root-dial): кольцо из тёмной керамики. На ободе - подпапки
// сегментами, в середине - имя, давность и кнопки, вокруг - лента с путём. Щелчок по сегменту раскрывает ветку
// списком (RingBranch.tsx), Ctrl+щелчок открывает подпапку своим кольцом.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FolderEntry } from "../../preload";
import { isInside, pathKey, ROOT_CARD_ID, type CardKind } from "../../shared/canvas-model";
import type { Pt } from "../../shared/route";
import type { Data } from "./Card";
import { Drawer } from "./Drawer";
import { useFolder } from "./folder";
import { flyCenter } from "./freeze";
import { useReactFlow } from "@xyflow/react";
import { RingBranches } from "./RingBranch";
import { PaintFan, freeAngle } from "./RingFans";
import { RootCore, RootDeco, RootTag, useTagHover, type Procs } from "./RingRoot";
import { angleTo, FOLDER_R, layoutAngles, RIM, ROOT_R } from "./rings";
import { age, arc, circlePath, cut, f, ICON_FILE, ICON_FOLDER, sector, service, tangentTurn, ticks, pt } from "./ring-svg";
import { still } from "./ice";

/** Карточка, выросшая из кольца: подпапка своим кольцом, файл, терминал, заметка. at - её середина. */
export type RingKid = { id: string; path: string; kind: CardKind; at: Pt };

/** Что кольцу даёт полотно (App.tsx). Нет - карточка рисуется прежней карточкой. */
export type RingInfo = {
  /** Середина кольца на полотне. */
  at: Pt;
  kids: RingKid[];
  /** Середина родителя: с его стороны в кольцо входит связь. */
  parent: Pt | null;
  /** Открыта ветка этого кольца: оно над всем полотном, остальное размыто. */
  browsing: boolean;
  browse: (on: boolean) => void;
  /** Только что открыто - разворачивается импульсом; закрывается - сворачивается обратно. */
  phase: "born" | "dying" | null;
  /** Корень: что запущено на полотне. */
  procs: Procs | null;
  /** Корень: прямоугольники других карточек рядом - табличка встаёт туда, где их нет. */
  around: { x: number; y: number; w: number; h: number }[];
  /** Папка прочитана: проект ли она (под своим git). По этому частицы знают, где кончается путь к проекту. */
  onProject: (project: boolean) => void;
};

/** Наведение на водопад: войти (с местом, у которого он встаёт) и уйти - он закроется через паузу. */
export type Hover = { enter: (anchor?: Element) => void; leave: () => void };

/** Сколько подпапок стоит на ободе, кроме открытых. */
const TOP = 5;
const ROOT_TOP = 11;

const ACTIONS = [
  ["terminal", "M-4 -2.5L-1.5 0L-4 2.5M0 3H4", "Терминал"],
  ["note", "M-3.5 -3H3.5M-3.5 0H3.5M-3.5 3H1.5", "Заметка"],
  ["paint", "", "Цвет проекта"],
  ["close", "M-3 -3L3 3M3 -3L-3 3", "Закрыть и всё, что выросло"],
] as const;
type Act = (typeof ACTIONS)[number][0];

/** Путь папки для ленты: от каталога проектов, с его именем впереди. */
function shownPath(path: string, root: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const p = norm(path);
  const name = r.split("/").pop() ?? r;
  return p.toLowerCase().startsWith(r.toLowerCase() + "/") ? `${name}/${p.slice(r.length + 1)}` : p;
}

/** Подпапки на ободе: открытые своим кольцом и самые свежие, служебных нет. */
function segmentsOf(dirs: FolderEntry[], kids: RingKid[], top: number): FolderEntry[] {
  const open = new Set(kids.filter((k) => k.kind === "folder").map((k) => pathKey(k.path)));
  const opened = dirs.filter((d) => open.has(pathKey(d.path)));
  const ranked = dirs.filter((d) => !service(d.name)).sort((a, b) => b.mtime - a.mtime);
  return [...new Set([...opened, ...ranked])].slice(0, Math.max(top, opened.length));
}

export function RingNode({ id, data }: { id: string; data: Data }) {
  const ring = data.ring!;
  const root = id === ROOT_CARD_ID;
  const R = root ? ROOT_R : FOLDER_R;
  const side = 2 * (R + RIM + 1);
  const inner = R * 0.7;
  const uid = useId().replace(/:/g, "");
  const flow = useReactFlow();
  const contents = useFolder(data.path);
  const entries = contents && typeof contents === "object" ? contents.entries : [];
  const hidden = useMemo(() => new Set(data.hidden.map(pathKey)), [data.hidden]);
  const visible = entries.filter((e) => !hidden.has(pathKey(e.path)));
  const dirs = visible.filter((e) => e.isDirectory);
  const folders = entries.filter((e) => e.isDirectory).length;
  const files = contents && typeof contents === "object" ? contents.total - folders : 0;
  const segs = segmentsOf(dirs, ring.kids, root ? ROOT_TOP : TOP);
  const span = root ? 30 : 38;
  const angles = useMemo(() => {
    const byPath = new Map(ring.kids.map((k) => [pathKey(k.path), k]));
    const onRim = new Set(segs.map((s) => pathKey(s.path)));
    return layoutAngles([
      ...segs.map((s) => {
        const kid = byPath.get(pathKey(s.path));
        return { id: s.path, want: kid ? angleTo(ring.at, kid.at) : undefined, span };
      }),
      ...ring.kids.filter((k) => !onRim.has(pathKey(k.path))).map((k) => ({ id: k.id, want: angleTo(ring.at, k.at), span: 10 })),
    ]);
    // Углы пересчитываются, когда сменился набор сегментов или сдвинулись карточки вокруг.
  }, [segs.map((s) => s.path).join("|"), JSON.stringify(ring.kids), ring.at.x, ring.at.y, span]);

  // Раскрытое в ветках: сегменты и папки внутри веток. Есть раскрытое - кольцо над всем полотном.
  const [exp, setExp] = useState<ReadonlySet<string>>(() => new Set());
  const [pick, setPick] = useState<"paint" | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [drawer, setDrawer] = useState<Element | null>(null);
  // Водопад живёт, пока мышь над плашкой счётчиков (у корня - строкой таблички) или над ним самим.
  const leave = useRef(0);
  const hover = useMemo(
    () => ({
      enter: (anchor?: Element) => {
        window.clearTimeout(leave.current);
        if (anchor) setDrawer(anchor);
      },
      leave: () => {
        leave.current = window.setTimeout(() => setDrawer(null), 350);
      },
    }),
    [],
  );
  const tag = useTagHover();
  const host = useRef<HTMLDivElement>(null);
  const browsing = exp.size > 0;
  const project = entries.some((e) => e.name === ".git");
  const onProject = useRef(ring.onProject);
  onProject.current = ring.onProject;
  useEffect(() => {
    if (contents !== undefined) onProject.current(project);
  }, [contents, project]);
  // Обработчик полотна новый на каждой отрисовке: зовётся только по смене, иначе кольца сбивали бы друг другу ветку.
  const browse = useRef(ring.browse);
  browse.current = ring.browse;
  useEffect(() => {
    if (!browsing) return;
    browse.current(true);
    return () => browse.current(false);
  }, [browsing]);
  // Щелчок мимо кольца и Esc закрывают его ветки и выборы.
  useEffect(() => {
    if (!browsing && !pick) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      if (host.current?.contains(target) || target.closest(".drawer, .menu")) return;
      setExp(new Set());
      setPick(null);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExp(new Set());
      setPick(null);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [browsing, pick]);

  const toggleExp = (path: string) =>
    setExp((was) => {
      const next = new Set(was);
      if (!next.has(path)) return next.add(path);
      for (const p of was) if (pathKey(p) === pathKey(path) || isInside(p, path)) next.delete(p);
      return next;
    });
  const flyTo = (path: string) => {
    const at = data.cardAt(path);
    if (at) flyCenter(flow, at.x + at.width / 2, at.y + at.height / 2, 1, still() ? 0 : 500);
    return at !== undefined;
  };
  // Сегмент: открытая подпапка - камера к ней; Ctrl, корень или пустая папка - открыть кольцом; иначе - ветка.
  const onSegment = (entry: FolderEntry, ctrl: boolean, a: number) => {
    if (flyTo(entry.path)) return;
    if (root || ctrl) return data.openCard(id, entry.path, "folder", undefined, at(R + 150 + 112, a));
    toggleExp(entry.path);
  };
  const at = (r: number, a: number): Pt => {
    const [x, y] = pt(r, a);
    return { x: ring.at.x + x, y: ring.at.y + y };
  };
  const act = (what: Act) => {
    setDrawer(null);
    if (what === "paint") return setPick((was) => (was === what ? null : what));
    setPick(null);
    if (what === "close") return data.closeCard(id);
    if (what === "terminal") return data.openCard(id, data.path, "terminal");
    void window.noteApi.create(data.path).then((file) => file && data.openCard(id, file, "note"));
  };
  const copy = () => {
    void navigator.clipboard.writeText(data.path).then(
      () => setCopied(true),
      () => setCopied(false),
    );
    window.setTimeout(() => setCopied(null), 1400);
  };

  const used = [...ring.kids.map((k) => angleTo(ring.at, k.at)), ...(ring.parent ? [angleTo(ring.at, ring.parent)] : [])];
  const fanAt = freeAngle(used);
  const band = `${uid}-band`;
  const where = shownPath(data.path, data.rootPath).toUpperCase();
  const engraving =
    copied !== null
      ? copied
        ? `ПУТЬ СКОПИРОВАН / ${data.path.toUpperCase().replace(/\\/g, "/")}`
        : "ПУТЬ НЕ СКОПИРОВАН"
      : root
        ? `${folders} FOLDERS / ${files} FILES / ${data.path.toUpperCase().replace(/\\/g, "/")}`
        : `${where} / ${folders} FOLDERS / ${files} FILES`;
  const lr = (inner + 5 + R - 5) / 2 + 1;
  const cls = ["ring", root && "ring--root", ring.phase && `ring--${ring.phase}`, browsing && "ring--browsing"].filter(Boolean).join(" ");
  return (
    <div ref={host} className={cls} style={{ width: side, height: side, "--pc": data.color } as CSSProperties}>
      {root && <RootDeco R={R} />}
      <svg className="ring__svg" width={side} height={side} viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}>
        <defs>
          <linearGradient id={`${uid}-ceramic`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#31312f" />
            <stop offset=".5" stopColor="#1f1f1e" />
            <stop offset="1" stopColor="#121211" />
          </linearGradient>
          <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c2c2a" />
            <stop offset="1" stopColor="#171716" />
          </linearGradient>
          <radialGradient id={`${uid}-lens`}>
            <stop offset="0" stopColor="#1c1c1b" />
            <stop offset="1" stopColor="#050505" />
          </radialGradient>
        </defs>
        <g className="ring__frame">
          <g className="ring__band nodrag" onClick={copy} data-tip="Скопировать полный путь">
            <path id={band} d={circlePath(R + 11)} fill="none" stroke="#171716" strokeWidth="12" />
            <text dominantBaseline="central" className={copied !== null ? "ring__engrave ring__engrave--lit" : "ring__engrave"}>
              <textPath href={`#${band}`} startOffset="1%">
                {root && copied === null && ring.procs ? <RootCounts procs={ring.procs} label={data.title ?? data.name} /> : null}
                {engraving}
              </textPath>
            </text>
          </g>
          <circle r={R + 5} fill="none" stroke="rgb(255 255 255 / .1)" />
          <circle r={R + 17} fill="none" stroke="rgb(255 255 255 / .1)" />
          <circle r={(inner + R) / 2} fill="none" stroke={`url(#${uid}-ceramic)`} strokeWidth={R - inner} />
          <circle r={R} fill="none" stroke="rgb(255 255 255 / .2)" />
          <circle r={inner} fill="none" stroke="#000" strokeWidth="2" />
          <path d={ticks(R - 4, R - 1, 2.5)} fill="none" stroke="rgb(255 255 255 / .07)" />
        </g>
        {ring.phase === "born" && <circle className="ring__wave" r={R + 17} fill="none" stroke="#f3f3f1" strokeWidth="2" />}
        {segs.map((entry, i) => {
          const a = angles.get(entry.path) ?? 0;
          const open = data.cardAt(entry.path) !== undefined;
          const color = data.colorOf(entry.path);
          const room = Math.floor((((span * Math.PI) / 180) * lr) / (root ? 6.6 : 6.2));
          const [tx, ty] = pt(lr, a);
          return (
            <g key={entry.path} className="ring__win" style={{ "--i": i } as CSSProperties}>
              <g
                className="ring__seg nodrag"
                data-path={entry.path}
                onClick={(event) => onSegment(entry, event.ctrlKey, a)}
                data-tip={`${entry.name}: щелчок - ${open ? "к кольцу" : root ? "открыть" : "ветка"}, Ctrl+щелчок - своим кольцом`}
              >
                <path
                  d={sector(inner + 5, R - 5, a - span / 2, a + span / 2)}
                  fill={open ? color : "#080808"}
                  fillOpacity={open ? 0.15 : 1}
                  stroke={open ? color : "rgb(255 255 255 / .1)"}
                  strokeOpacity={open ? 0.65 : 1}
                />
                <path d={sector(inner + 6, inner + 9, a - span / 2 + 2, a + span / 2 - 2)} fill={open ? color : "#2b2b2a"} />
                <text
                  x={f(tx)}
                  y={f(ty)}
                  transform={`rotate(${f(tangentTurn(a))} ${f(tx)} ${f(ty)})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={open ? "ring__name ring__name--open" : "ring__name"}
                  style={{ fontSize: root ? 11 : 10.5 }}
                >
                  {cut(entry.name, room)}
                </text>
                {open && <path d={arc(R + 1, a - span / 2 + 3, a + span / 2 - 3)} fill="none" stroke={color} strokeWidth="3" />}
                {exp.has(entry.path) && (
                  <path d={arc(R + 3, a - span / 2 + 2, a + span / 2 - 2)} fill="none" stroke={color} strokeWidth="5" strokeOpacity=".8" />
                )}
              </g>
            </g>
          );
        })}
        <g className="ring__core">
          {root ? (
            <RootCore R={R} tag={tag} />
          ) : (
            <FolderCore
              uid={uid}
              inner={inner}
              name={data.name}
              project={project}
              read={contents !== undefined}
              newest={Math.max(0, ...entries.map((e) => e.mtime))}
              color={data.color}
              pick={pick}
              folders={folders}
              files={files}
              onAct={act}
              hover={hover}
            />
          )}
        </g>
        {pick === "paint" && <PaintFan R={R} a={fanAt} color={data.color} onPaint={(hex) => data.paintFolder(data.path, hex)} />}
      </svg>
      <RingBranches
        side={side}
        R={R}
        segs={segs.filter((s) => exp.has(s.path))}
        angles={angles}
        exp={exp}
        color={data.color}
        hidden={hidden}
        onToggle={toggleExp}
        onFile={(path) => data.openCard(id, path, "file")}
        onRing={(path) => {
          setExp(new Set());
          if (!flyTo(path)) data.openCard(id, path, "folder");
        }}
      />
      {root && (
        <RootTag
          R={R}
          side={side}
          at={ring.at}
          around={ring.around}
          folders={folders}
          files={files}
          open={ring.kids.filter((k) => k.kind === "folder").length}
          newest={Math.max(0, ...entries.map((e) => e.mtime))}
          name={data.name}
          data={data}
          id={id}
          tag={tag}
          hover={hover}
        />
      )}
      {drawer && (
        <Drawer
          anchor={drawer}
          name={data.name}
          entries={visible}
          folders={folders}
          files={files}
          cut={!!contents && typeof contents === "object" && contents.total > contents.entries.length}
          onRim={new Set(segs.map((s) => pathKey(s.path)))}
          isOpen={(path) => data.cardAt(path) !== undefined}
          colorOf={data.colorOf}
          hover={hover}
          hidden={data.hidden.filter((path) => pathKey(path.replace(/[\\/][^\\/]*$/, "")) === pathKey(data.path))}
          onHide={data.hideEntry}
          onOpen={(entry) => {
            setDrawer(null);
            if (!flyTo(entry.path)) data.openCard(id, entry.path, entry.isDirectory ? "folder" : "file");
          }}
        />
      )}
    </div>
  );
}

/** Числа в начале ленты корня: терминалы. */
function RootCounts({ procs, label }: { procs: Procs; label: string }) {
  return (
    <>
      {`${label.toUpperCase()} / `}
      <tspan className="ring__count">{procs.terminals}</tspan>
      {" TERMINALS / "}
    </>
  );
}

/** Середина кольца папки: проект или папка, имя, давность, кнопки и плашка счётчиков. */
function FolderCore(props: {
  uid: string;
  inner: number;
  name: string;
  project: boolean;
  read: boolean;
  newest: number;
  color: string;
  pick: "paint" | null;
  folders: number;
  files: number;
  onAct: (what: Act) => void;
  hover: Hover;
}) {
  const { uid, inner, name, project, read, newest, color, pick, folders, files, onAct, hover } = props;
  const c = inner - 1;
  return (
    <>
      <circle r={c} fill={`url(#${uid}-lens)`} stroke="rgb(255 255 255 / .1)" />
      <g pointerEvents="none">
        <circle r={c * 0.78} fill="none" stroke="rgb(255 255 255 / .07)" strokeDasharray="3 4" />
        <text y="-38" textAnchor="middle" className="ring__kind">
          {project ? "ПРОЕКТ" : "ПАПКА"}
        </text>
        <text y="-17" textAnchor="middle" className="ring__title">
          {cut(name, 11)}
        </text>
        <text y="-4" textAnchor="middle" className="ring__age">
          {!read ? "не прочитана" : newest ? `менялась ${age(newest)} назад` : ""}
        </text>
      </g>
      {/* Цвет назначается только проекту: папка берёт его от проекта, и кнопки цвета у неё нет. */}
      {ACTIONS.filter(([what]) => what !== "paint" || project).map(([what, icon, title], i, shown) => {
        const on = pick === what;
        return (
          <g key={what} className="ring__act nodrag" transform={`translate(${(i - (shown.length - 1) / 2) * 22} 15)`} onClick={() => onAct(what)} data-tip={title}>
            <circle r="8.5" className={on ? "ring__act-bg ring__act-bg--on" : "ring__act-bg"} stroke={what === "close" ? "rgb(245 91 91 / .45)" : on ? "#f3f3f1" : "rgb(255 255 255 / .25)"} />
            {what === "paint" ? (
              <circle r="4" fill={color} />
            ) : (
              <path d={icon} fill="none" stroke={what === "close" ? "#f08b8b" : "#d6d6d3"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </g>
        );
      })}
      <g className="ring__plate nodrag" onMouseEnter={(event) => hover.enter(event.currentTarget)} onMouseLeave={hover.leave}>
        <rect x={-43} y={32} width={86} height={22} rx={5} fill={`url(#${uid}-plate)`} stroke="rgb(255 255 255 / .18)" />
        <path transform="translate(-27 43)" d={ICON_FOLDER} fill="none" stroke="#cfcfcc" strokeWidth="1.2" />
        <text x={-17} y={47} className="ring__num">
          {folders}
        </text>
        <path transform="translate(8 43)" d={ICON_FILE} fill="none" stroke="#9a9a97" strokeWidth="1.2" />
        <text x={17} y={47} className="ring__num ring__num--files">
          {files}
        </text>
      </g>
    </>
  );
}
