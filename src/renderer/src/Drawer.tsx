// Водопад: все папки и файлы кольца списком, свежие сверху. Выпадает у плашки счётчиков (у корня - у строки
// "СОСТАВ" таблички), живёт, пока мышь над ней или над ним. Щелчок открывает запись карточкой у кольца, "скрыть" у
// строки убирает запись с кольца и из списков, скрытые - в конце списка с возвратом.
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { FolderEntry } from "../../preload";
import { pathKey } from "../../shared/canvas-model";
import { Icon } from "./Icon";
import type { Hover } from "./Ring";
import { age } from "./ring-svg";

const W = 280;
const H = 360;

export function Drawer(props: {
  anchor: Element;
  name: string;
  entries: FolderEntry[];
  folders: number;
  files: number;
  /** Главный процесс отдал не все записи: список обрезан его потолком. */
  cut: boolean;
  /** Папки на ободе кольца: в водопаде помечены. */
  onRim: ReadonlySet<string>;
  isOpen: (path: string) => boolean;
  colorOf: (path: string) => string;
  hover: Hover;
  /** Скрытые записи этой папки: в конце списка, с возвратом. */
  hidden: string[];
  onHide: (path: string, hide: boolean) => void;
  onOpen: (entry: FolderEntry) => void;
}) {
  const { anchor, name, entries, folders, files, cut, onRim, isOpen, colorOf, hover, hidden, onHide, onOpen } = props;
  const dirs = entries.filter((e) => e.isDirectory).sort((a, b) => b.mtime - a.mtime);
  const list = entries.filter((e) => !e.isDirectory);
  // Под якорем, а нет места снизу - сбоку от него.
  const box = anchor.getBoundingClientRect();
  const side = window.innerHeight - box.bottom < H + 15;
  const right = window.innerWidth - box.right > W + 20;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const place = {
    left: !side ? clamp(box.left + box.width / 2 - W / 2, 10, window.innerWidth - W - 10) : right ? box.right + 12 : box.left - W - 12,
    top: !side ? box.bottom + 8 : clamp(box.top, 10, window.innerHeight - H - 10),
  };
  let i = 0;
  const row = (entry: FolderEntry) => {
    const open = entry.isDirectory && isOpen(entry.path);
    return (
      <div key={entry.path} className={["drawer__row", entry.isDirectory && "drawer__row--dir", onRim.has(pathKey(entry.path)) && "drawer__row--top"].filter(Boolean).join(" ")}>
        <div style={{ "--i": i++ } as CSSProperties}>
          <button type="button" className="drawer__open" onClick={() => onOpen(entry)}>
            {entry.isDirectory ? (
              <svg width="13" height="11" viewBox="0 0 13 11">
                <path d="M.5 1.5h4l1.5 1.5h6.5v7h-12z" fill="none" stroke="#9a9a98" />
              </svg>
            ) : (
              <svg width="13" height="11" viewBox="0 0 13 11">
                <path d="M2.5.5h5l3 3v7h-8z" fill="none" stroke="#5f5f5d" />
              </svg>
            )}
            <span className="drawer__name" style={open ? { color: colorOf(entry.path) } : undefined}>
              {entry.name}
            </span>
            <span className="drawer__age">{age(entry.mtime)}</span>
          </button>
          <button type="button" className="drawer__hide" title="Скрыть с кольца и из списков" onClick={() => onHide(entry.path, true)}>
            <Icon name="hide" />
          </button>
        </div>
      </div>
    );
  };
  const back = (path: string) => (
    <div key={path} className="drawer__row drawer__row--hidden">
      <div style={{ "--i": i++ } as CSSProperties}>
        <span className="drawer__name">{path.split(/[\\/]/).pop()}</span>
        <button type="button" className="drawer__hide drawer__hide--back" title="Вернуть на кольцо и в списки" onClick={() => onHide(path, false)}>
          <Icon name="eye" />
        </button>
      </div>
    </div>
  );
  return createPortal(
    <div className="drawer" style={place} onMouseEnter={() => hover.enter()} onMouseLeave={hover.leave}>
      <div className="drawer__head">
        <b>{name}</b>
        <span>
          {folders} папок / {files} файлов / сверху свежие
        </span>
      </div>
      <div className="drawer__list">
        <div className="drawer__sep">ПАПКИ</div>
        {dirs.map(row)}
        {list.length > 0 && (
          <div className="drawer__sep">ФАЙЛЫ{cut ? ` / ПЕРВЫЕ ${list.length} ИЗ ${files}` : ""}</div>
        )}
        {list.map(row)}
        {hidden.length > 0 && <div className="drawer__sep">СКРЫТЫЕ / {hidden.length}</div>}
        {hidden.map(back)}
      </div>
    </div>,
    document.body,
  );
}
