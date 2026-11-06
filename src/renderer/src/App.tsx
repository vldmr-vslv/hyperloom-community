import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  Controls,
  Panel,
  ReactFlow,
  getViewportForBounds,
  useReactFlow,
  useStore,
  useStoreApi,
  type NodeChange,
  type NodeMouseHandler,
  type OnMove,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  addCard,
  cardName,
  colorOf,
  focusedCards,
  hideEntry,
  liveDescendants,
  pathKey,
  placeOf,
  removeCard,
  ROOT_CARD_ID,
  setCollapsed,
  setColor,
  unhideEntry,
  updateCard,
  type Card,
  type Layout,
} from "../../shared/canvas-model";
import type { Pt } from "../../shared/route";
import {
  CardNodeView,
  type CardAt,
  type CardNode,
  type CloseCard,
  type FoldCard,
  type HideEntry,
  type OpenCard,
  type PaintFolder,
  type ReportRun,
} from "./Card";
import { DEFAULT_COLOR } from "./palette";
import { LinkCanvas, type Scene } from "./LinkCanvas";
import { FOLDED_HEIGHT } from "./link-routes";
import { CanvasButtons, initialLook, saveLook, type Look } from "./Look";
import { initialForces, saveForces, useForces, type Forces } from "./forces";
import { applyTheme, shown, themeOf } from "./themes";
import { CANVAS_MOVE } from "./Menu";
import { useFrameFocus } from "./Dock";
import { FrameRate } from "./FrameRate";
import { shellOf } from "./card-look";
import { flyCenter, useFrozen } from "./freeze";
import { asDot, useGraph } from "./graph-view";
import { still, useCanvasIce, useCardIce } from "./ice";
import { centerOf, isRing, rectPort, ringLayout, rimPort, spotAround, type Port } from "./rings";
import type { Atlas } from "./Card";
import type { RingInfo, RingKid } from "./Ring";
import type { Procs } from "./RingRoot";
import { same } from "./same";

const nodeTypes = { card: CardNodeView };
// Кольцо сообщает слою потока, что в нём лежит проект; потока нет, сообщать некому.
const noProject = () => {};

// Волна при запуске: карточки проявляются по очереди с этим шагом, после этой по счёту
// остальные идут разом - иначе на большом полотне волна тянулась бы секундами.
const WAVE_STEP_MS = 30;
const WAVE_CARDS = 20;
// Сколько длится сборка полотна при запуске: дальше новые карточки проявляются без очереди.
const BOOT_MS = 1500;
/** Самый крупный масштаб полотна. */
const MAX_ZOOM = 2;
/** Какую долю экрана занимает карточка, к которой камера подлетела двойным щелчком. */
const FIT_SHARE = 0.9;

/** Строение раскладки без мест и размеров карточек: одно и то же, пока карточки только двигают. */
function structureOf(layout: Layout): string {
  return JSON.stringify([
    layout.cards.map((card) => [card.id, card.kind, card.path]),
    layout.edges.map((edge) => [edge.from, edge.to]),
    layout.colors ?? {},
    layout.hidden ?? [],
  ]);
}


const FPS = (
  <Panel position="bottom-right">
    <FrameRate />
  </Panel>
);

/** Поля вида "все карточки в экране", те же у кнопки центрирования (`Look.tsx`). */
const FIT_PADDING = 0.08;

/** Отдалиться можно, пока влезают все карточки, но не меньше чем до масштаба 1. */
function FitMinZoom(): null {
  const zoom = useStore((s) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const node of s.nodeLookup.values()) {
      if (node.hidden) continue;
      const { x, y } = node.internals.positionAbsolute;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + (node.measured.width ?? 0));
      y1 = Math.max(y1, y + (node.measured.height ?? 0));
    }
    if (!(x1 > x0) || !s.width) return 1;
    const fit = getViewportForBounds({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, s.width, s.height, 0, 1, FIT_PADDING);
    // Вниз до сотых: предел меняется реже, а кнопка центрирования в него влезает.
    return Math.floor(fit.zoom * 100) / 100;
  });
  const store = useStoreApi();
  useEffect(() => store.getState().setMinZoom(zoom), [store, zoom]);
  return null;
}

/** Задержка проявления карточки в волне запуска. */
function enterDelay(index: number): number {
  return Math.min(index, WAVE_CARDS) * WAVE_STEP_MS;
}

// ponytail: applyNodeChanges из @xyflow/react тут не подходит - он ведёт свой список узлов,
// а источник истины один, Layout. Берём из потока событий только то, что в раскладке есть.
function applyNodeChange(layout: Layout, change: NodeChange<CardNode>): Layout {
  if (change.type === "position" && change.position) {
    return updateCard(layout, change.id, { position: change.position });
  }
  // dimensions прилетает и от измерения карточки браузером; размер меняем только при resizing.
  if (change.type === "dimensions" && change.resizing && change.dimensions) {
    return updateCard(layout, change.id, { size: change.dimensions });
  }
  return layout;
}

