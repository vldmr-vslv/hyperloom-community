// Лёд: брошенное полотно катится и тормозит, карточки, связи и точки фона едут с ним в одном кадре. Взятая
// карточка догоняет руку, брошенная - катится дальше. Кто отключил движение в системе, получает всё сразу на месте.
import { useCallback, useRef, useState } from "react";
import type { NodeChange, OnMove, OnMoveStart, Viewport } from "@xyflow/react";
import { CANVAS_MOVE } from "./Menu";

type Trail = { t: number; x: number; y: number }[];
type Transform = [number, number, number];

/** Ход руки по полотну: пока держит (протяжка или колесо), движение не кончилось; бросок бывает только
 *  после протяжки. glide - скорость полотна после броска, px/мс экрана; null - не катится. */
export type Ice = { held: boolean; drag: boolean; trail: Trail; glide: { vx: number; vy: number } | null };

/** Торможение броска, у полотна и у карточки: постоянная времени, мс. Медленнее GLIDE_STOP px/мс
 *  на экране движение встаёт. */
const GLIDE_MS = 350;
const GLIDE_STOP = 0.02;
/** Запаздывание взятой карточки за рукой, мс. */
const CARD_LAG_MS = 70;

export function still(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** След руки за последние 120 мс. Время - отметки самих событий мыши: обработчик может прийти позже,
 *  когда страница занята, и скорость по часам в нём выходила бы неверной. */
function track(trail: Trail, t: number, x: number, y: number): Trail {
  return [...trail.filter((p) => t - p.t < 120), { t, x, y }];
}

/** Скорость броска по следу: последние 100 мс хода, не быстрее 4 px/мс на экране. Рука перед
 *  отпусканием стояла дольше 150 мс или шла медленнее 0.25 px/мс - броска нет. scale - px экрана
 *  на единицу следа. */
function throwOf(trail: Trail, at: number, scale: number): { x: number; y: number } | null {
  const b = trail[trail.length - 1];
  if (!b || at - b.t > 150) return null;
  const a = trail.find((p) => b.t - p.t <= 100) ?? b;
  const dt = b.t - a.t;
  const speed = dt > 0 ? (Math.hypot(b.x - a.x, b.y - a.y) / dt) * scale : 0;
  if (speed < 0.25) return null;
  const k = Math.min(1, 4 / speed) / dt;
  return { x: (b.x - a.x) * k, y: (b.y - a.y) * k };
}

/** Куда полотно докатилось за dt после броска; null - встало. Скорость гаснет в самом ice. */
export function glideStep(ice: Ice, transform: Transform, dt: number): Viewport | null {
  const glide = ice.glide;
  if (!glide) return null;
  const next = { x: transform[0] + glide.vx * dt, y: transform[1] + glide.vy * dt, zoom: transform[2] };
  const k = Math.exp(-dt / GLIDE_MS);
  glide.vx *= k;
  glide.vy *= k;
  if (Math.hypot(glide.vx, glide.vy) < GLIDE_STOP) ice.glide = null;
  return next;
}

/**
 * Бросок полотна: ход руки пишется в ice, отпустили на ходу - полотно катится дальше (его катит слой
 * связей). onRest - полотно остановилось, от руки или из кода (вписать, перелёт к карточке): по нему
 * заморозка мерит, что на экране. moving - полотно двигают: его слой на это время только сдвигается.
 */
export function useCanvasIce(onRest: (viewport: Viewport) => void) {
  const ice = useRef<Ice>({ held: false, drag: false, trail: [], glide: null });
  const [moving, setMoving] = useState(false);

  const onMoveStart = useCallback<OnMoveStart>((event, viewport) => {
    // Движение из кода - событие null: сам бросок меню не закрывает, он их уже закрыл.
    if (event || !ice.current.glide) window.dispatchEvent(new Event(CANVAS_MOVE));
    if (!event) return;
    ice.current = {
      held: true,
      drag: event.type === "mousedown" || event.type === "touchstart" || event.type === "pointerdown",
      trail: [{ t: event.timeStamp, x: viewport.x, y: viewport.y }],
      glide: null,
    };
    setMoving(true);
  }, []);

  const onMove = useCallback<OnMove>((event, viewport) => {
    if (!event || !ice.current.held) return;
    ice.current.trail = track(ice.current.trail, event.timeStamp, viewport.x, viewport.y);
  }, []);

  const onMoveEnd = useCallback<OnMove>(
    (event, viewport) => {
      if (event) {
        const { drag, trail } = ice.current;
        ice.current.held = false;
        const v = drag && !still() ? throwOf(trail, event.timeStamp, 1) : null;
        if (v) ice.current.glide = { vx: v.x, vy: v.y };
      }
      if (!ice.current.glide && !ice.current.held) onRest(viewport);
    },
    [onRest],
  );

  const onSettle = useCallback(() => setMoving(false), []);
  return { ice, moving, onMoveStart, onMove, onMoveEnd, onSettle };
}

type Flight = { target: { x: number; y: number }; shown: { x: number; y: number }; v: { x: number; y: number } | null; held: boolean; trail: Trail };
type Moves = ReadonlyMap<string, { x: number; y: number }>;

/**
 * Лёд для карточек под рукой: карточку ставит не React Flow, а полёт - он догоняет руку и после броска
 * катит карточку дальше. place кладёт показанные места в раскладку, at - где карточка стоит в ней
 * сейчас; zoom - масштаб полотна, скорость броска меряется на экране.
 */
export function useCardIce(
  place: (moves: Moves) => void,
  at: (id: string) => { x: number; y: number } | undefined,
  zoom: () => number,
) {
  const flights = useRef(new Map<string, Flight>());
  const running = useRef(0);

  const launch = useCallback(() => {
    if (running.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const moves = fly(flights.current, dt, zoom());
      if (moves.size > 0) place(moves);
      running.current = flights.current.size ? requestAnimationFrame(step) : 0;
    };
    running.current = requestAnimationFrame(step);
  }, [place, zoom]);

  /** Ходы карточек из потока React Flow становятся целями полёта. */
  const take = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const from = at(change.id) ?? change.position;
        const f = flights.current.get(change.id) ?? { target: { ...from }, shown: { ...from }, v: null, held: false, trail: [] };
        f.target = { ...change.position };
        f.held = Boolean(change.dragging);
        flights.current.set(change.id, f);
      }
      launch();
    },
    [at, launch],
  );

  /** Взяли карточку, которая ещё едет: она встаёт под руку. */
  const grab = useCallback((id: string) => {
    const f = flights.current.get(id);
    if (f) (f.v = null), (f.trail = []);
  }, []);

  // След - ход самой мыши на экране, а не места карточки: у края полотно едет само, место карточки меняется при
  // стоящей мыши, и отпущенная там карточка улетала бы.
  const drag = useCallback((id: string, t: number, x: number, y: number) => {
    const f = flights.current.get(id);
    if (f && Number.isFinite(x) && Number.isFinite(y)) f.trail = track(f.trail, t, x, y);
  }, []);

  /** Отпустили карточку на ходу: едет дальше со скоростью последних 100 мс хода. */
  const drop = useCallback(
    (id: string, t: number) => {
      const f = flights.current.get(id);
      const v = f ? throwOf(f.trail, t, 1) : null;
      if (!f || !v) return;
      f.v = { x: v.x / zoom(), y: v.y / zoom() };
      f.held = false;
      launch();
    },
    [zoom, launch],
  );

  /** Нажатие по карточке останавливает её там, где она сейчас показана. */
  const stop = useCallback((id: string) => {
    const f = flights.current.get(id);
    if (f) (f.v = null), (f.target = { ...f.shown });
  }, []);

  return { take, grab, drag, drop, stop };
}

