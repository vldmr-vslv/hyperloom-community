// Корень круглого полотна: эмблема в середине кольца, вращающийся декор вокруг и табличка Atlas, которая
// появляется миганием, пока мышь над эмблемой или над ней самой.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import rootArt from "./assets/root-art.jpg";
import type { Data } from "./Card";
import { CardMenu } from "./CardMenu";
import type { Hover } from "./Ring";
import { age, arc, f, ICON_FILE, ICON_FOLDER, pt, ticks } from "./ring-svg";

/** Что запущено на полотне: гравировка на ленте корня. */
export type Procs = { terminals: number };

/** Наведение на эмблему: табличка живёт, пока мышь над эмблемой или табличкой, и гаснет через паузу. */
export function useTagHover() {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  return useMemo(
    () => ({
      on,
      enter: () => {
        window.clearTimeout(timer.current);
        setOn(true);
      },
      leave: () => {
        timer.current = window.setTimeout(() => setOn(false), 450);
      },
    }),
    [on],
  );
}
export type TagHover = ReturnType<typeof useTagHover>;

export function RootCore({ R, tag }: { R: number; tag: TagHover }) {
  const e = R * 0.66;
  // Масштаб картинки в круге: при 0.8 её ширина равна диаметру, края чёрные, как круг под ней.
  const k = e * 0.8;
  return (
    <g onMouseEnter={tag.enter} onMouseLeave={tag.leave}>
      <clipPath id="root-emblem">
        <circle r={e} />
      </clipPath>
      <circle r={e} fill="#000" />
      <image href={rootArt} x={-k * 1.25} y={-k} width={k * 2.5} height={k * 2} preserveAspectRatio="xMidYMid slice" clipPath="url(#root-emblem)" />
    </g>
  );
}

/** Два кольца делений вокруг корня крутит композитор: свой слой, полотно не перерисовывается. Крутится обёртка, а не
 *  svg: поворот самого svg композитор не берёт (Electron 44), и он гонял бы полный кадр окна 60 раз в секунду. */
