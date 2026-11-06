import { useEffect, useState } from "react";

/** Карточка, в которой лежит элемент. */
export function cardOf(el: EventTarget | null): string | null {
  return (el instanceof Element && el.closest(".react-flow__node")?.getAttribute("data-id")) || null;
}

/** Карточка, в которой сейчас курсор. Берётся из самого фокуса документа: пришёл фокус - его
 *  карточка, ушёл - та, куда ушёл, а ушёл мимо карточек (щелчок по полотну, другое окно) - никакой. */
export function useFocusedCard(): string | null {
  // Ряд появляется, когда курсор уже может стоять в карточке: тогда фокус берётся сразу.
  const [id, setId] = useState<string | null>(() => cardOf(document.activeElement));
  useEffect(() => {
    const enter = (event: FocusEvent) => setId(cardOf(event.target));
    const leave = (event: FocusEvent) => setId(cardOf(event.relatedTarget));
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
    };
  }, []);
  return id;
}

/** Карточка, во фрейме страницы которой курсор (сводка, Roadmap, браузер-карточка). Фрейм с другим источником окну
 *  событиями не виден: :focus и focusin он не получает, окну приходит только blur, а активным элементом становится
 *  сам фрейм. Пока окно без фокуса, активный элемент проверяется по таймеру: переход между фреймами и уход в другое
 *  окно (document.hasFocus() ложно) иначе не заметить.
 *  ponytail: опрос раз в 250 мс, пока окно без фокуса. Потолок - подсветка отстаёт от щелчка до четверти секунды;
 *  апгрейд - страницы сами сообщают о фокусе сообщением, но чужие страницы этого не умеют. */
export function useFrameFocus(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    const look = () => {
      const active = document.activeElement;
      setId(document.hasFocus() && active?.tagName === "IFRAME" ? cardOf(active) : null);
    };
    const blur = () => {
      look();
      clearInterval(timer);
      timer = window.setInterval(look, 250);
    };
    const focus = () => {
      clearInterval(timer);
      setId(null);
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);
  return id;
}

