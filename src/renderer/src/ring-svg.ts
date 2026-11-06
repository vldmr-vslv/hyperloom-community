// Мелкая геометрия SVG для колец круглого полотна: дуги, секторы, деления, подписи по касательной и давность.
// Углы в градусах, 0 - вправо, 90 - вниз, как у экрана.

export const rad = (d: number) => (d * Math.PI) / 180;
export const f = (n: number) => n.toFixed(1);

/** Точка на окружности радиуса r под углом d. */
export function pt(r: number, d: number): [number, number] {
  return [r * Math.cos(rad(d)), r * Math.sin(rad(d))];
}

export function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
}

/** Кольцевой сектор между радиусами r0 и r1. */
export function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
}

const tickPaths = new Map<string, string>();

/** Деления по кругу от r0 до r1 через step градусов. Запоминаются: кольца рисуют их на каждой перерисовке полотна, а
 *  это каждый кадр протяжки. */
export function ticks(r0: number, r1: number, step: number): string {
  const key = `${r0} ${r1} ${step}`;
  let d = tickPaths.get(key);
  if (d !== undefined) return d;
  d = "";
  for (let a = 0; a < 360; a += step) {
    const [x0, y0] = pt(r0, a);
    const [x1, y1] = pt(r1, a);
    d += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
  }
  if (tickPaths.size > 100) tickPaths.clear();
  tickPaths.set(key, d);
  return d;
}

/** Поворот подписи по касательной к окружности в точке угла a: на нижней половине - не вверх ногами. */
export function tangentTurn(a: number): number {
  return Math.sin(rad(a)) > 0.05 ? a - 90 : a + 90;
}

/** Дуга под надпись вокруг угла a: на нижней половине идёт против часовой, чтобы буквы не встали вверх ногами. */
export function textArc(r: number, a: number, span = 60): string {
  const flip = Math.sin(rad(a)) > 0.05;
  const [x0, y0] = pt(r, flip ? a + span : a - span);
  const [x1, y1] = pt(r, flip ? a - span : a + span);
  return `M${f(x0)} ${f(y0)}A${r} ${r} 0 0 ${flip ? 0 : 1} ${f(x1)} ${f(y1)}`;
}

/** Полный круг как путь для textPath: начинается слева. */
export function circlePath(r: number): string {
  return `M ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0`;
}

export const cut = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "." : s);

/** Давность словами: "5 мин", "3 ч", "2 дн", "4 мес". */
export function age(t: number, now = Date.now()): string {
  if (!t) return "";
  const m = (now - t) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} мин`;
  if (m < 1440) return `${Math.round(m / 60)} ч`;
  if (m < 60 * 24 * 60) return `${Math.round(m / 1440)} дн`;
  return `${Math.round(m / 43200)} мес`;
}

export function plural(n: number, [one, few, many]: [string, string, string]): string {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return few;
  return many;
}

/** Служебные папки на обод не выходят: их не открывают руками. */
export const service = (name: string) => name.startsWith(".") || name === "node_modules";

/** Вид файла по имени: значок и цвет в ветке и водопаде. */
export function fileKind(name: string): "img" | "doc" | "code" | "file" {
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name)) return "img";
  if (/\.(md|txt)$/i.test(name)) return "doc";
  if (/\.(tsx?|jsx?|mjs|cjs|json|css|html?|ya?ml|sh)$/i.test(name)) return "code";
  return "file";
}

export const FILE_ICON: Record<ReturnType<typeof fileKind>, [string, string]> = {
  img: ["M-5 -4h10v8h-10zM-5 2.5l3-3 2.5 2.5 1.5-1.5 3 3M2 -1.5a1 1 0 1 0 0.01 0", "#5b9cf5"],
  doc: ["M-4 -5h5l3 3v7h-8zM-2 0h4M-2 2.5h4", "#e2e2df"],
  code: ["M-2 -3.5L-5 0L-2 3.5M2 -3.5L5 0L2 3.5", "#4ade80"],
  file: ["M-4 -5h5l3 3v7h-8z", "#9a9a97"],
};

export const ICON_FOLDER = "M-6 -3.5h4l1.5 1.5h6.5v6.5h-12z";
export const ICON_FILE = "M-4 -5h5l3 3v7h-8z";