export function RootDeco({ R }: { R: number }) {
  const size = 2 * (R + 80);
  const box = `${-size / 2} ${-size / 2} ${size} ${size}`;
  const style = { width: size, height: size, margin: `${-size / 2}px 0 0 ${-size / 2}px` } as CSSProperties;
  return (
    <div className="ring__deco" aria-hidden="true">
      <div className="ring__deco-a" style={style}>
        <svg viewBox={box}>
          <circle r={R + 76} fill="none" stroke="rgb(255 255 255 / .1)" />
          <path d={ticks(R + 72, R + 76, 3)} stroke="rgb(255 255 255 / .14)" />
          <path d={ticks(R + 68, R + 76, 30)} stroke="rgb(255 255 255 / .2)" />
        </svg>
      </div>
      <div className="ring__deco-b" style={style}>
        <svg viewBox={box}>
          {[[18, 52], [70, 76], [128, 170], [210, 216], [300, 330]].map(([a, b]) => (
            <path key={a} d={arc(R + 62, a, b)} fill="none" stroke="rgb(255 255 255 / .22)" strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </svg>
      </div>
    </div>
  );
}


const BARS = [1, 2, 1, 3, 1, 1, 2, 1, 4, 1, 2, 1, 1, 3, 1, 2];
/** Направления таблички от корня по порядку: над ним, наискосок, сбоку, под ним. */
const SPOTS = [-90, -125, -55, -150, -30, 180, 0, 90];
const TAG_W = 272;

type Box = { x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Табличка Atlas у корня: число проектов, состав (наведение - водопад), давность, сколько открыто и меню папки корня.
 * Встаёт над кольцом, а мешает соседняя карточка - наискосок или сбоку. От кромки к ней идёт связь.
 * ponytail: восемь направлений по порядку, без поиска лучшего.
 */
export function RootTag(props: {
  R: number;
  side: number;
  at: { x: number; y: number };
  around: Box[];
  folders: number;
  files: number;
  open: number;
  newest: number;
  name: string;
  data: Data;
  id: string;
  tag: TagHover;
  hover: Hover;
}) {
  const { R, side, at, around, folders, files, open, newest, name, data, id, tag, hover } = props;
  const el = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(190);
  const [ever, setEver] = useState(false);
  // Подпись в правке: табличка не гаснет, пока мышь вне её, иначе набранное пропадёт из виду.
  const [draft, setDraft] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (tag.on) setEver(true);
    if (el.current) setH(el.current.offsetHeight);
  }, [tag.on, draft === null]);
  const title = data.title ?? name;
  const rename = (next: string) => {
    const clean = next.trim();
    data.nameRoot(clean && clean !== name ? clean : undefined);
    setDraft(null);
  };
  const spot = useMemo(() => {
    for (const a of SPOTS) {
      const ext = Math.abs(Math.cos((a * Math.PI) / 180)) * (TAG_W / 2) + Math.abs(Math.sin((a * Math.PI) / 180)) * (h / 2);
      const [dx, dy] = pt(R + 66 + ext, a);
      const box = { x: at.x + dx - TAG_W / 2, y: at.y + dy - h / 2, w: TAG_W, h };
      if (!around.some((b) => hits(box, b))) return { a, dx, dy };
    }
    const [dx, dy] = pt(R + 66 + h / 2, -90);
    return { a: -90, dx, dy };
  }, [R, at, around, h]);
  const [rx, ry] = pt(R + 17, spot.a);
  const tx = spot.dx - (Math.cos((spot.a * Math.PI) / 180) * TAG_W) / 2;
  const ty = spot.dy - (Math.sin((spot.a * Math.PI) / 180) * h) / 2;
  const state = tag.on ? "on" : ever ? "off" : "";
  const c = side / 2;
  return (
    <>
      <svg className={`root-link root-link--${state || "none"}`} width={side} height={side} viewBox={`${-c} ${-c} ${side} ${side}`}>
        <path d={`M${f(rx)} ${f(ry)}L${f(tx)} ${f(ty)}`} stroke="#e8ecf4" strokeOpacity=".16" strokeWidth="7" />
        <path className="root-link__main" d={`M${f(rx)} ${f(ry)}L${f(tx)} ${f(ty)}`} stroke="#e8ecf4" strokeWidth="1.6" />
      </svg>
      <div
        ref={el}
        className={`root-tag nodrag nowheel ${state && `root-tag--${state}`}`}
        style={{ left: c + spot.dx - TAG_W / 2, top: c + spot.dy - h / 2, width: TAG_W }}
        onMouseEnter={tag.enter}
        onMouseLeave={draft === null ? tag.leave : undefined}
      >
        <div className="root-tag__plate">
          <div className="root-tag__top">
            <span className="root-tag__bars">
              {BARS.map((w, i) => (
                <i key={i} style={{ width: w }} />
              ))}
            </span>
            <span>
              ROOT / 001
              <i className="root-tag__sq" />
            </span>
          </div>
          <div className="root-tag__cls">{name.toUpperCase()}</div>
          <div className="root-tag__big">
            <span className="root-tag__num">{String(folders).padStart(2, "0")}</span>
            {draft === null ? (
              <span
                className="root-tag__name"
                data-tip="Переименовать"
                role="button"
                tabIndex={0}
                onClick={() => setDraft(title)}
                onKeyDown={(event) => event.key === "Enter" && setDraft(title)}
              >
                {title}
              </span>
            ) : (
              <input
                className="root-tag__name root-tag__input"
                aria-label="Подпись корня"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => setDraft(null)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") rename(draft);
                  if (event.key === "Escape") setDraft(null);
                }}
              />
            )}
          </div>
          {draft !== null && (
            <div className="root-tag__picks">
              {[name, "Root", "Projects"].map((pick) => (
                // mousedown без фокуса: иначе поле теряет фокус и закрывается раньше щелчка.
                <button key={pick} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => rename(pick)}>
                  {pick}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="root-tag__rows">
          <div className="root-tag__row root-tag__row--act" onMouseEnter={(event) => hover.enter(event.currentTarget)} onMouseLeave={hover.leave}>
            <b>СОСТАВ</b>
            <span>
              <svg width="13" height="11" viewBox="-6.5 -5 13 11">
                <path d={ICON_FOLDER} fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
              {folders}
              <svg width="10" height="12" viewBox="-5 -5.5 10 12">
                <path d={ICON_FILE} fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
              {files}
            </span>
          </div>
          <div className="root-tag__row">
            <b>ИЗМЕНЕНИЯ</b>
            <span>{newest ? `${age(newest).toUpperCase()} НАЗАД` : "-"}</span>
          </div>
          <div className="root-tag__row">
            <b>ОТКРЫТО</b>
            <span>
              {open} ИЗ {folders}
            </span>
          </div>
          <div className="root-tag__row root-tag__row--act">
            <b>ПАПКА</b>
            <span>
              {name.toUpperCase().slice(0, 16)}
              <CardMenu
                id={id}
                data={data}
                onTerminal={() => data.openCard(id, data.path, "terminal")}
                onNote={() => void window.noteApi.create(data.path).then((file) => file && data.openCard(id, file, "note"))}
              />
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
