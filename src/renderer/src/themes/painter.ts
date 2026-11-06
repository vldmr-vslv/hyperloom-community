// Рисование связей по темам: что слой связей (LinkCanvas.tsx) отдаёт теме и что тема рисует.
// Цикл кадра, замер строк, пути и сетка фона - в LinkCanvas; тема рисует только вид.
import type { Route } from "../../../shared/route";
import { rgba } from "../palette.ts";

/** Рамка карточки. round - кольцо круглого полотна, круг в квадрате рамки. */
export type Frame = { x: number; y: number; w: number; h: number; r: number; round?: boolean };

/** Связь на кадр: путь, цвета концов, карточки на концах. */
export type Drawn = {
  id: string;
  route: Route;
  /** Цвета проекта на концах: начало и конец. */
  from: string;
  to: string;
  /** Карточки в начале и на конце. */
  source: string;
  target: string;
  /** Рамки карточек на концах. */
  a: Frame;
  b: Frame;
};

/** Лампочка шапки карточки: x, y - левый верхний угол карточки. */
export type Lamp = {
  id: string;
  x: number;
  y: number;
  flat: boolean;
  /** Шапка папки или корня: у темы она бывает залита тёмным, и лампочка на ней светлая. */
  folder: boolean;
  color: string;
  work: boolean;
};


/**
 * Рисование одной темы. Координаты - полотна: холсты уже сдвинуты и растянуты под масштаб.
 * ctx - нижний холст (под карточками), top - верхний (над ними). t - время в секундах, 0 при
 * отключённом движении. near - масштаб от 0.6: мельче сдвиги в пиксель уже не видны.
 */
export type Painter = {
  /** Одна точка фона в плитке узора, в пикселях плитки. dpr - плотность экрана. */
  dot(g: CanvasRenderingContext2D, x: number, y: number, dpr: number): void;
  /** Связи - все разом: тема может рисовать их проходами. */
  lines(ctx: CanvasRenderingContext2D, items: Drawn[], t: number, near: boolean): void;
  /** Шарик на кромке у конца простой связи. shine - мерцание около 0.8. */
  ball(top: CanvasRenderingContext2D, x: number, y: number, color: string, shine: number, near: boolean): void;
  /** Лампочка шапки: (x, y) - её середина. glow - мерцание около 0.8. */
  lamp(top: CanvasRenderingContext2D, x: number, y: number, lamp: Lamp, glow: number, t: number): void;
};




/** Ореолы картинкой. От кадра к кадру у ореола меняются только место, размер и общая яркость, а новый
 *  радиальный градиент на каждый ореол в каждом кадре был самой дорогой работой GPU на слое связей.
 *  Поэтому градиент рисуется раз на свой холст и дальше кладётся drawImage с globalAlpha. Холст вдвое
 *  детальнее ореола на экране, сторона - степень двойки: у белого ядра крутой спад, и при выборке без
 *  запаса центр ореола выходил тусклее градиента на 20 уровней. Гладкий градиент от частой выборки не рябит. */
const halos = new Map<string, HTMLCanvasElement>();

/** Ореол радиуса r: stops - [доля радиуса, цвет, прозрачность], alpha - общий множитель прозрачностей. */
export function halo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: readonly (readonly [number, string, number])[],
  alpha: number,
): void {
  const peak = Math.max(...stops.map((stop) => stop[2]));
  if (alpha <= 0 || peak <= 0 || r <= 0) return;
  const m = ctx.getTransform();
  const size = 2 ** Math.min(9, Math.max(2, Math.ceil(Math.log2(2 * r * Math.hypot(m.a, m.b)))));
  const key = `${size}|${stops.join("|")}`;
  let sprite = halos.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 2 * size;
    const g = sprite.getContext("2d")!;
    const fill = g.createRadialGradient(size, size, 0, size, size, size);
    // Ярче всего точка цвета с прозрачностью 1: так картинка не теряет точность на тусклом ореоле.
    for (const [at, color, a] of stops) fill.addColorStop(at, rgba(color, a / peak));
    g.fillStyle = fill;
    g.fillRect(0, 0, 2 * size, 2 * size);
    if (halos.size > 300) halos.clear();
    halos.set(key, sprite);
  }
  const was = ctx.globalAlpha;
  ctx.globalAlpha = was * Math.min(1, alpha * peak);
  ctx.drawImage(sprite, x - r, y - r, 2 * r, 2 * r);
  ctx.globalAlpha = was;
}

/** Путь связи по её точкам. */
export function pathOf(item: Drawn): Path2D {
  const path = new Path2D();
  item.route.points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  return path;
}


export function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 159;
}

