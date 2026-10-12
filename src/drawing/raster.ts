// Small, dependency-free raster helpers shared by the drawing pipeline.
//
// Everything here is pure (no DOM) so it runs in Node (vitest), in a Web
// Worker and on the main thread alike. All operations are deterministic:
// the same input pixels always produce byte-identical output.

/** A straight (non-premultiplied) RGBA bitmap, row-major, 4 bytes per pixel. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Integer pixel rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A friendly, child-facing error raised by the drawing pipeline. */
export class DrawingError extends Error {
  readonly code: "empty-drawing" | "bad-image" | "empty-crop";

  constructor(code: DrawingError["code"], message: string) {
    super(message);
    this.name = "DrawingError";
    this.code = code;
  }
}

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Throws a friendly error unless `img` is a well-formed RGBA bitmap. */
export function assertImage(img: RGBAImage): void {
  const ok =
    img != null &&
    Number.isInteger(img.width) &&
    Number.isInteger(img.height) &&
    img.width > 0 &&
    img.height > 0 &&
    img.data != null &&
    img.data.length === img.width * img.height * 4;
  if (!ok) throw new DrawingError("bad-image", "That picture couldn't be read.");
}

/**
 * Clamps a (possibly fractional / out-of-range) rectangle to the image and
 * snaps it to whole pixels. Returns null when nothing of it is left.
 */
export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Resolves an upload crop: `null` means the whole image. A crop that misses
 * the image entirely is an error (the UI should never produce one).
 */
export function resolveCrop(crop: Rect | null, img: { width: number; height: number }): Rect {
  if (!crop) return { x: 0, y: 0, w: img.width, h: img.height };
  const r = clampRect(crop, img.width, img.height);
  if (!r) throw new DrawingError("empty-crop", "That crop is empty – try a bigger box.");
  return r;
}

/** Grows a rectangle by `margin` on every side, clamped to the image. */
export function expandRect(rect: Rect, margin: number, width: number, height: number): Rect {
  return clampRect(
    { x: rect.x - margin, y: rect.y - margin, w: rect.w + 2 * margin, h: rect.h + 2 * margin },
    width,
    height,
  ) as Rect;
}

/** Copies a rectangle out of an image (rect must be inside the image). */
export function cropImage(img: RGBAImage, rect: Rect): RGBAImage {
  const out = createImage(rect.w, rect.h);
  const rowBytes = rect.w * 4;
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * img.width + rect.x) * 4;
    out.data.set(img.data.subarray(from, from + rowBytes), y * rowBytes);
  }
  return out;
}

/** Copies a rectangle out of a 1-byte-per-pixel mask. */
export function cropMask(mask: Uint8Array, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const from = (rect.y + y) * width + rect.x;
    out.set(mask.subarray(from, from + rect.w), y * rect.w);
  }
  return out;
}

/** Surrounds an image with `pad` fully transparent pixels on every side. */
export function padImage(img: RGBAImage, pad: number): RGBAImage {
  const out = createImage(img.width + 2 * pad, img.height + 2 * pad);
  const rowBytes = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    out.data.set(
      img.data.subarray(y * rowBytes, (y + 1) * rowBytes),
      ((y + pad) * out.width + pad) * 4,
    );
  }
  return out;
}

