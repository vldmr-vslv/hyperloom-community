import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Меню закрываются, когда двигается полотно или карточка: событие шлёт App. */
export const CANVAS_MOVE = "canvas-move";

/**
 * Меню поверх полотна, у своей кнопки. Кнопка внизу экрана - меню открывается вверх, кнопка
 * слева - меню растёт вправо. Закрывается той же кнопкой, щелчком мимо, Esc, а само - когда
 * двигаются полотно или карточка. Нажатие слушается на перехвате: React Flow гасит нажатие
 * на полотне, и до обычного обработчика оно не доходит.
 */
export function Menu({
  anchor,
  label,
  onClose,
  className,
  children,
}: {
  /** Кнопка меню; у кольца это кнопка в его SVG, поэтому Element, а не HTMLElement. */
  anchor: Element;
  label: string;
  onClose: () => void;
  /** Свой вид меню поверх общего: ряд значков вместо списка пунктов. */
  className?: string;
  children: ReactNode;
}) {
  const rect = anchor.getBoundingClientRect();
  const up = rect.top > window.innerHeight / 2;
  const left = rect.left < window.innerWidth / 2;
  const place = {
    ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    ...(left ? { left: rect.right + 6 } : { right: window.innerWidth - rect.left + 6 }),
  };
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".menu") && !anchor.contains(target)) onClose();
    };
    const esc = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    window.addEventListener(CANVAS_MOVE, onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener(CANVAS_MOVE, onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className={className ? `menu ${className}` : "menu"} role="menu" aria-label={label} style={place}>
      {children}
    </div>,
    document.body,
  );
}

/** Пункт меню - один выбор из нескольких: отметка стоит у выбранного. */
export function MenuRadio({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={onClick}>
      <span className="menu__mark" aria-hidden="true" />
      {children}
    </button>
  );
}

/** Открыто ли меню и у какой кнопки. Та же кнопка закрывает его. */
export function useMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useRef(() => setAnchor(null)).current;
  return { anchor, toggle: (el: HTMLElement) => setAnchor((was) => (was ? null : el)), close };
}
