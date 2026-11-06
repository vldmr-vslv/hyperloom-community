// Ветка кольца списком, дизайн "керамика": плита за ободом у сегмента, подпапки раскрываются на месте, файлы видны
// все со значком по виду. Каждый раскрытый уровень читается и отслеживается сам.
import type { CSSProperties } from "react";
import type { FolderEntry } from "../../preload";
import { pathKey } from "../../shared/canvas-model";
import { useFolder } from "./folder";
import { Icon } from "./Icon";
import { age, cut, f, FILE_ICON, fileKind, ICON_FOLDER, plural, pt, service } from "./ring-svg";

/** Подпапок в уровне ветки и файлов до строки "и ещё N". */
const DIRS_SHOWN = 8;
const FILES_SHOWN = 10;

type Props = {
  side: number;
  R: number;
  /** Раскрытые сегменты кольца. */
  segs: FolderEntry[];
  angles: ReadonlyMap<string, number>;
  exp: ReadonlySet<string>;
  color: string;
  hidden: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onFile: (path: string) => void;
  /** Подпапка своим кольцом на полотне. */
  onRing: (path: string) => void;
};

export function RingBranches(props: Props) {
  const { side, R, segs, angles, color } = props;
  if (segs.length === 0) return null;
  return (
    <>
      <svg className="branch__wires" width={side} height={side} viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}>
        {segs.map((seg) => {
          const a = angles.get(seg.path) ?? 0;
          const [sx, sy] = pt(R + 2, a);
          const [ax, ay] = pt(R + 22, a);
          return <path key={seg.path} d={`M${f(sx)} ${f(sy)}L${f(ax)} ${f(ay)}`} stroke={color} strokeWidth="1.5" />;
        })}
      </svg>
      {segs.map((seg) => {
        const a = angles.get(seg.path) ?? 0;
        const [ax, ay] = pt(R + 22, a);
        const right = Math.cos((a * Math.PI) / 180) >= 0;
        const style = { left: side / 2 + ax, top: side / 2 + ay, "--pc": color } as CSSProperties;
        return (
          <div key={seg.path} className={right ? "branch nodrag nowheel" : "branch branch--left nodrag nowheel"} style={style}>
            <Level {...props} path={seg.path} depth={0} head={seg.name} />
          </div>
        );
      })}
    </>
  );
}

/** Уровень ветки: заголовок у первого, подпапки (раскрытые - со своим уровнем глубже), потом файлы. */
function Level(props: Props & { path: string; depth: number; head?: string }) {
  const { path, depth, head, exp, hidden, onToggle, onFile, onRing } = props;
  const contents = useFolder(path);
  const entries = contents && typeof contents === "object" ? contents.entries.filter((e) => !hidden.has(pathKey(e.path))) : [];
  const dirs = entries.filter((e) => e.isDirectory && !service(e.name)).sort((a, b) => b.mtime - a.mtime).slice(0, DIRS_SHOWN);
  const files = entries.filter((e) => !e.isDirectory);
  const pad = { "--depth": depth } as CSSProperties;
  return (
    <>
      {head !== undefined && (
        <div className="branch__head">
          {head.toUpperCase()} / {entries.filter((e) => e.isDirectory).length}/{files.length}
        </div>
      )}
      {contents === undefined && <div className="branch__note" style={pad}>читаю...</div>}
      {contents === "missing" && <div className="branch__note" style={pad}>папки нет на диске</div>}
      {contents === null && <div className="branch__note" style={pad}>не читается</div>}
      {dirs.map((dir) => {
        const open = exp.has(dir.path);
        return (
          <div key={dir.path} className="branch__item">
            <button
              type="button"
              className={["branch__row", open && "branch__row--open", depth > 0 && "branch__row--deep"].filter(Boolean).join(" ")}
              style={pad}
              onClick={(event) => (event.ctrlKey ? onRing(dir.path) : onToggle(dir.path))}
              title={`${dir.name}: щелчок - раскрыть, Ctrl+щелчок - своим кольцом на полотне`}
            >
              <svg className="branch__ico" width="12" height="12" viewBox="-6 -6 12 12">
                <path d={open ? "M-3 -1.5L0 1.5L3 -1.5" : "M-1.5 -3L1.5 0L-1.5 3"} fill="none" stroke="#cfcfcc" strokeWidth="1.2" />
              </svg>
              <svg className="branch__ico" width="12" height="12" viewBox="-6.5 -5 13 11">
                <path d={ICON_FOLDER} fill="none" stroke="var(--pc)" strokeWidth="1.3" />
              </svg>
              <span className="branch__name">{cut(dir.name, 20)}</span>
              <span className="branch__meta">{age(dir.mtime)}</span>
            </button>
            <button type="button" className="branch__ring" title="Открыть своим кольцом на полотне" onClick={() => onRing(dir.path)}>
              <Icon name="ring" />
            </button>
            {open && <Level {...props} path={dir.path} depth={depth + 1} head={undefined} />}
          </div>
        );
      })}
      {files.slice(0, FILES_SHOWN).map((file) => {
        const [d, c] = FILE_ICON[fileKind(file.name)];
        return (
          <button key={file.path} type="button" className={depth > 0 ? "branch__row branch__row--file branch__row--deep" : "branch__row branch__row--file"} style={pad} onClick={() => onFile(file.path)} title={`${file.name}: щелчок - открыть карточкой`}>
            <span className="branch__ico" />
            <svg className="branch__ico" width="12" height="12" viewBox="-6 -6 12 12">
              <path d={d} transform="scale(.9)" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span className="branch__name">{cut(file.name, 22)}</span>
            <span className="branch__meta">{age(file.mtime)}</span>
          </button>
        );
      })}
      {files.length > FILES_SHOWN && (
        <div className="branch__note" style={pad}>
          и ещё {files.length - FILES_SHOWN} {plural(files.length - FILES_SHOWN, ["файл", "файла", "файлов"])}
        </div>
      )}
    </>
  );
}
