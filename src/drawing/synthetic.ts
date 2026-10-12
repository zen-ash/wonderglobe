// Tiny raster "pen" used to synthesise drawings in tests (and handy for dev
// tooling). Pure and deterministic; no DOM.

import { createImage, type RGBAImage } from "./raster";

export type RGBA = [number, number, number, number];

export function blank(width: number, height: number, fill: RGBA = [0, 0, 0, 0]): RGBAImage {
  const img = createImage(width, height);
  for (let i = 0; i < width * height; i++) img.data.set(fill, i * 4);
  return img;
}

export function setPixel(img: RGBAImage, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(c, (y * img.width + x) * 4);
}

export function getPixel(img: RGBAImage, x: number, y: number): RGBA {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** Hard-edged filled disc. */
export function disc(img: RGBAImage, cx: number, cy: number, r: number, c: RGBA): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPixel(img, x, y, c);
    }
  }
}

/** Thick line made of stamped discs; `skip` can veto individual stamps. */
export function line(
  img: RGBAImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  c: RGBA,
  skip?: (x: number, y: number) => boolean,
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    if (!skip || !skip(x, y)) disc(img, x, y, r, c);
  }
}

/** Ellipse outline made of stamped discs; `skip` can veto stamps (to leave gaps). */
export function ellipseStroke(
  img: RGBAImage,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  c: RGBA,
  skip?: (x: number, y: number) => boolean,
): void {
  const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry) * 2);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    if (!skip || !skip(x, y)) disc(img, x, y, r, c);
  }
}

/** Filled axis-aligned rectangle. */
export function fillRect(img: RGBAImage, x: number, y: number, w: number, h: number, c: RGBA): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(img, xx, yy, c);
}

/** Filled triangle (pixel centres inside the triangle). */
export function fillTriangle(
  img: RGBAImage,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  col: RGBA,
): void {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const edge = (p: [number, number], q: [number, number], x: number, y: number) =>
    (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const e0 = edge(a, b, px, py), e1 = edge(b, c, px, py), e2 = edge(c, a, px, py);
      if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) setPixel(img, x, y, col);
    }
  }
}

/** Composites a straight-alpha drawing over an opaque background colour. */
export function flatten(img: RGBAImage, bg: [number, number, number]): RGBAImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = img.data[i * 4 + c] * a + bg[c] * (1 - a);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