/** Как процесс назван в вопросе о закрытии: "оболочка в site". */
function processName(card: Card): string {
  return `оболочка в ${cardName(card)}`;
}


/**
 * Курсор в поле ввода карточки: xterm у терминала и агента. Без прокрутки страницы: камеру двигает
 * полотно, а браузер, прокрутив обёртку к полю, сбил бы её.
 */
function focusInput(id: string): void {
  const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
  node?.querySelector<HTMLElement>(".xterm-helper-textarea, textarea, input")?.focus({ preventScroll: true });
}


/** Сколько разворачивается и сворачивается кольцо или карточка круглого полотна, мс (index.css, ring-pop и atlas-born). */
const BORN_MS = 1000;
const DYING_MS = 600;

/**
 * Новые карточки круглого полотна, выросшие из кольца, встают вокруг него, где свободно (rings.ts, spotAround), а
 * at - прямо туда: подпапка напротив своего сегмента. Модель ставит потомков столбиком справа от родителя - кольцо
 * этого не знает.
 */
/**
 * Размер новой карточки круглого полотна, как в прототипе (bySize: знак 6.6 px, строка 16 px, рамка 34 на 52): терминал
 * 80x24 знака, агент 100x30, заметка 360x240, файл 560x420, картинка 480x360. Прочие (страница) - свой.
 * ponytail: файл не меряется по своей самой длинной строке, как в прототипе: текста при раскладке ещё нет.
 */
function openSize(card: Layout["cards"][number]): { width: number; height: number } | undefined {
  if (card.kind === "terminal") return { width: 562, height: 436 };
  if (card.kind === "note") return { width: 360, height: 240 };
  if (card.kind === "file") return /\.(png|jpe?g|gif|webp|svg)$/i.test(card.path) ? { width: 480, height: 360 } : { width: 560, height: 420 };
  return undefined;
}

function placeNew(prev: Layout, next: Layout, at?: Pt): Layout {
  const known = new Set(prev.cards.map((card) => card.id));
  let out = next;
  for (const card of next.cards) {
    // Закрытая раньше карточка уже встала на своё прежнее место (addCard).
    if (known.has(card.id) || placeOf(prev, card.id)) continue;
    const edge = next.edges.find((one) => one.to === card.id);
    const parent = edge && next.cards.find((one) => one.id === edge.from);
    if (!parent || !isRing(parent)) continue;
    const size0 = openSize(card);
    if (size0) out = updateCard(out, card.id, { size: size0 });
    const geo = ringLayout(out);
    const size = geo.cards.find((one) => one.id === card.id)!.size;
    const rest = { ...geo, cards: geo.cards.filter((one) => one.id !== card.id), edges: geo.edges.filter((one) => one.to !== card.id) };
    const position = at ? { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) } : spotAround(rest, parent.id, size);
    out = updateCard(out, card.id, { position });
  }
  return out;
}

/** Где связь от родителя входит в карточку круглого полотна: так же считает слой связей (link-routes.ts). */
function entryPorts(layout: Layout): Map<string, Port> {
  const cards = new Map(layout.cards.map((card) => [card.id, card]));
  const out = new Map<string, Port>();
  for (const edge of layout.edges) {
    const a = cards.get(edge.from);
    const b = cards.get(edge.to);
    if (!a || !b || isRing(b)) continue;
    const from = isRing(a) ? rimPort(a, centerOf(b)) : rectPort(a, centerOf(b));
    out.set(b.id, rectPort(b, from));
  }
  return out;
}