/** Шаг полёта всех карточек: цель после броска катится и тормозит, показанное место догоняет цель.
 *  Встала и отпущена - полёт кончен. Отдаёт сдвинувшиеся за шаг карточки. */
function fly(flights: Map<string, Flight>, dt: number, zoom: number): Moves {
  const lag = 1 - Math.exp(-dt / CARD_LAG_MS);
  const moves = new Map<string, { x: number; y: number }>();
  for (const [id, f] of flights) {
    if (f.v) {
      f.target.x += f.v.x * dt;
      f.target.y += f.v.y * dt;
      const k = Math.exp(-dt / GLIDE_MS);
      f.v.x *= k;
      f.v.y *= k;
      if (Math.hypot(f.v.x, f.v.y) * zoom < GLIDE_STOP) f.v = null;
    }
    const was = { ...f.shown };
    f.shown.x += (f.target.x - f.shown.x) * lag;
    f.shown.y += (f.target.y - f.shown.y) * lag;
    const near = Math.hypot(f.target.x - f.shown.x, f.target.y - f.shown.y) * zoom < 0.3;
    if (near) f.shown = { ...f.target };
    if (near && !f.held && !f.v) flights.delete(id);
    if (Math.abs(f.shown.x - was.x) > 0.01 || Math.abs(f.shown.y - was.y) > 0.01) moves.set(id, { ...f.shown });
  }
  return moves;
}
