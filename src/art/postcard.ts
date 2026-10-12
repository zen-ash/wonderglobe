// Postcards: a snapshot of the planet laid into a cream card with a wobbly
// crayon frame, a colourful "My Wonderglobe" title, the date, the place and a
// few stickers stuck on the corners.

import { crayonStroke, ctx2d, makeCanvas, paperGrain, rectPts, wobble, INK, type Pt } from "./crayon";
import { createRng } from "./rng";
import { stickerCanvas, type StickerArtSpec } from "./stickers";

export const POSTCARD_W = 1400;
export const POSTCARD_H = 1000;

/** The page's rounded display font (falls back to a friendly system font). */
export function uiFont(): string {
  if (typeof document === "undefined") return `"Trebuchet MS", system-ui, sans-serif`;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-round").trim();
  return `${v ? v + ", " : ""}"Nunito", "Trebuchet MS", system-ui, sans-serif`;
}

const LETTER_COLORS = ["#e8453c", "#ff8a2b", "#e0a800", "#2f9e44", "#4dabf7", "#3b5bdb", "#8e5bd6", "#ff7eb6"];

export interface PostcardOptions {
  photo: CanvasImageSource & { width: number; height: number };
  region: string;
  date: Date;
  title?: string;
  /** A few earned stickers to stick on the corners. */
  stickers?: StickerArtSpec[];
  seed?: number;
}

function star(cx: number, cy: number, r: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

export function composePostcard(o: PostcardOptions): HTMLCanvasElement {
  const W = POSTCARD_W;
  const H = POSTCARD_H;
  const c = makeCanvas(W, H);
  const ctx = ctx2d(c, true);
  const rng = createRng(o.seed ?? 4242);
  const font = uiFont();

  // Cream card.
  ctx.fillStyle = "#fff8e7";
  ctx.fillRect(0, 0, W, H);
  paperGrain(ctx, W, H, rng, 0.6);

  // Photo, slightly tilted, with a white print border.
  const px = 110;
  const py = 170;
  const pw = W - 220;
  const ph = 640;
  ctx.save();
  ctx.translate(W / 2, py + ph / 2);
  ctx.rotate(-0.012);
  ctx.translate(-W / 2, -(py + ph / 2));
  ctx.fillStyle = "rgba(43,35,32,0.18)";
  ctx.fillRect(px - 10, py - 4, pw + 28, ph + 30);
  ctx.fillStyle = "#fffdf6";
  ctx.fillRect(px - 16, py - 16, pw + 32, ph + 32);
  const s = Math.max(pw / o.photo.width, ph / o.photo.height);
  const sw = pw / s;
  const sh = ph / s;
  ctx.drawImage(o.photo, (o.photo.width - sw) / 2, (o.photo.height - sh) / 2, sw, sh, px, py, pw, ph);
  // Wobbly crayon frame, two colours.
  const frame = wobble(rectPts(px - 6, py - 6, pw + 12, ph + 12), rng, 4, 30, true);
  crayonStroke(ctx, frame, { color: "#ff8a2b", width: 11, rng, closed: true, passes: 2, smooth: false });
  const frame2 = wobble(rectPts(px - 20, py - 20, pw + 40, ph + 40), rng, 5, 34, true);
  crayonStroke(ctx, frame2, { color: "#4dabf7", width: 6, rng, closed: true, passes: 2, smooth: false });
  ctx.restore();

  // Title: one crayon colour per letter, bouncing a little.
  const title = o.title ?? "My Wonderglobe";
  ctx.font = `700 92px ${font}`;
  ctx.textBaseline = "alphabetic";
  let x = 120;
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    const w = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(x + w / 2, 128 + Math.sin(i * 1.3) * 6);
    ctx.rotate((rng.next() - 0.5) * 0.12);
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#fffdf6";
    ctx.strokeText(ch, -w / 2, 0);
    ctx.fillStyle = LETTER_COLORS[i % LETTER_COLORS.length];
    ctx.fillText(ch, -w / 2, 0);
    ctx.restore();
    x += w + 2;
  }

  // Place and date along the bottom.
  const date = o.date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  ctx.fillStyle = INK;
  ctx.font = `700 52px ${font}`;
  ctx.fillText(o.region || "Wonderglobe", 130, 905);
  ctx.font = `600 38px ${font}`;
  ctx.fillStyle = "#5b4a42";
  ctx.fillText(date, 130, 955);
  // A little map pin before the place name.
  ctx.save();
  ctx.translate(92, 888);
  ctx.fillStyle = "#ef5b5b";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -10, 16, Math.PI, 0);
  ctx.lineTo(0, 22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fffdf6";
  ctx.beginPath();
  ctx.arc(0, -10, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Doodles: stars and a heart in crayon.
  const doodles: Array<[number, number, string]> = [
    [W - 330, 90, "#ffd23f"],
    [W - 250, 60, "#ff7eb6"],
    [W - 520, 930, "#8fd14f"],
  ];
  for (const [dx, dy, col] of doodles) crayonStroke(ctx, star(dx, dy, 26), { color: col, width: 6, rng, closed: true, passes: 2, smooth: false });

  // Stickers stuck on.
  const spots: Array<[number, number, number]> = [
    [W - 150, 120, 0.2],
    [W - 170, 900, -0.18],
    [W - 360, 905, 0.12],
  ];
  (o.stickers ?? []).slice(0, 3).forEach((sp, i) => {
    const [sx, sy, rot] = spots[i];
    const img = stickerCanvas(sp, 192);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.shadowColor = "rgba(43,35,32,0.25)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(img, -85, -85, 170, 170);
    ctx.restore();
  });

  // Thin cut line around the card.
  ctx.strokeStyle = "rgba(43,35,32,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  return c;
}
