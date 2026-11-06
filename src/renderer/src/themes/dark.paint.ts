// Рисование связей тёмной темы: свет на почти чёрном столе. Светлые точки фона, связи в цвет концов, шарики и
// лампочки со складывающимся ореолом.
import { mix, rgba } from "../palette";
import {
  halo,
  pathOf,
  type Painter,
} from "./painter";


/** Шарик и лампочка: ореол складывается со светом, сама точка кладётся поверх как есть. */
function light(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, power: number, reach: number, core: number, ring: boolean): void {
  ctx.globalCompositeOperation = "lighter";
  halo(ctx, x, y, reach, [[0, color, 0.5], [1, color, 0]], power);
  ctx.globalCompositeOperation = "source-over";
  if (ring) {
    ctx.beginPath();
    ctx.arc(x, y, core + 1.6, 0, 2 * Math.PI);
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, core, 0, 2 * Math.PI);
  ctx.fillStyle = mix(color, "#ffffff", 0.2 + 0.35 * power);
  ctx.fill();
}

export const darkPainter: Painter = {
  dot(g, x, y, dpr) {
    g.fillStyle = rgba("#ffffff", 0.16);
    g.beginPath();
    g.arc(x, y, 1.3 * dpr, 0, 2 * Math.PI);
    g.fill();
  },

  lines(ctx, items) {
    ctx.lineJoin = "round";
    for (const item of items) {
      const pts = item.route.points;
      if (pts.length < 2) continue;
      const path = pathOf(item);
      const alpha = 0.85;
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (item.from === item.to) ctx.strokeStyle = rgba(item.to, alpha);
      else {
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, rgba(item.from, alpha));
        g.addColorStop(1, rgba(item.to, alpha));
        ctx.strokeStyle = g;
      }
      ctx.lineWidth = 1.4;
      ctx.stroke(path);
    }
  },


  ball(top, x, y, color, shine) {
    light(top, x, y, color, shine, 9, 3.2, true);
  },

  lamp(top, x, y, lamp, glow) {
    light(top, x, y, lamp.color, glow, 10, 3.5, false);
  },

};
