import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { OnMove, ReactFlowInstance, Viewport } from "@xyflow/react";
import { frozenCards, visibleCards, type Layout, type View } from "../../shared/canvas-model";

/** Как часто пересчитывать заморозку посреди движения полотна, мс. */
const MOVE_MEASURE_MS = 150;

/** Событие перед полётом камеры: куда она летит. По нему карточки в точке назначения оттаивают заранее. */
const CANVAS_AHEAD = "canvas-ahead";
type Ahead = { x: number; y: number; zoom: number };

/**
 * Полёт камеры к точке. Карточки, которые окажутся на экране в точке назначения, оттаивают до полёта:
 * камера прилетает к готовому тексту, а не к пустым телам, которые оживут только на остановке.
 */
export function flyCenter(
  flow: Pick<ReactFlowInstance, "setCenter" | "getViewport" | "screenToFlowPosition">,
  x: number,
  y: number,
  zoom: number,
  duration: number,
): void {
  window.dispatchEvent(new CustomEvent<Ahead>(CANVAS_AHEAD, { detail: { x, y, zoom } }));
  // Масштаб меняется сразу, на месте, а летит камера уже при нём: каждый шаг масштаба в полёте заново растрирует слои
  // всех карточек, и переключение агентов стояло на растре по 100-300 мс на кадр.
  const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
  if (duration > 0 && pane && Math.abs(flow.getViewport().zoom - zoom) > 1e-3) {
    const at = flow.screenToFlowPosition({ x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 });
    void flow.setCenter(at.x, at.y, { zoom, duration: 0 });
  }
  // Сдвиг по прямой: плавная интерполяция d3 (interpolateZoom) на длинном пролёте отдаляет и приближает камеру сама, и
  // каждый её шаг масштаба заново растрировал кольца и карточки.
  void flow.setCenter(x, y, { zoom, duration, interpolate: "linear" });
}

/**
 * Что сейчас заморожено и чем отметить обращение к карточке.
 *
 * ponytail: набор пересчитывается на остановке полотна, на обращении и посреди движения не чаще
 * раза в MOVE_MEASURE_MS, а не на каждом кадре. Потолок - карточка, въехавшая в экран, оживает с
 * задержкой до этого срока, а уехавшая - так же замирает. Апгрейд - подписка на трансформацию
 * полотна по кадрам, если задержка станет заметна.
 */
export function useFrozen(layout: Layout | null, shell: RefObject<HTMLDivElement | null>) {
  // Видимая область в координатах полотна. Null - ещё не мерили, замораживать нечего.
  const [view, setView] = useState<View | null>(null);
  // Камера нужна только в момент замера, поэтому лежит в ref. Начальное значение - то же,
  // что defaultViewport у полотна: до первого движения взять его больше неоткуда.
  const camera = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  // Область, куда летит камера: считается видимой вместе с текущей до остановки полотна.
  const [ahead, setAhead] = useState<View | null>(null);
  const lastMove = useRef(0);
  const touchedAt = useRef(new Map<string, number>());
  const onScreen = useRef(new Set<string>());
  // Обращения лежат в ref и сами рендер не запускают - этот счётчик будит пересчёт,
  // иначе карточка, в которую напечатали, оттаяла бы лишь на следующей остановке полотна.
  const [touches, setTouches] = useState(0);

  const measure = useCallback(() => {
    const box = shell.current?.getBoundingClientRect();
    if (!box) return;
    const { x, y, zoom } = camera.current;
    setView({ x: -x / zoom, y: -y / zoom, width: box.width / zoom, height: box.height / zoom });
  }, [shell]);

  // Первый замер и замеры на изменение размера окна: onMoveEnd про окно ничего не знает,
  // а видимая область от него меняется так же, как от панорамирования.
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Полёт камеры: точка назначения заранее считается экраном, пока полотно не встанет.
  useEffect(() => {
    const toward = (event: Event) => {
      const box = shell.current?.getBoundingClientRect();
      const { x, y, zoom } = (event as CustomEvent<Ahead>).detail;
      if (!box) return;
      setAhead({ x: x - box.width / 2 / zoom, y: y - box.height / 2 / zoom, width: box.width / zoom, height: box.height / zoom });
    };
    window.addEventListener(CANVAS_AHEAD, toward);
    return () => window.removeEventListener(CANVAS_AHEAD, toward);
  }, [shell]);

  // Полотно едет: замер и на ходу, но не чаще раза в MOVE_MEASURE_MS - карточки оживают, как только
  // въехали в экран, а не на остановке.
  const onMove = useCallback(
    (next: Viewport) => {
      camera.current = next;
      const now = performance.now();
      if (now - lastMove.current < MOVE_MEASURE_MS) return;
      lastMove.current = now;
      measure();
    },
    [measure],
  );

  // Полотно остановилось: и от руки, и от полёта камеры к найденной карточке.
  const onMoveEnd = useCallback<OnMove>(
    (_event, next) => {
      camera.current = next;
      setAhead(null);
      measure();
    },
    [measure],
  );

  // Пересчёт будится, только если карточка заморожена: touch зовётся на каждую клавишу, а пересчёт перерисовывает всё
  // полотно. Незамороженной хватает отметки времени - её возьмёт следующий пересчёт.
  const frozenNow = useRef<Set<string> | null>(null);
  const touch = useCallback((id: string) => {
    touchedAt.current.set(id, Date.now());
    if (frozenNow.current?.has(id)) setTouches((count) => count + 1);
  }, []);

  // ponytail: появление на экране - тоже обращение, и отмечается оно прямо здесь, мутацией
  // во время рендера. Потолок - повторный рендер StrictMode ставит отметку дважды; результат
  // тот же, потому что второй раз карточка на экране уже не новая. Апгрейд, если полотно
  // поедет в конкурентный рендер, - вынести отметку в эффект.
  const frozen = useMemo(() => {
    if (!layout || !view) return null;
    const visible = visibleCards(layout, view);
    if (ahead) for (const id of visibleCards(layout, ahead)) visible.add(id);
    const now = Date.now();
    for (const id of visible) if (!onScreen.current.has(id)) touchedAt.current.set(id, now);
    onScreen.current = visible;
    frozenNow.current = frozenCards(layout, visible, touchedAt.current);
    return frozenNow.current;
  }, [layout, view, ahead, touches]);

  return { frozen, touch, onMove, onMoveEnd };
}
