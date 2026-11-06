// Подсказки, как в прототипе (_scratch/root-dial, "подсказки"): вместо системных - плашка со срезанным углом над
// курсором, появляется миганием. title у элемента становится data-tip, когда на него пришёл курсор: системная подсказка
// не успевает всплыть, а наблюдатель за всем документом не нужен (он разбирал каждый кусок ответа в чате). У кнопки без
// своей подписи заодно aria-label: до наведения её имя для читалки экрана - сам title. SVG-<title> в разметке не
// используется: React держит такие узлы сам, и убирать их из DOM нельзя - у кольца и вееров подсказки сразу в data-tip.

const SHOW_DELAY = 380;

function tipify(el: Element): void {
  const text = el.getAttribute("title");
  if (text === null) return;
  el.removeAttribute("title");
  if (!text) return el.removeAttribute("data-tip");
  el.setAttribute("data-tip", text);
  if ((el instanceof HTMLButtonElement || el.getAttribute("role") === "button") && !el.hasAttribute("aria-label") && !el.textContent?.trim()) {
    el.setAttribute("aria-label", text);
  }
}

/** Ставит подсказки на всё окно: вызывается один раз при запуске. */
export function installTips(): void {
  const tip = Object.assign(document.createElement("div"), { className: "tip" });
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  // Курсор вошёл в элемент: его title и title предков становятся подсказками до того, как всплыла бы системная.
  addEventListener(
    "pointerover",
    (event) => {
      for (let el = event.target instanceof Element ? event.target : null; el; el = el.parentElement) tipify(el);
    },
    true,
  );

  let shown: string | null = null;
  let timer = 0;
  let x = 0;
  let y = 0;
  let down = false;
  const place = () => {
    // Ширина без переноса меряется от левого края: с прошлого места у правого края строка обрезалась бы о край окна.
    tip.style.left = "0px";
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(x - w / 2, innerWidth - w - 8))}px`;
    tip.style.top = `${y - h - 16 >= 8 ? y - h - 16 : Math.min(y + 22, innerHeight - h - 8)}px`;
  };
  const hide = () => {
    tip.classList.remove("tip--on");
    tip.classList.add("tip--off");
  };
  // Первая подсказка - после паузы, следующая, пока плашка видна, - сразу; ушёл с подсказок - плашка гаснет.
  const show = (text: string | null) => {
    if (text === shown) {
      if (text) place();
      return;
    }
    shown = text;
    window.clearTimeout(timer);
    if (!text) {
      timer = window.setTimeout(hide, 120);
      return;
    }
    const go = () => {
      tip.textContent = text;
      tip.classList.remove("tip--off", "tip--on");
      void tip.offsetWidth;
      tip.classList.add("tip--on");
      place();
    };
    if (tip.classList.contains("tip--on")) go();
    else timer = window.setTimeout(go, SHOW_DELAY);
  };
  addEventListener("pointerdown", () => ((down = true), show(null)), true);
  addEventListener("pointerup", () => (down = false), true);
  addEventListener("pointermove", (event) => {
    x = event.clientX;
    y = event.clientY;
    const target = event.target instanceof Element ? event.target.closest("[data-tip], [title]") : null;
    if (target) tipify(target);
    show(down ? null : (target?.getAttribute("data-tip") ?? null));
  });
  addEventListener("wheel", () => show(null), { passive: true });
  addEventListener("blur", () => show(null));
}
