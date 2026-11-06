// Веер у кромки кольца: цвет проекта - керамические кружки дугой снаружи кольца, в той стороне, где свободно от
// связей; надпись по дуге над ними.
import { useId, useRef, type CSSProperties } from "react";
import { CANVAS, contrast, PRESETS, readable } from "./palette";
import { arc, f, pt, textArc } from "./ring-svg";

/** Направление, где на кольце свободнее всего от связей (углы used). */
export function freeAngle(used: number[]): number {
  if (used.length === 0) return -30;
  let best = { a: 0, room: -1 };
  for (let a = 0; a < 360; a += 10) {
    const room = Math.min(...used.map((u) => Math.abs(((a - u + 540) % 360) - 180)));
    if (room > best.room) best = { a, room };
  }
  return best.a;
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function FanLabel({ r, a, text }: { r: number; a: number; text: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <g className="fan__in" style={delay(420)} pointerEvents="none">
      <path id={id} d={textArc(r, a)} fill="none" />
      <text dominantBaseline="central" className="fan__text">
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {text}
        </textPath>
      </text>
    </g>
  );
}


/** Готовые цвета темы и свой: свой - системным выбором цвета, подтягивается до читаемого на столе. */
export function PaintFan({ R, a, color, onPaint }: { R: number; a: number; color: string; onPaint: (hex: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const custom = !PRESETS.some((p) => p.hex === color);
  const items = [...PRESETS.map((p) => ({ hex: p.hex as string | null, name: p.name, on: p.hex === color })), { hex: null, name: "Свой цвет", on: custom }];
  const r = R + 44;
  const step = (27 / r) * (180 / Math.PI);
  const half = ((items.length - 1) / 2) * step;
  return (
    <g className="fan">
      <path className="fan__in" style={delay(0)} d={arc(r + 18, a - half - 10, a + half + 10)} fill="none" stroke="rgb(255 255 255 / .2)" />
      {items.map((it, i) => {
        const [x, y] = pt(r, a - half + i * step);
        return (
          <g key={it.name} transform={`translate(${f(x)} ${f(y)})`}>
            <g
              className="fan__in fan__item nodrag"
              style={delay(40 + i * 35)}
              onClick={() => (it.hex ? onPaint(it.hex) : input.current?.showPicker())}
              data-tip={it.name}
            >
              <circle r="10" fill={it.hex ?? (it.on ? color : "#0d0d0c")} stroke={it.on ? "#f3f3f1" : "rgb(255 255 255 / .22)"} strokeWidth={it.on ? 2 : 1} />
              {!it.hex && !it.on && <path d="M0 -4.5V4.5M-4.5 0H4.5" stroke="#d6d6d3" strokeWidth="1.3" strokeLinecap="round" />}
            </g>
          </g>
        );
      })}
      <foreignObject width="1" height="1" x={0} y={0}>
        <input ref={input} type="color" className="fan__color" value={color} onChange={(event) => onPaint(readable(event.target.value))} />
      </foreignObject>
      <FanLabel r={r + 26} a={a} text={`ЛИНИЯ НА ПОЛОТНЕ ${contrast(color, CANVAS).toFixed(1)}:1`} />
    </g>
  );
}