export default function App() {
  const [layout, setLayout] = useState<Layout | null>(null);
  // Раскладка, прочитанная с диска: её незачем отправлять обратно тем же содержимым.
  const loadedRef = useRef<Layout | null>(null);
  // Она же для обработчиков, которым раскладка нужна до изменения полотна, а не внутри
  // setLayout: закрытие сперва смотрит, что оборвёт, и только потом спрашивает и снимает.
  const layoutRef = useRef<Layout | null>(null);
  // В какую карточку идёт ввод с клавиатуры. Хранится идентификатор, а не флаг: чёткие
  // соседи считаются от неё. Null - ввода нет, полотно всё чёткое.
  const [typingIn, setTypingIn] = useState<string | null>(null);
  // Кто сейчас под мышью и в ком стоит курсор ввода - от этого зависит порядок по оси z.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedIn, setFocusedIn] = useState<string | null>(null);
  // Курсор во фрейме страницы файла (html, pdf): событий фокуса окну оттуда не приходит, карточка узнаётся отдельно.
  const frameIn = useFrameFocus();
  // Вид полотна из меню кнопки настроек: тема, картинка фона, точки, стекло.
  const [look, setLook] = useState<Look>(initialLook);
  // Тема ложится на страницу сразу при выборе, до отрисовки: палитра и лист стилей нужны уже ей.
  const changeLook = useCallback((next: Look) => {
    if (document.documentElement.dataset.theme !== next.theme) applyTheme(next.theme);
    saveLook(next);
    setLook(next);
  }, []);
  // Своя картинка фона с прошлого раза: главный процесс отдаёт её байтами. Её успели сменить, пока
  // шло чтение, - остаётся новая.
  useEffect(() => {
    void window.fileApi.wall().then((saved) => {
      if (!saved) return;
      const url = URL.createObjectURL(new Blob([saved.bytes], { type: saved.type }));
      setLook((now) => (now.wall ? now : { ...now, wall: url }));
    });
  }, []);
  const theme = themeOf(look.theme);
  // Круглое полотно - тёмная тема: папки и корень - кольца своего размера, остальные темы видят раскладку как есть.
  const rings = theme.id === "dark";
  const ringsRef = useRef(rings);
  ringsRef.current = rings;
  const canvasLayout = useMemo(() => (layout && rings ? ringLayout(layout) : layout), [layout, rings]);
  // Раскладка, как её рисует полотно: по ней летит камера и считается граф. layoutRef - то, что лежит в файле.
  const canvasRef = useRef<Layout | null>(null);
  canvasRef.current = canvasLayout;
  // Строение полотна без мест карточек: набор, пути, стрелки, цвета, скрытое. По нему пересобираются справки карточек;
  // протяжка его не меняет, а справки, новые на каждый кадр протяжки, перерисовывали все карточки (_scratch/perf, 02).
  const structure = canvasLayout ? structureOf(canvasLayout) : "";
  // Полотно замеряется по этому узлу: что попало в его прямоугольник, то и на экране.
  const shell = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const { frozen, touch, onMove: freezeMove, onMoveEnd: freezeAt } = useFrozen(canvasLayout, shell);
  // Лёд (ice.ts): брошенное полотно катится. Заморозка мерит экран, когда полотно остановилось, а не когда его
  // отпустили: после броска оно ещё едет.
  const rest = useCallback((viewport: Viewport) => freezeAt(null, viewport), [freezeAt]);
  const { ice, moving, onMoveStart, onMove: iceMove, onMoveEnd, onSettle } = useCanvasIce(rest);
  // Движение полотна слышат и лёд (бросок), и заморозка (карточки, въехавшие в экран, оживают на ходу).
  const onMove = useCallback<OnMove>(
    (event, viewport) => {
      iceMove(event, viewport);
      freezeMove(viewport);
    },
    [iceMove, freezeMove],
  );
  const settle = useCallback(() => {
    onSettle();
    rest(flow.getViewport());
  }, [onSettle, rest, flow]);
  // Граф проектов из меню корня: карточки становятся кружками, раскладка полотна не трогается.
  const view = useGraph(canvasRef, flow);

  // Первые мгновения после загрузки полотно собирается волной; потом класс снимается,
  // и новая карточка проявляется сразу, а не в очереди за теми, что уже стоят.
  // Отсчёт идёт от первого кадра с карточками, а не от прихода раскладки: окно при запуске
  // бывает занято, и отсчёт от раскладки истекал раньше, чем карточки вообще рисовались.
  const [booting, setBooting] = useState(true);
  const loaded = layout !== null;
  useEffect(() => {
    if (!loaded) return;
    let done: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      done = setTimeout(() => setBooting(false), BOOT_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [loaded]);
  // Терминалы, в которых сейчас идёт команда: карточка и лампочка проекта показывают работу.
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const reportRun = useCallback<ReportRun>((id, busy) => {
    setRunning((was) => {
      if (was.has(id) === busy) return was;
      const next = new Set(was);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);


  // Раскладка берётся у setLayout, а не из замыкания: тогда обработчик живёт всё время работы
  // приложения одним и тем же и не устаревает вместе с карточками.
  const openCard = useCallback<OpenCard>((parentId, path, kind, _command, at) => {
    setLayout((current) => {
      if (!current) return current;
      const next = addCard(current, parentId, path, kind);
      return ringsRef.current ? placeNew(current, next, at) : next;
    });
  }, []);


  // Ввод виден по событию, а не по фокусу: у терминала фокус держит его собственное скрытое
  // поле, и карточку по нему не узнать. Ловится на перехвате, а не на всплытии: обработанную
  // клавишу xterm гасит у себя вместе с всплытием, и до полотна она бы не дошла.
  // Мимо карточек - размытия нет: так печать в поле поиска на панели полотно не трогает.
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // ponytail: карточка узнаётся по разметке React Flow. Потолок - библиотека переименует
    // класс или атрибут, и размытие тихо перестанет включаться. Апгрейд - свой data-атрибут
    // на теле карточки в Card.tsx.
    const node = (event.target as HTMLElement).closest(".react-flow__node");
    const id = node?.getAttribute("data-id") ?? null;
    // Ввод - это обращение: карточка, в которой печатают, мёрзнуть не должна.
    if (id) touch(id);
    setTypingIn(id);
  }, [touch]);

  // Карточка под мышью выходит вперёд, а карточка с курсором ввода лежит выше неё: печатать
  // в перекрытое поле нельзя, и увод мыши не должен прятать то, во что печатают. Для этого
  // typingIn не годится - его сбрасывает первое же движение мыши (см. ниже).
  const onNodeEnter = useCallback((_: unknown, node: CardNode) => setHovered(node.id), []);
  const onNodeLeave = useCallback(() => setHovered(null), []);

  // Фокус, а не клавиша: курсор стоит в карточке и когда в неё ничего не печатают. Терминал
  // держит фокус в своём скрытом поле, но оно лежит внутри узла, поэтому ближайший узел
  // находится и для него.
  const onFocusIn = useCallback((event: globalThis.FocusEvent) => {
    const node = (event.target as HTMLElement | null)?.closest(".react-flow__node");
    setFocusedIn(node?.getAttribute("data-id") ?? null);
  }, []);

  useEffect(() => {
    const shellNode = shell.current;
    if (!shellNode) return;
    shellNode.addEventListener("focusin", onFocusIn);
    return () => shellNode.removeEventListener("focusin", onFocusIn);
  }, [onFocusIn]);

  // Движение мыши снимает размытие сразу. Слушатель живёт только пока размыто: mousemove
  // сыплется постоянно, и в покое за него платить незачем.
  useEffect(() => {
    if (!typingIn) return;
    const clear = () => setTypingIn(null);
    window.addEventListener("mousemove", clear, { once: true });
    return () => window.removeEventListener("mousemove", clear);
  }, [typingIn]);


  // Окно ушло из фокуса - повторяющееся движение на полотне встаёт (index.css, .window-away):
  // полотно часто лежит рядом с другими окнами, и дышать для того, кто смотрит в другое,
  // незачем тратить процессор.
  useEffect(() => {
    const root = document.documentElement;
    const away = () => root.classList.add("window-away");
    const back = () => root.classList.remove("window-away");
    if (!document.hasFocus()) away();
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, []);

  useEffect(() => {
    void window.layoutApi.load().then((loaded) => {
      loadedRef.current = loaded;
      setLayout(loaded);
    });
  }, []);


  // Пока силы двигают карточки, раскладка меняется до 30 раз в секунду: на диск она уходит не чаще раза в секунду,
  // последним положением. В остальное время - сразу.
  const forcesMoving = useRef(false);
  const saveTimer = useRef(0);
  useEffect(() => {
    layoutRef.current = layout;
    if (!layout || layout === loadedRef.current) return;
    if (!forcesMoving.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = 0;
      window.layoutApi.save(layout);
    } else if (!saveTimer.current) {
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = 0;
        if (layoutRef.current) window.layoutApi.save(layoutRef.current);
      }, 1000);
    }
  }, [layout]);


  // Закрытие уносит карточку вместе с потомками. Процессы уходят следом сами: терминал
  // завершает свою оболочку, снимаясь с полотна, - но живые нельзя обрывать молча,
  // поэтому сначала вопрос со списком, и только согласие меняет полотно.
  // Закрытые на круглом полотне сворачиваются обратным ходом и только потом уходят из раскладки.
  // Значение - когда началось сворачивание (performance.now()): по нему гаснут связи на слое связей.
  const [dying, setDying] = useState<ReadonlyMap<string, number>>(() => new Map());
  const closeCard = useCallback<CloseCard>((id) => {
    const current = layoutRef.current;
    if (!current) return;
    const close = () => {
      if (ringsRef.current && !still()) {
        const left = new Set(removeCard(current, id).cards.map((card) => card.id));
        const gone = current.cards.filter((card) => !left.has(card.id)).map((card) => card.id);
        const at = performance.now();
        setDying((was) => new Map([...was, ...gone.map((one) => [one, at] as const)]));
        window.setTimeout(() => {
          setLayout((now) => (now ? removeCard(now, id) : now));
          setDying((was) => new Map([...was].filter(([one]) => !gone.includes(one))));
        }, DYING_MS);
      } else setLayout((now) => (now ? removeCard(now, id) : now));
    };
    const live = liveDescendants(current, id);
    if (live.length === 0) return close();
    void window.layoutApi.confirmClose(live.map(processName)).then((agreed) => {
      if (agreed) close();
    });
  }, []);



  // Меню карточки: свернуть, покрасить проект, скрыть запись или вернуть её. Всё ложится
  // в раскладку и переживает перезапуск.
  const foldCard = useCallback<FoldCard>((id, collapsed) => {
    setLayout((current) => (current ? setCollapsed(current, id, collapsed) : current));
  }, []);
  const paintFolder = useCallback<PaintFolder>((path, hex) => {
    setLayout((current) => (current ? setColor(current, path, hex) : current));
  }, []);
  const nameRoot = useCallback((title?: string) => {
    setLayout((current) => (current ? updateCard(current, ROOT_CARD_ID, { title }) : current));
  }, []);
  // Камера к карточке: ряд значков сверху, уже открытая браузер-карточка.
  // focus - после полёта поставить курсор в поле ввода карточки: из ряда значков к терминалу или агенту
  // летят, чтобы сразу печатать, а не щёлкать в него ещё раз. fit - вписать карточку в экран с полями,
  // а не ставить масштаб 1: так камера подлетает по двойному щелчку.
  const flyTo = useCallback(
    (id: string, focus = false, fit = false) => {
      const card = canvasRef.current?.cards.find((one) => one.id === id);
      if (!card) return;
      const height = card.collapsed ? FOLDED_HEIGHT : card.size.height;
      const x = card.position.x + card.size.width / 2;
      const y = card.position.y + height / 2;
      const screen = shell.current?.getBoundingClientRect();
      const zoom =
        fit && screen ? Math.min(MAX_ZOOM, (screen.width * FIT_SHARE) / card.size.width, (screen.height * FIT_SHARE) / height) : 1;
      const duration = still() ? 0 : 500;
      flyCenter(flow, x, y, zoom, duration);
      if (focus) window.setTimeout(() => focusInput(id), duration + 30);
    },
    [flow],
  );
  const hideOne = useCallback<HideEntry>((path, hidden) => {
    setLayout((current) => (current ? (hidden ? hideEntry(current, path) : unhideEntry(current, path)) : current));
  }, []);

  // Разметка строк поменялась - точки выхода связей из строк надо перемерить (LinkCanvas.tsx).
  const ports = useRef({ dirty: true });
  const markPorts = useCallback(() => {
    ports.current.dirty = true;
  }, []);

  // Справки для карточек: где стоит карточка пути, сколько агентов работает внутри, чей цвет.
  // Пересобираются по строению полотна и по тому, кто работает, а не по раскладке и всем состояниям: протяжка и
  // переход агента между "ждёт" и "простаивает" не перерисовывают все карточки.
  const lookups = useMemo(() => {
    const now = canvasRef.current;
    const cards = now?.cards ?? [];
    const byPath = new Map(cards.filter((card) => card.kind !== "terminal").map((card) => [pathKey(card.path), card.id]));
    // Место и размер - на момент вызова: карточку могли подвинуть после сборки справок.
    const cardAt: CardAt = (path) => {
      const id = byPath.get(pathKey(path));
      const card = id === undefined ? undefined : canvasRef.current?.cards.find((one) => one.id === id);
      if (!card) return undefined;
      const height = card.collapsed ? FOLDED_HEIGHT : card.size.height;
      return { ...card.position, width: card.size.width, height };
    };
    // Цвет пути запоминается до смены строения или темы: слой связей спрашивает его по каждой связи на каждом кадре, а
    // colorOf обходит все записи цветов.
    const colors = new Map<string, string>();
    const colorFor = (path: string) => {
      let color = colors.get(path);
      if (color === undefined) {
        const stored = now && colorOf(now, path);
        color = stored ? shown(stored, theme) : DEFAULT_COLOR;
        colors.set(path, color);
      }
      return color;
    };
    const rootPath = cards.find((card) => card.id === ROOT_CARD_ID)?.path ?? "";
    return { cardAt, colorFor, rootPath, hidden: now?.hidden ?? [] };
  }, [structure, theme]);


  // Кольцо, в ветке которого ходят по файлам: оно над всем полотном, фокус на нём, как у карточки с вводом.
  const [browsing, setBrowsing] = useState<string | null>(null);
  // Пока идёт ввод, чёткими остаются карточка, её соседи по стрелкам и родительская папка.
  const focused = useMemo(() => {
    const at = browsing ?? typingIn;
    const now = canvasRef.current;
    const sharp = now && at ? focusedCards(now, at) : new Set<string>();
    // Пустой набор - размывать не за что: ввода нет или карточку успели закрыть под ним.
    return sharp.size > 0 ? sharp : null;
  }, [structure, typingIn, browsing]);

  // Только что открытые на круглом полотне разворачиваются; при сборке полотна после запуска - нет.
  const [born, setBorn] = useState<ReadonlyMap<string, number>>(() => new Map());
  const knownIds = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    if (!layout) return;
    const ids = new Set(layout.cards.map((card) => card.id));
    const fresh = knownIds.current && !booting && rings && !still() ? [...ids].filter((id) => !knownIds.current!.has(id)) : [];
    knownIds.current = ids;
    if (fresh.length === 0) return;
    const at = performance.now();
    setBorn((was) => new Map([...was, ...fresh.map((id) => [id, at] as const)]));
    window.setTimeout(() => setBorn((was) => new Map([...was].filter(([id]) => !fresh.includes(id)))), BORN_MS);
  }, [layout, booting, rings]);

  // Что кольцам и плитам круглого полотна нужно от раскладки: кто из них вырос, где входят связи, что запущено.
  const ringData = useMemo(() => {
    if (!canvasLayout || !rings) return null;
    const cards = new Map(canvasLayout.cards.map((card) => [card.id, card]));
    const kids = new Map<string, RingKid[]>();
    const parentOf = new Map<string, string>();
    for (const edge of canvasLayout.edges) {
      const card = cards.get(edge.to);
      if (!card) continue;
      parentOf.set(edge.to, edge.from);
      kids.set(edge.from, [...(kids.get(edge.from) ?? []), { id: card.id, path: card.path, kind: card.kind, at: centerOf(card) }]);
    }
    const procs: Procs = { terminals: canvasLayout.cards.filter((card) => card.kind === "terminal").length };
    const root = cards.get(ROOT_CARD_ID);
    const around = root
      ? canvasLayout.cards
          .filter((card) => card.id !== ROOT_CARD_ID && Math.hypot(centerOf(card).x - centerOf(root).x, centerOf(card).y - centerOf(root).y) < 1200)
          .map((card) => ({ x: card.position.x, y: card.position.y, w: card.size.width, h: card.size.height }))
      : [];
    return { cards, kids, parentOf, procs, around, ports: entryPorts(canvasLayout) };
  }, [canvasLayout, rings]);
  const browseOf = useCallback(
    (id: string) => (on: boolean) => setBrowsing((was) => (on ? id : was === id ? null : was)),
    [],
  );

  // В графе рядом с кружком под мышью светятся соседи по связям, остальные тускнеют.
  const near = useMemo(() => {
    const set = new Set<string>();
    if (!view.graph || !hovered) return set;
    set.add(hovered);
    for (const edge of canvasRef.current?.edges ?? []) {
      if (edge.from === hovered) set.add(edge.to);
      if (edge.to === hovered) set.add(edge.from);
    }
    return set;
  }, [view.graph, hovered, structure]);


  // Функции карточки - одни и те же, пока она на полотне: узел с новой функцией не равен прежнему (same), и
  // карточка перерисовывалась бы на каждом кадре протяжки соседки.
  const handsRef = useRef(new Map<string, ReturnType<typeof makeHands>>());
  const makeHands = (id: string) => ({
    browse: browseOf(id),
  });
  // Узел, равный прежнему по содержимому, отдаётся прежним объектом: React Flow тогда карточку не перерисовывает.
  const prevNodes = useRef(new Map<string, CardNode>());

  const nodes = useMemo<CardNode[]>(() => {
    const hands = handsRef.current;
    const next = new Map<string, CardNode>();
    const list = (canvasLayout?.cards ?? []).map((card, index) => {
        let own = hands.get(card.id);
        if (!own) hands.set(card.id, (own = makeHands(card.id)));
        const color = card.id === ROOT_CARD_ID ? DEFAULT_COLOR : lookups.colorFor(card.path);
        const zOf = (id: string) =>
          id === browsing ? 10 : id === (frameIn ?? focusedIn) ? 5 : id === hovered ? 4 : 1;
        const phase = dying.has(card.id) ? "dying" : born.has(card.id) ? "born" : null;
        const parentId = ringData?.parentOf.get(card.id);
        const parent = parentId ? ringData?.cards.get(parentId) : undefined;
        const ring: RingInfo | undefined =
          ringData && isRing(card)
            ? {
                at: centerOf(card),
                kids: ringData.kids.get(card.id) ?? [],
                parent: parent ? centerOf(parent) : null,
                browsing: browsing === card.id,
                browse: own.browse,
                phase,
                procs: card.id === ROOT_CARD_ID ? ringData.procs : null,
                around: card.id === ROOT_CARD_ID ? ringData.around : [],
                onProject: noProject,
              }
            : undefined;
        const port = ringData?.ports.get(card.id);
        const atlas: Atlas | undefined =
          ringData && !isRing(card)
            ? {
                parent: parent ? cardName(parent) : (card.path.split(/[\\/]/).slice(-2, -1)[0] ?? ""),
                port: port ? { x: port.x - card.position.x, y: port.y - card.position.y, side: port.nx !== 0 ? "x" : "y" } : null,
                phase,
              }
            : undefined;
        const node: CardNode = {
        id: card.id,
        type: "card",
        position: card.position,
        data: {
          path: card.path,
          name: cardName(card),
          kind: card.kind,
          title: card.title,
          nameRoot,
          running: running.has(card.id),
          graph: false,
          showGraph: view.enter,
          collapsed: card.collapsed === true,
          color,
          rootPath: lookups.rootPath,
          tree: look.tree,
          hidden: lookups.hidden,
          colorOf: lookups.colorFor,
          cardAt: lookups.cardAt,
          openCard,
          closeCard,
          foldCard,
          paintFolder,
          hideEntry: hideOne,
          markPorts,
          reportRun,
          ring,
          atlas,
        },
        width: card.size.width,
        // Свёрнутая карточка - одна шапка; размер в раскладке остаётся для разворота.
        height: card.collapsed ? FOLDED_HEIGHT : card.size.height,
        // Тот же размер, но как измеренный: стрелки библиотека рисует только между узлами,
        // у которых есть measured, а измерения она кладёт туда сама лишь через dimensions,
        // и они сюда не доходят - раскладка их принимает только при resizing (см. выше).
        // Размер узла и есть размер карточки: тело рисуется ровно в него.
        measured: { width: card.size.width, height: card.collapsed ? FOLDED_HEIGHT : card.size.height },
        // Размытие и заморозка вешаются классами на узел, а не подмешиваются в его данные:
        // тело карточки от этого не перестраивается, и терминал под ними продолжает получать
        // вывод. Пометки независимы: карточка бывает и размытой, и замороженной разом.
        className:
          [
            // Вид оболочки - и на узле: темам нужны тени и штрихи вокруг карточки, а сама
            // карточка обрезает всё, что выходит за её край.
            `kind-${shellOf(card.id, card.kind, cardName(card))}`,
            focused && !focused.has(card.id) && "blurred",
            frameIn === card.id && "frame-focused",
            frozen?.has(card.id) && "frozen",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        // Место карточки в волне запуска; после сборки полотна его никто не читает. Цвет проекта - и
        // на узле: ореол карточки с курсором лежит на нём, за карточкой (index.css).
        style: { "--enter": `${enterDelay(index)}ms`, "--pc": color } as CSSProperties,
        // Порядок по оси z: карточка с курсором ввода поверх карточки под мышью, та - поверх
        // остальных. Без этого библиотека держит порядок по выделению, и карточка, в которую
        // печатают, уходит под соседку, стоит увести мышь.
        zIndex: zOf(card.id),
        };
        const out = view.graph ? asDot(node, card, view.bodies, near.size > 0 && !near.has(card.id)) : node;
        const was = prevNodes.current.get(card.id);
        const kept = was && same(was, out) ? was : out;
        next.set(card.id, kept);
        return kept;
      });
    prevNodes.current = next;
    for (const id of hands.keys()) if (!next.has(id)) hands.delete(id);
    return list;
    // makeHands берёт только постоянные функции и latest: в зависимостях его нет нарочно.
  }, [
      canvasLayout, ringData, browsing, born, dying, openCard, nameRoot, foldCard, paintFolder, hideOne, markPorts, lookups, running, reportRun,
      focused, frozen, hovered, focusedIn, frameIn, view.graph, view.bodies, view.tick, view.enter, near, look.tree, closeCard,
    ]);
  // Обработчики щелчков по узлу - постоянные функции: библиотека отдаёт их обёртке каждого узла, и новая функция
  // на каждой перерисовке окна перерисовывала все карточки полотна (стенд, тикет 12 _scratch/ticket-summary).
  const onNodeClick = useCallback<NodeMouseHandler<CardNode>>(
    (_, node) => {
      if (view.graph) view.leave(node.id);
    },
    [view.graph, view.leave],
  );
  // Двойной щелчок по карточке - камера к ней, карточка во весь экран. Где у двойного щелчка
  // своё дело (слово в терминале и редакторе, поле ввода, кнопка), он остаётся ему.
  const onNodeDoubleClick = useCallback<NodeMouseHandler<CardNode>>(
    (event, node) => {
      if (view.graph || (event.target as Element).closest(".xterm, .cm-editor, input, textarea, button, a")) return;
      flyTo(node.id, false, true);
    },
    [view.graph, flyTo],
  );


  // Набор карточек и их размеры: от них зависят строки-порты и панели агентов, а от мест карточек - нет.
  const shapes = (canvasLayout ?? layout)?.cards.map((card) => `${card.id}:${card.size.width}x${card.size.height}:${card.collapsed ? 1 : 0}`).join("|");
  // Что слой связей берёт у полотна. Новая сцена - только когда сменились её входы: слой связей пересобирает всё
  // по каждой новой сцене, и пересборка на любую отрисовку окна стоила каждого кадра протяжки.
  const scene = useRef<Scene | null>(null);
  useLayoutEffect(() => {
    if (!layout) return;
    scene.current = {
      layout: canvasLayout ?? layout,
      rings,
      theme: theme.id,
      painter: theme.painter,
      colorOf: (card) => (card.id === ROOT_CARD_ID ? DEFAULT_COLOR : lookups.colorFor(card.path)),
      dots: look.dots,
      graph: view.graph ? { bodies: view.bodies, hover: hovered } : null,
      born,
      dying,
    };
  }, [layout, canvasLayout, rings, theme, lookups, look.dots, view.graph, view.bodies, hovered, born, dying]);
  useEffect(() => {
    ports.current.dirty = true;
  }, [shapes]);
  useEffect(() => {
    const shellNode = shell.current;
    const mark = () => (ports.current.dirty = true);
    // Прокрутка списка сдвигает строки, от которых идут связи; всплытия у неё нет - слушается
    // на перехвате.
    shellNode?.addEventListener("scroll", mark, true);
    window.addEventListener("resize", mark);
    return () => {
      shellNode?.removeEventListener("scroll", mark, true);
      window.removeEventListener("resize", mark);
    };
  }, []);

  // Взятую карточку ставит в раскладку полёт (ice.ts): он догоняет руку и катит брошенную дальше.
  const place = useCallback((moves: ReadonlyMap<string, { x: number; y: number }>) => {
    setLayout((current) =>
      current ? [...moves].reduce((next, [id, position]) => updateCard(next, id, { position }), current) : current,
    );
  }, []);
  const positionOf = useCallback((id: string) => layoutRef.current?.cards.find((card) => card.id === id)?.position, []);
  const zoom = useCallback(() => flow.getZoom(), [flow]);
  const cardIce = useCardIce(place, positionOf, zoom);
  const { take } = cardIce;
  // Силы круглого полотна: настройки в хранилище окна, тянутая рукой карточка стоит, остальные расступаются.
  const [phys, setPhys] = useState<Forces>(initialForces);
  const changePhys = useCallback((next: Forces) => {
    saveForces(next);
    setPhys(next);
  }, []);
  // Кнопки и ряд значков - готовыми элементами: окно перерисовывается на каждом кадре протяжки, а они от неё не зависят.
  const controls = useMemo(
    () => (
      <Controls showFitView={false}>
        <CanvasButtons
          look={look}
          onLook={changeLook}
          forces={rings ? { value: phys, onChange: changePhys } : undefined}
        />
      </Controls>
    ),
    [look, changeLook, rings, phys, changePhys],
  );
  const held = useRef<string | null>(null);
  const forces = useForces(rings, phys, canvasRef, place, held);
  forcesMoving.current = forces.moving.current;
  // Карточку открыли или закрыли - силы просыпаются. reheat постоянный: объект forces новый на каждой отрисовке.
  const { reheat } = forces;
  const cardCount = layout?.cards.length ?? 0;
  useEffect(() => reheat(1), [cardCount, reheat]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      // В графе тянут кружок, а не карточку: раскладка полотна остаётся как была.
      if (view.graph) return view.drag(changes);
      // Карточку выбрали, двигают или тянут за угол - это обращение к ней. Выделение здесь
      // не лишнее: у замороженной карточки тело не рисуется, и мышью в него не попасть -
      // клик по шапке остаётся единственным способом её разбудить.
      for (const change of changes) {
        if (change.type === "position" || change.type === "dimensions" || change.type === "select") {
          touch(change.id);
        }
      }
      // На льду ходы карточек уходят полёту; остальное и всё при отключённом движении - сразу в раскладку.
      const flying = !still() && changes.some((change) => change.type === "position");
      if (flying) take(changes);
      const others = flying ? changes.filter((change) => change.type !== "position") : changes;
      setLayout((current) => (current ? others.reduce(applyNodeChange, current) : current));
    },
    [touch, take, view.graph, view.drag],
  );

  return (
    <>
      <div
        className={booting ? "canvas canvas--booting" : "canvas"}
        ref={shell}
        onKeyDownCapture={onKeyDown}
      >
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onMoveStart={onMoveStart}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          onNodeDragStart={(_, node) => {
            window.dispatchEvent(new Event(CANVAS_MOVE));
            cardIce.grab(node.id);
            held.current = node.id;
            forces.reheat(0.3);
          }}
          onNodeDrag={(event, node) => {
            const at = "touches" in event ? event.touches[0] : event;
            cardIce.drag(node.id, event.timeStamp, at?.clientX ?? NaN, at?.clientY ?? NaN);
            forces.reheat(0.3);
          }}
          onNodeDragStop={(event, node) => {
            cardIce.drop(node.id, event.timeStamp);
            held.current = null;
            forces.reheat(0.5);
          }}
          // Нажатие останавливает лёд: полотно встаёт, едущая карточка под рукой - тоже.
          onPointerDownCapture={(event) => {
            ice.current.glide = null;
            const id = (event.target as Element).closest(".react-flow__node")?.getAttribute("data-id");
            if (id) cardIce.stop(id);
          }}
          className={moving ? "moving" : undefined}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={onNodeLeave}
          maxZoom={MAX_ZOOM}
          // Подпись библиотеки в углу полотна не нужна: лицензия MIT её не требует.
          proOptions={{ hideAttribution: true }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          colorMode={theme.dark ? "dark" : "light"}
          style={
            {
              "--wall": look.wall ? `url("${look.wall}")` : "none",
              "--glass-blur": `${look.blur}px`,
            } as CSSProperties
          }
        >
          <FitMinZoom />
          {look.glass && <div className="glass" />}
          <LinkCanvas
            scene={scene}
            ports={ports}
            ice={ice}
            onSettle={settle}
          />
          {/* Встроенная кнопка "вписать" спрятана: её место заняла своя, с прицелом (Look.tsx). */}
          {controls}
          {FPS}
          {(
            view.graph
          ) && (
            <Panel position="top-center">
              <div className="bands">
                {view.graph && (
                  <div className="graphbar">
                    Граф проектов: щелчок по кружку - к его карточке
                    <button type="button" onClick={() => view.leave()}>
                      Вернуть карточки
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </>
  );
}
