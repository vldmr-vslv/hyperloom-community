// Темы полотна: у каждой свой вид карточек (лист стилей поверх index.css), своё рисование связей,
// своя палитра цветов проекта и свой шрифт. Тёмная тема - сам index.css, её лист пустой.
import { setPalette, readable, type Palette } from "../palette";
import { darkPainter } from "./dark.paint";
import type { Painter } from "./painter";

/** Названия готовых цветов одни во всех темах: по месту в списке цвет проекта переезжает из темы
 *  в тему. */
const NAMES = ["Нейтральный", "Синий", "Голубой", "Бирюзовый", "Зелёный", "Лаймовый", "Фиолетовый", "Розовый"];

function presets(hexes: string[]): Palette["presets"] {
  return hexes.map((hex, i) => ({ name: NAMES[i], hex }));
}


export type Theme = {
  id: string;
  name: string;
  /** Тёмный стол: React Flow и встроенные элементы браузера - в тёмном виде. */
  dark: boolean;
  palette: Palette;
  painter: Painter;
  /** Лист стилей темы поверх index.css. */
  css: string;
  /** Шрифт темы с Google Fonts. Без сети текст пойдёт запасным шрифтом из листа темы. */
  font?: string;
};

export const THEMES: Theme[] = [
  {
    id: "dark",
    name: "Тёмная",
    dark: true,
    palette: {
      canvas: "#1a1a1a",
      toward: "#ffffff",
      defaultColor: "#e8ecf4",
      presets: presets(["#e8ecf4", "#5b9cf5", "#38d4f0", "#2dd4bf", "#4ade80", "#b6e35a", "#a98bff", "#f472b6"]),
    },
    painter: darkPainter,
    css: "",
  },
];

export function themeOf(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/**
 * Цвет проекта из раскладки - в палитре выбранной темы. Готовый цвет любой темы встаёт на своё место
 * в этой: синий остаётся синим, но таким, какой читается на её столе. Свой цвет подтягивается,
 * пока линия не читается. В раскладке цвет не меняется: вернули тему - вернулся и цвет.
 */
export function shown(hex: string, theme: Theme): string {
  const key = hex.toLowerCase();
  for (const other of THEMES) {
    const index = other.palette.presets.findIndex((preset) => preset.hex.toLowerCase() === key);
    if (index >= 0) return theme.palette.presets[index]?.hex ?? hex;
  }
  return readable(key);
}

const THEME_KEY = "hyperloom.theme";

/** Темы, кроме этой, выключены: на них сейчас не тратим время (решение Влада). Снять - null. */
export const THEME_LOCK: string | null = "dark";

/** Тема, выбранная в прошлый раз. Хранилище окна бывает недоступно - тогда первая по списку. */
export function savedTheme(): string {
  if (THEME_LOCK) return THEME_LOCK;
  try {
    return themeOf(localStorage.getItem(THEME_KEY) ?? "").id;
  } catch {
    return THEMES[0].id;
  }
}

/**
 * Тема ложится на страницу: атрибут на корень, свой лист стилей, свой шрифт, своя палитра. Окно
 * узнаёт о смене событием "theme-change": по нему перекрашиваются уже открытые терминалы.
 * Выбор запоминается в хранилище окна.
 */
export function applyTheme(id: string): void {
  const theme = themeOf(id);
  document.documentElement.dataset.theme = theme.id;
  const sheet = document.getElementById("theme-css") ?? document.head.appendChild(document.createElement("style"));
  sheet.id = "theme-css";
  sheet.textContent = theme.css;
  let font = document.getElementById("theme-font") as HTMLLinkElement | null;
  if (theme.font) {
    font ??= document.head.appendChild(Object.assign(document.createElement("link"), { id: "theme-font", rel: "stylesheet" }));
    font.href = theme.font;
  } else font?.remove();
  setPalette(theme.palette);
  window.dispatchEvent(new Event("theme-change"));
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    // Хранилище недоступно: тема действует до перезапуска, дальше - первая по списку.
  }
}
