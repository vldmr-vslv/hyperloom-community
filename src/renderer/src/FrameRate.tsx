import { useEffect, useState } from "react";

/**
 * Счётчик кадров в углу полотна. Считает не отрисовку карточек, а кадры окна: провал
 * ниже полусотни при панорамировании и означает, что полотно не тянет. Цифра обновляется
 * раз в секунду - перерисовка счётчика на каждом кадре сама стоила бы кадров. Рядом худший
 * кадр за ту же секунду: среднее прячет рывок, одна задержка в полсекунды даёт ещё 30 fps.
 */
export function FrameRate() {
  const [shown, setShown] = useState({ fps: 0, worst: 0 });

  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    let last = since;
    let worst = 0;
    let scheduled = requestAnimationFrame(function tick(now: number) {
      frames += 1;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - since >= 1000) {
        setShown({ fps: Math.round((frames * 1000) / (now - since)), worst: Math.round(worst) });
        frames = 0;
        worst = 0;
        since = now;
      }
      scheduled = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(scheduled);
  }, []);

  return (
    <div className={shown.worst > 50 ? "fps fps--jank" : "fps"} data-tip="Кадров в секунду и самый долгий кадр за эту секунду">
      {shown.fps} fps · {shown.worst} мс
    </div>
  );
}
