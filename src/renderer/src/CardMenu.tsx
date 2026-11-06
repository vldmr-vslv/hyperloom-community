import { pathKey, ROOT_CARD_ID } from "../../shared/canvas-model";
import type { Data } from "./Card";
import { Icon } from "./Icon";
import { Menu, useMenu } from "./Menu";
import { CANVAS, contrast, PRESETS, readable } from "./palette";

/** Родительский каталог записи. */
function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

/**
  * Меню шапки: у всех - свернуть; у Root и папок - терминал, заметка и скрытые записи;
 * у папки - ещё цвет проекта.
 */
export function CardMenu({
  id,
  data,
  onTerminal,
  onNote,
}: {
  id: string;
  data: Data;
  onTerminal: () => void;
  onNote: () => void;
}) {
  const menu = useMenu();
  const holder = data.kind === "folder";
  const hiddenHere = data.hidden.filter((path) => pathKey(dirOf(path)) === pathKey(data.path));
  const act = (run: () => void) => () => (menu.close(), run());
  const openFolder = () =>
    void window.folderApi.pick().then((path) => {
      if (path) data.openCard(ROOT_CARD_ID, path, "folder");
    });
  return (
    <>
      <button
        type="button"
        className="card__menu nodrag"
        aria-label={`Меню карточки ${data.name}`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        <Icon name="menu" />
      </button>
      {menu.anchor &&
        (
        <Menu anchor={menu.anchor} label={`Карточка ${data.name}`} onClose={menu.close}>
          {holder && id !== ROOT_CARD_ID && (
            <div className="palette">
              <div className="palette__title">Цвет проекта</div>
              <div className="palette__swatches">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    className={preset.hex === data.color ? "swatch swatch--on" : "swatch"}
                    style={{ background: preset.hex }}
                    title={preset.name}
                    aria-label={preset.name}
                    aria-pressed={preset.hex === data.color}
                    onClick={() => data.paintFolder(data.path, preset.hex)}
                  />
                ))}
              </div>
              <label className="palette__custom">
                <input
                  type="color"
                  value={data.color}
                  onChange={(event) => data.paintFolder(data.path, readable(event.target.value))}
                />
                Свой цвет
              </label>
              <div className="palette__check">линия на полотне {contrast(data.color, CANVAS).toFixed(1)}:1</div>
            </div>
          )}
          {id === ROOT_CARD_ID && (
            <>
              {/* Папка с диска, в том числе вне каталога проектов: встаёт под корень. */}
              <button type="button" role="menuitem" onClick={act(openFolder)}>
                <Icon name="folder" /> Открыть папку
              </button>
              <button type="button" role="menuitem" onClick={act(data.showGraph)}>
                <Icon name="graph" /> Граф
              </button>
            </>
          )}
          {data.kind === "file" && /\.html?$/i.test(data.path) && (
            <>
              <button type="button" role="menuitem" onClick={act(() => void window.fileApi.outside(data.path))}>
                <Icon name="globe" /> Открыть в браузере Windows
              </button>
            </>
          )}
          {data.kind === "file" && (
            <button type="button" role="menuitem" onClick={act(() => void window.fileApi.copy(data.path))}>
              <Icon name="copy" /> Копировать файл
            </button>
          )}
          <button type="button" role="menuitem" onClick={act(() => data.foldCard(id, !data.collapsed))}>
            <Icon name={data.collapsed ? "unfold" : "fold"} /> {data.collapsed ? "Развернуть" : "Свернуть"}
          </button>
          {holder && (
            <>
              {/* Терминал и агент открываются из папки, потому что папка и есть их рабочий
                  каталог. Заметка - оттуда же: её файл ложится в эту папку. */}
              <button type="button" role="menuitem" onClick={act(onTerminal)}>
                <Icon name="terminal" /> Терминал
              </button>
              <button type="button" role="menuitem" onClick={act(onNote)}>
                <Icon name="note" /> Заметка
              </button>
              <div className="menu__title">Скрытые{hiddenHere.length ? `: ${hiddenHere.length}` : ""}</div>
              {hiddenHere.length === 0 && <div className="menu__empty">нет</div>}
              {hiddenHere.map((path) => (
                <button key={path} type="button" role="menuitem" onClick={() => data.hideEntry(path, false)}>
                  <Icon name="eye" /> {path.split(/[\\/]/).pop()}
                </button>
              ))}
            </>
          )}
        </Menu>
      )}
    </>
  );
}
