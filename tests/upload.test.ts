import { describe, expect, it } from "vitest";
import {
  analyzeUpload,
  processBoardDrawing,
  processUpload,
  type RGBAImage,
  type UploadSettings,
} from "@/drawing/process";
import { close, fillHoles } from "@/drawing/morphology";
import {
  blank,
  disc,
  ellipseStroke,
  flatten,
  getPixel,
  line,
  rng,
  setPixel,
  type RGBA,
} from "@/drawing/synthetic";

const BLUE: RGBA = [30, 90, 200, 255];
const ORANGE: RGBA = [240, 120, 30, 255];
const RED: RGBA = [220, 30, 40, 255];
const DEFAULTS: UploadSettings = { crop: null, tolerance: 35, mode: "auto" };

function fish(): RGBAImage {
  const img = blank(400, 300);
  ellipseStroke(img, 180, 150, 110, 70, 3, BLUE, (x, y) => y < 150 && x > 176 && x < 184);
  line(img, 290, 150, 360, 100, 3, ORANGE);
  line(img, 360, 100, 360, 200, 3, ORANGE);
  line(img, 360, 200, 290, 150, 3, ORANGE);
  disc(img, 130, 130, 6, RED);
  return img;
}

/** Reference silhouette: ink, gap-closed and hole-filled. */
function referenceMask(img: RGBAImage): Uint8Array {
  const n = img.width * img.height;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = img.data[i * 4 + 3] > 20 ? 1 : 0;
  return fillHoles(close(ink, img.width, img.height, 2.5), img.width, img.height);
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

const at = (mask: Uint8Array, w: number, x: number, y: number) => mask[y * w + x];

describe("analyzeUpload / processUpload", () => {
  it("cuts a drawing out of a plain white photo like the board does", () => {
    const drawing = fish();
    const photo = flatten(drawing, [255, 255, 255]);
    const { analysis, result } = processUpload(photo, DEFAULTS);
    expect(analysis.usedTransparency).toBe(false);
    expect(analysis.background).toBe("#ffffff");
    expect(analysis.width).toBe(400);
    expect(analysis.height).toBe(300);
    expect(analysis.issues).toEqual([]);
    expect(analysis.confidence).toBeGreaterThan(0.9);
    expect(iou(analysis.mask, referenceMask(drawing))).toBeGreaterThan(0.95);
    expect(at(analysis.mask, 400, 200, 150)).toBe(1); // inside the body
    expect(at(analysis.mask, 400, 5, 5)).toBe(0);

    expect(result).not.toBeNull();
    const r = result!;
    const px = (x: number, y: number) =>
      getPixel(r.cutout, (x - r.inkBounds.x) * r.scale + r.offset[0], (y - r.inkBounds.y) * r.scale + r.offset[1]);
    expect(px(130, 130)).toEqual(RED); // its own pixels
    expect(px(200, 150)).toEqual([255, 255, 255, 255]); // its own paper
    const board = processBoardDrawing(drawing);
    expect(r.meta.polygons.length).toBe(1);
    expect(Math.abs(r.meta.aspect - board.meta.aspect)).toBeLessThan(0.03);
    expect(Math.abs(r.meta.coverage - board.meta.coverage)).toBeLessThan(0.03);
    expect(r.meta.palette[0]).toBe("#1e5ac8");
  });

  it("keeps light pencil on unevenly lit paper", () => {
    const w = 320;
    const h = 240;
    const paper = (x: number): [number, number, number] => {
      const t = x / (w - 1); // bright on the left, shadowed on the right
      return [242 - 70 * t, 238 - 70 * t, 228 - 70 * t];
    };
    const img = blank(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(img, x, y, [...paper(x), 255] as RGBA);
    const pencil = (x: number, y: number) => {
      const p = paper(Math.round(x));
      disc(img, x, y, 1, [p[0] - 45, p[1] - 45, p[2] - 45, 255]);
    };
    for (let i = 0; i < 600; i++) {
      const t = (i / 600) * 2 * Math.PI;
      pencil(160 + 70 * Math.cos(t), 120 + 70 * Math.sin(t));
    }
    const a = analyzeUpload(img, DEFAULTS);
    expect(at(a.mask, w, 90, 120)).toBe(1); // the stroke
    expect(at(a.mask, w, 160, 120)).toBe(1); // filled inside
    expect(at(a.mask, w, 300, 120)).toBe(0); // shadowed paper is not kept
    expect(at(a.mask, w, 10, 10)).toBe(0);
    const fg = a.mask.reduce((s, v) => s + v, 0) / (w * h);
    expect(fg).toBeGreaterThan(0.15);
    expect(fg).toBeLessThan(0.25);
    expect(a.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("uses transparency when the picture has it", () => {
    const { analysis, result } = processUpload(fish(), DEFAULTS);
    expect(analysis.usedTransparency).toBe(true);
    expect(analysis.background).toBeNull();
    expect(iou(analysis.mask, referenceMask(fish()))).toBeGreaterThan(0.95);
    expect(result!.meta.polygons.length).toBe(1);
    expect(analysis.confidence).toBeGreaterThan(0.9);
  });

  it("reports low confidence on a busy background", () => {
    const rand = rng(42);
    const img = blank(240, 200);
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 240; x++) {
        setPixel(img, x, y, [rand() * 255, rand() * 255, rand() * 255, 255].map(Math.floor) as RGBA);
      }
    }
    disc(img, 120, 100, 40, RED);
    const a = analyzeUpload(img, DEFAULTS);
    expect(a.confidence).toBeLessThan(0.55);
    expect(a.issues).toContain("busy-background");
    expect(a.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("flags an empty picture as too little foreground", () => {
    const a = processUpload(blank(100, 80, [250, 250, 250, 255]), DEFAULTS);
    expect(a.analysis.issues).toContain("too-little-foreground");
    expect(a.analysis.confidence).toBeLessThan(0.55);
    expect(a.result).toBeNull();
  });

  it("keeps the whole picture as a card in 'whole' mode", () => {
    const photo = flatten(fish(), [250, 245, 235]);
    const { analysis, result } = processUpload(photo, { ...DEFAULTS, mode: "whole" });
    expect(analysis.mask.every((v) => v === 1)).toBe(true);
    expect(analysis.confidence).toBe(1);
    const m = result!.meta;
    expect(m.polygons.length).toBe(1);
    expect(m.coverage).toBeGreaterThan(0.9);
    expect(Math.abs(m.aspect - 400 / 300)).toBeLessThan(0.08);
    // Original pixels are kept, including the paper colour.
    expect(getPixel(result!.cutout, result!.offset[0] + 2, result!.offset[1] + 2)).toEqual([250, 245, 235, 255]);
  });

  it("respects the crop", () => {
    const photo = flatten(fish(), [255, 255, 255]);
    const crop = { x: 40, y: 50, w: 340, h: 200 };
    const { analysis, result } = processUpload(photo, { ...DEFAULTS, crop });
    expect(analysis.width).toBe(340);
    expect(analysis.height).toBe(200);
    expect(at(analysis.mask, 340, 200 - 40, 150 - 50)).toBe(1);
    const r = result!;
    expect(r.inkBounds.x).toBeGreaterThanOrEqual(40);
    expect(r.inkBounds.y).toBeGreaterThanOrEqual(50);
    expect(r.inkBounds.x + r.inkBounds.w).toBeLessThanOrEqual(380);
    // A crop that misses the picture is a friendly error.
    expect(() => analyzeUpload(photo, { ...DEFAULTS, crop: { x: 500, y: 0, w: 10, h: 10 } })).toThrow();
  });

  it("applies manual keep / remove paint last", () => {
    const photo = flatten(fish(), [255, 255, 255]);
    const w = 400;
    const h = 300;
    const keep = new Uint8Array(w * h);
    const remove = new Uint8Array(w * h);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) keep[y * w + x] = 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < 180; x++) remove[y * w + x] = 1;
    const a = analyzeUpload(photo, { ...DEFAULTS, paint: { keep, remove, width: w, height: h } });
    expect(at(a.mask, w, 5, 5)).toBe(0); // inside both: remove wins
    const b = analyzeUpload(photo, { ...DEFAULTS, paint: { keep, remove: null, width: w, height: h } });
    expect(at(b.mask, w, 5, 5)).toBe(1);
    expect(at(a.mask, w, 130, 130)).toBe(0); // removed half
    expect(at(a.mask, w, 250, 150)).toBe(1); // untouched half
    // Paint at a different resolution is mapped onto the crop.
    const small = new Uint8Array(40 * 30).fill(1);
    const c = analyzeUpload(photo, { ...DEFAULTS, paint: { keep: null, remove: small, width: 40, height: 30 } });
    expect(c.mask.every((v) => v === 0)).toBe(true);
  });

  it("'colour' mode opens enclosed background, 'edges' mode fills it", () => {
    const img = blank(300, 300, [255, 255, 255, 255]);
    ellipseStroke(img, 150, 150, 100, 100, 12, ORANGE); // a thick ring
    const edges = analyzeUpload(img, { ...DEFAULTS, mode: "edges" });
    const colour = analyzeUpload(img, { ...DEFAULTS, mode: "colour" });
    expect(at(edges.mask, 300, 150, 150)).toBe(1);
    expect(at(colour.mask, 300, 150, 150)).toBe(0);
    expect(at(colour.mask, 300, 50, 150)).toBe(1); // the ring itself
  });

  it("depends only on pixels and settings (deterministic)", () => {
    const a = flatten(fish(), [248, 246, 240]);
    const b: RGBAImage = { width: a.width, height: a.height, data: new Uint8ClampedArray(a.data) };
    const ra = processUpload(a, { ...DEFAULTS });
    const rb = processUpload(b, { crop: null, mode: "auto", tolerance: 35 });
    expect(ra.analysis).toEqual(rb.analysis);
    expect(Buffer.from(ra.result!.cutout.data).equals(Buffer.from(rb.result!.cutout.data))).toBe(true);
    expect(ra.result!.meta).toEqual(rb.result!.meta);
  });

  it("processes a 1024×1024 photo quickly", () => {
    const img = blank(1024, 1024, [236, 232, 224, 255]);
    const rand = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = Math.floor((rand() - 0.5) * 8); // sensor noise
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ellipseStroke(img, 512, 512, 350, 250, 6, BLUE);
    disc(img, 400, 450, 30, RED);
    processUpload(img, DEFAULTS); // warm-up (JIT)
    const t0 = performance.now();
    const { analysis, result } = processUpload(img, DEFAULTS);
    const ms = performance.now() - t0;
    expect(analysis.confidence).toBeGreaterThan(0.8);
    expect(result).not.toBeNull();
    expect(ms).toBeLessThan(1500);
  });
});
