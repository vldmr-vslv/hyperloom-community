import { useEffect, useRef, useState } from "react";
import { ControlButton, useReactFlow } from "@xyflow/react";
import { Icon } from "./Icon";
import { Menu, useMenu } from "./Menu";
import { savedTheme } from "./themes";
import { FORCE_DEFAULT, FORCE_ROWS, type Forces } from "./forces";

/** Вид полотна: тема, своя картинка вместо фона, точки, стекло над фоном и его размытие. tree - подпапка
 *  раскрывается в той же карточке деревом, а не отдельной карточкой. */
export type Look = {
  theme: string;
  wall: string | null;
  dots: boolean;
  glass: boolean;
  blur: number;
  tree: boolean;
};

/** Где окно помнит точки, стекло и размытие. Тема лежит отдельно (themes), картинка фона - файлом
 *  у главного процесса: она приходит байтами после запуска (App, wallpaper). */
const LOOK_KEY = "hyperloom.look";

/** Вид полотна при запуске: прошлый. Хранилище пустое или испорчено - как в первый раз. */
export function initialLook(): Look {
  const look: Look = { theme: savedTheme(), wall: null, dots: true, glass: false, blur: 12, tree: false };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null");
    if (saved === null || typeof saved !== "object") return look;
    const { dots, glass, blur, tree } = saved as Record<string, unknown>;
    if (typeof dots === "boolean") look.dots = dots;
    if (typeof tree === "boolean") look.tree = tree;
    if (typeof glass === "boolean") look.glass = glass;
    if (typeof blur === "number" && blur >= 0 && blur <= 40) look.blur = blur;
  } catch {
    // Хранилище недоступно или в нём не JSON: вид как в первый раз.
  }
  return look;
}

/** Запомнить точки, стекло, размытие и вид папок до следующего запуска. */
export function saveLook(look: Look): void {
  try {
    localStorage.setItem(
      LOOK_KEY,
      JSON.stringify({ dots: look.dots, glass: look.glass, blur: look.blur, tree: look.tree }),
    );
  } catch {
    // Хранилище недоступно: вид продержится до закрытия окна.
  }
}

/** Силы полотна: включить, выключить и подкрутить. Настройки помнит хранилище окна (forces.ts). */
function ForceRows({ value, onChange }: { value: Forces; onChange: (next: Forces) => void }) {
  const range = ([key, label, min, max, step]: (typeof FORCE_ROWS)[number], off: boolean) => (
    <label key={key} className="look__row look__range">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[key] as number}
        disabled={off}
        onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
      />
      <span>{value[key] as number}</span>
    </label>
  );
  return (
    <>
      <div className="menu__title">Силы полотна</div>
      <label className="look__row">
        <input type="checkbox" checked={value.forces} onChange={(event) => onChange({ ...value, forces: event.target.checked })} />
        Притяжение и отталкивание
      </label>
      {FORCE_ROWS.map((row) => range(row, !value.forces))}
      <label className="look__row">
        <input type="checkbox" checked={value.collide} onChange={(event) => onChange({ ...value, collide: event.target.checked })} />
        Столкновения: одно на другое не ложится
      </label>
      {range(["gap", "Зазор", 0, 80, 2], !value.collide)}
      <button type="button" role="menuitem" onClick={() => onChange({ ...FORCE_DEFAULT })}>
        Сбросить силы
      </button>
    </>
  );
}

function still(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Свои кнопки в блоке масштаба: вписать полотно в экран, на весь экран, вид полотна. */
export function CanvasButtons({
  look,
  onLook,
  forces,
}: {
  look: Look;
  onLook: (next: Look) => void;
  /** Силы круглого полотна; нет - тема без колец, и раздела сил в меню нет. */
  forces?: { value: Forces; onChange: (next: Forces) => void };
}) {
  const flow = useReactFlow();
  const [full, setFull] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  // На весь экран - силами страницы: Electron разворачивает под неё само окно, Esc возвращает.
  const toggleFull = () =>
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  const fullLabel = full ? "Выйти из полного экрана" : "На весь экран";
  return (
    <>
      <ControlButton
        onClick={() => void flow.fitView({ padding: 0.08, duration: still() ? 0 : 400 })}
        title="Вписать полотно в экран"
        aria-label="Вписать полотно в экран"
      >
        <Icon name="target" />
      </ControlButton>
      <ControlButton onClick={toggleFull} title={full ? `${fullLabel} (Esc)` : fullLabel} aria-label={fullLabel}>
        <Icon name={full ? "shrink" : "expand"} />
      </ControlButton>
      <LookButton look={look} onLook={onLook} forces={forces} />
    </>
  );
}

function LookButton({
  look,
  onLook,
  forces,
}: {
  look: Look;
  onLook: (next: Look) => void;
  forces?: { value: Forces; onChange: (next: Forces) => void };
}) {
  const menu = useMenu();
  const file = useRef<HTMLInputElement>(null);
  const wall = (next: string | null) => {
    if (look.wall) URL.revokeObjectURL(look.wall);
    onLook({ ...look, wall: next });
  };
  return (
    <>
      <ControlButton
        onClick={(event) => menu.toggle(event.currentTarget)}
        title="Вид полотна"
        aria-label="Вид полотна"
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
      >
        <Icon name="look" />
      </ControlButton>
      {menu.anchor && (
        <Menu anchor={menu.anchor} label="Вид полотна" onClose={menu.close}>
          {/* На круглом полотне подпапки раскрывает ветка кольца, дерево в карточке ему не нужно. */}
          {!forces && (
            <>
              <div className="menu__title">Папки</div>
              <label className="look__row">
                <input type="checkbox" checked={look.tree} onChange={(event) => onLook({ ...look, tree: event.target.checked })} />
                Подпапки деревом в той же карточке
              </label>
            </>
          )}
          {forces && <ForceRows {...forces} />}
          <div className="menu__title">Фон</div>
          <button type="button" role="menuitem" onClick={() => file.current?.click()}>
            {look.wall ? "Сменить картинку фона" : "Своя картинка вместо фона"}
          </button>
          {look.wall && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void window.fileApi.setWall(null);
                wall(null);
              }}
            >
              Убрать картинку фона
            </button>
          )}
          <label className="look__row">
            <input type="checkbox" checked={look.dots} onChange={(event) => onLook({ ...look, dots: event.target.checked })} />
            Точки фона
          </label>
          <label className="look__row">
            <input type="checkbox" checked={look.glass} onChange={(event) => onLook({ ...look, glass: event.target.checked })} />
            Стекло над фоном
          </label>
          <label className="look__row look__range">
            Размытие стекла
            <input
              type="range"
              min={0}
              max={40}
              value={look.blur}
              disabled={!look.glass}
              onChange={(event) => onLook({ ...look, blur: Number(event.target.value) })}
            />
            <span>{look.blur} px</span>
          </label>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (!picked) return;
              // Картинка запоминается на диске: после перезапуска фон тот же.
              void picked.arrayBuffer().then((bytes) => window.fileApi.setWall(new Uint8Array(bytes), picked.type));
              wall(URL.createObjectURL(picked));
              event.target.value = "";
            }}
          />
        </Menu>
      )}
    </>
  );
}
