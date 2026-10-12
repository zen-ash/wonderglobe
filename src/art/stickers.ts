// Round die-cut crayon stickers (white paper border, thin cut line) for the
// sticker book, plus soft grey silhouettes for stickers not earned yet.
// Everything is drawn procedurally and cached as data URLs.

import { ctx2d, makeCanvas, INK } from "./crayon";
import { renderKitArt, type Kit } from "./kit";
import { hashString } from "./rng";
import { ICONS } from "./stickerIcons";

export interface StickerArtSpec {
  id: string;
  icon: string;
  bg: string;
  badge?: string;
}

const cache = new Map<string, string>();
const canvasCache = new Map<string, HTMLCanvasElement>();

function drawIcon(k: Kit, icon: string, scale: number) {
  const draw = ICONS[icon];
  if (!draw) return;
  const ctx = k.ctx;
  ctx.save();
  ctx.translate(50, 50);
  ctx.scale(scale, scale);
  ctx.translate(-50, -50);
  draw(k);
  ctx.restore();
}

function drawBadge(k: Kit, text: string) {
  k.shape(k.blob(76, 76, 13, 13, 0.03, 16), "#fffaf0", { w: 2 });
  const ctx = k.ctx;
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `800 ${text.length > 1 ? 13 : 16}px "Nunito", "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 76, 77);
  ctx.restore();
}

/** A finished sticker as a canvas (cached). */
export function stickerCanvas(spec: StickerArtSpec, size = 192): HTMLCanvasElement {
  const key = `${spec.id}:${size}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const c = renderKitArt(
    size,
    size,
    hashString(spec.id),
    (k) => {
      k.shape(k.blob(50, 50, 41, 41, 0.025, 30), spec.bg, { w: 2.2 });
      // A soft inner ring like a printed sticker.
      k.outline(k.ell(50, 50, 36, 36), 0.9, "rgba(43,35,32,0.25)");
      drawIcon(k, spec.icon, 0.78);
      if (spec.badge) drawBadge(k, spec.badge);
    },
    { border: size * 0.045, outline: size * 0.012, grain: 0.35 },
  );
  canvasCache.set(key, c);
  return c;
}

/** Data URL of a finished, colourful sticker. */
export function stickerUrl(spec: StickerArtSpec, size = 192): string {
  const key = `on:${spec.id}:${size}`;
  let url = cache.get(key);
  if (!url) {
    url = stickerCanvas(spec, size).toDataURL("image/png");
    cache.set(key, url);
  }
  return url;
}

/** Data URL of a soft grey silhouette (the sticker's picture, no colours) in a dashed circle. */
export function stickerSilhouetteUrl(spec: StickerArtSpec, size = 192): string {
  const key = `off:${spec.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const icon = renderKitArt(size, size, hashString(spec.id) ^ 0x55, (k) => drawIcon(k, spec.icon, 0.74), { border: 0, outline: 0.01, grain: 0 });
  const ictx = ctx2d(icon);
  ictx.globalCompositeOperation = "source-in";
  ictx.fillStyle = "#d6cdbf";
  ictx.fillRect(0, 0, size, size);
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.fillStyle = "rgba(255, 252, 243, 0.65)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.43, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([size * 0.04, size * 0.03]);
  ctx.lineWidth = Math.max(2, size * 0.018);
  ctx.strokeStyle = "rgba(91, 74, 66, 0.4)";
  ctx.stroke();
  ctx.drawImage(icon, 0, 0);
  if (spec.badge) {
    ctx.fillStyle = "rgba(91, 74, 66, 0.45)";
    ctx.font = `800 ${size * 0.13}px "Nunito", "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.badge, size * 0.76, size * 0.77);
  }
  const url = c.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

/** A small paper cut-out of an icon (treasures, doodles on postcards). */
export function iconCutoutCanvas(icon: string, size = 160, seed = 1): HTMLCanvasElement {
  const key = `cut:${icon}:${size}:${seed}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const c = renderKitArt(size, size, hashString(icon) ^ seed, (k) => drawIcon(k, icon, 1.12), { border: size * 0.04, outline: size * 0.013 });
  canvasCache.set(key, c);
  return c;
}