/** Surrounds a mask with `pad` zero pixels on every side. */
export function padMask(mask: Uint8Array, width: number, height: number, pad: number): Uint8Array {
  const ow = width + 2 * pad;
  const out = new Uint8Array(ow * (height + 2 * pad));
  for (let y = 0; y < height; y++) {
    out.set(mask.subarray(y * width, (y + 1) * width), (y + pad) * ow + pad);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Area-averaging resampler (box filter). Exact for integer ratios, correct
// coverage weights for fractional ones, separable and O(pixels).
// ---------------------------------------------------------------------------

interface AreaTable {
  start: Int32Array; // first source index per output index
  count: Int32Array; // number of contributing source samples
  offset: Int32Array; // offset into `weight`
  weight: Float32Array; // normalised weights
}

function areaTable(srcLen: number, outLen: number): AreaTable {
  const ratio = srcLen / outLen;
  const start = new Int32Array(outLen);
  const count = new Int32Array(outLen);
  const offset = new Int32Array(outLen);
  const weights: number[] = [];
  for (let o = 0; o < outLen; o++) {
    const a = o * ratio;
    const b = Math.min(srcLen, (o + 1) * ratio);
    const s0 = Math.floor(a);
    const s1 = Math.min(srcLen, Math.ceil(b));
    start[o] = s0;
    offset[o] = weights.length;
    let n = 0;
    for (let s = s0; s < s1; s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 0) {
        weights.push(w / (b - a));
        n++;
      } else if (n === 0) {
        start[o] = s + 1;
      }
    }
    count[o] = n;
  }
  return { start, count, offset, weight: Float32Array.from(weights) };
}

/**
 * Resamples `channels`-interleaved float data from a `rect` of a `srcW`-wide
 * buffer to `outW × outH` by area averaging.
 */
function resampleFloat(
  src: Float32Array,
  srcW: number,
  channels: number,
  rect: Rect,
  outW: number,
  outH: number,
): Float32Array {
  const tx = areaTable(rect.w, outW);
  const ty = areaTable(rect.h, outH);
  // Horizontal pass: rect.h rows × outW columns.
  const mid = new Float32Array(rect.h * outW * channels);
  for (let y = 0; y < rect.h; y++) {
    const rowBase = ((rect.y + y) * srcW + rect.x) * channels;
    for (let ox = 0; ox < outW; ox++) {
      const o = (y * outW + ox) * channels;
      const n = tx.count[ox];
      const wo = tx.offset[ox];
      const s0 = tx.start[ox];
      for (let k = 0; k < n; k++) {
        const w = tx.weight[wo + k];
        const si = rowBase + (s0 + k) * channels;
        for (let c = 0; c < channels; c++) mid[o + c] += src[si + c] * w;
      }
    }
  }
  // Vertical pass.
  const out = new Float32Array(outW * outH * channels);
  for (let oy = 0; oy < outH; oy++) {
    const n = ty.count[oy];
    const wo = ty.offset[oy];
    const s0 = ty.start[oy];
    for (let k = 0; k < n; k++) {
      const w = ty.weight[wo + k];
      const srcRow = (s0 + k) * outW * channels;
      const dstRow = oy * outW * channels;
      for (let i = 0; i < outW * channels; i++) out[dstRow + i] += mid[srcRow + i] * w;
    }
  }
  return out;
}

/**
 * Downscales `rect` of `img` to `outW × outH` using premultiplied-alpha area
 * averaging (no dark fringes around transparent edges).
 */
export function resampleArea(img: RGBAImage, rect: Rect, outW: number, outH: number): RGBAImage {
  // Premultiply only the region we need.
  const region = new Float32Array(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    let si = ((rect.y + y) * img.width + rect.x) * 4;
    let di = y * rect.w * 4;
    for (let x = 0; x < rect.w; x++, si += 4, di += 4) {
      const a = img.data[si + 3];
      const f = a / 255;
      region[di] = img.data[si] * f;
      region[di + 1] = img.data[si + 1] * f;
      region[di + 2] = img.data[si + 2] * f;
      region[di + 3] = a;
    }
  }
  const avg = resampleFloat(region, rect.w, 4, { x: 0, y: 0, w: rect.w, h: rect.h }, outW, outH);
  const out = createImage(outW, outH);
  for (let i = 0; i < avg.length; i += 4) {
    const a = avg[i + 3];
    if (a <= 0) continue;
    const k = 255 / a;
    out.data[i] = avg[i] * k;
    out.data[i + 1] = avg[i + 1] * k;
    out.data[i + 2] = avg[i + 2] * k;
    out.data[i + 3] = a;
  }
  return out;
}

/** Downscales a 0/1 mask by area averaging; a pixel is set if ≥ half covered. */
export function resampleMaskArea(
  mask: Uint8Array,
  width: number,
  rect: Rect,
  outW: number,
  outH: number,
): Uint8Array {
  const src = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) src[i] = mask[i];
  const avg = resampleFloat(src, width, 1, rect, outW, outH);
  const out = new Uint8Array(outW * outH);
  for (let i = 0; i < out.length; i++) out[i] = avg[i] >= 0.5 ? 1 : 0;
  return out;
}

/**
 * Scales an image (deterministically) so its longest side is at most
 * `maxSide`. Returns the input unchanged when it already fits.
 */
export function downscaleToFit(img: RGBAImage, maxSide: number): RGBAImage {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxSide) return img;
  const s = maxSide / longest;
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  return resampleArea(img, { x: 0, y: 0, w: img.width, h: img.height }, w, h);
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** Composites one straight-alpha channel value over white paper. */
export function overWhite(value: number, alpha: number): number {
  return alpha === 255 ? value : Math.round(255 + ((value - 255) * alpha) / 255);
}

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
