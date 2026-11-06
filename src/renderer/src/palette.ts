// Цвет проекта и контраст по WCAG. Карточки нейтральные, цвет проекта живёт в акцентах: лампочка,
// открытые плитки и строки, свечение терминала и агента, связи. Палитра своя у каждой темы
// (themes/index.ts); здесь - палитра темы, выбранной сейчас.

/** Палитра темы: стол, тон, к которому подтягивается нечитаемый свой цвет, цвет по умолчанию и 8
 *  готовых цветов. Янтаря и красного среди готовых нет: они заняты под события. */
export type Palette = {
  canvas: string;
  /** К чему подтягивать цвет, пока линия этого цвета не читается на столе: белый на тёмном столе,
   *  тёмный тон темы на светлом. */
  toward: string;
  defaultColor: string;
  presets: { name: string; hex: string }[];
};

/** Стол полотна: по нему считается, читается ли линия цвета проекта. */
export let CANVAS = "#1a1a1a";
/** Цвет проекта по умолчанию. */
export let DEFAULT_COLOR = "#e8ecf4";
/** 8 готовых цветов темы. */
export let PRESETS: Palette["presets"] = [];
let toward = "#ffffff";

/** Палитра выбранной темы: её берут меню карточек и полотно на следующей отрисовке. */
export function setPalette(palette: Palette): void {
  CANVAS = palette.canvas;
  DEFAULT_COLOR = palette.defaultColor;
  PRESETS = palette.presets;
  toward = palette.toward;
}

export function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function mix(a: string, b: string, t: number): string {
  const x = channels(a);
  const y = channels(b);
  return (
    "#" +
    x
      .map((v, i) => Math.round(Math.max(0, Math.min(255, v + (y[i] - v) * t))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Свой цвет подтягивается к тону темы, пока линия этого цвета не читается на столе (3:1). */
export function readable(hex: string): string {
  let color = hex.toLowerCase();
  for (let step = 0; step < 24 && contrast(color, CANVAS) < 3; step++) color = mix(color, toward, 0.1);
  return color;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
