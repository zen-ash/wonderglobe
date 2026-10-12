import { describe, expect, it } from "vitest";
import { DrawingError, processBoardDrawing, type CutoutResult, type RGBAImage } from "@/drawing/process";
import { hashPixels, sha256 } from "@/drawing/hash";
import { polygonArea } from "@/drawing/trace";
import type { Polygon } from "@/core/types";
import {
  blank,
  disc,
  ellipseStroke,
  fillRect,
  fillTriangle,
  getPixel,
  line,
  type RGBA,
} from "@/drawing/synthetic";

const BLUE: RGBA = [30, 90, 200, 255];
const ORANGE: RGBA = [240, 120, 30, 255];
const RED: RGBA = [220, 30, 40, 255];

/** Fish outline: ellipse stroke with a ~3 px gap at the top, triangle tail, eye. */
function fish(gapHalfWidth = 4): RGBAImage {
  const img = blank(400, 300);
  ellipseStroke(img, 180, 150, 110, 70, 3, BLUE, (x, y) => y < 150 && x > 180 - gapHalfWidth && x < 180 + gapHalfWidth);
  line(img, 290, 150, 360, 100, 3, ORANGE);
  line(img, 360, 100, 360, 200, 3, ORANGE);
  line(img, 360, 200, 290, 150, 3, ORANGE);
  disc(img, 130, 130, 6, RED);
  return img;
}

/** True if any two non-adjacent edges of the closed polygon properly cross. */
function selfIntersects(poly: Polygon): boolean {
  const n = poly.length;
  const orient = (a: number[], b: number[], c: number[]) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Maps a source (board) pixel to the matching cut-out pixel. */
function toCutout(r: CutoutResult, x: number, y: number): [number, number] {
  return [
    Math.round((x - r.inkBounds.x) * r.scale + r.offset[0]),
    Math.round((y - r.inkBounds.y) * r.scale + r.offset[1]),
  ];
}

function cutoutPixel(r: CutoutResult, x: number, y: number): RGBA {
  const [cx, cy] = toCutout(r, x, y);
  return getPixel(r.cutout, cx, cy);
}

describe("processBoardDrawing", () => {
  it("closes a small gap, fills the body with white paper and keeps the child's colours", () => {
    const img = fish();
    // The gap really is there in the drawing.
    expect(getPixel(img, 180, 80)[3]).toBe(0);
    expect(getPixel(img, 180, 78)[3]).toBe(0);

    const r = processBoardDrawing(img);
    expect(r.scale).toBe(1);

    // Interior (no ink) becomes opaque white paper.
    expect(cutoutPixel(r, 200, 150)).toEqual([255, 255, 255, 255]);
    // The gap itself is part of the silhouette now.
    expect(cutoutPixel(r, 180, 80)[3]).toBe(255);
    // Stroke colours preserved exactly.
    expect(cutoutPixel(r, 71, 150)).toEqual(BLUE);
    expect(cutoutPixel(r, 360, 150)).toEqual(ORANGE);
    expect(cutoutPixel(r, 130, 130)).toEqual(RED);
  });

  it("adds a white paper border and a dark cut line, transparent beyond", () => {
    const r = processBoardDrawing(fish());
    const border = Math.max(6, Math.round(Math.max(r.inkBounds.w, r.inkBounds.h) * 0.035));
    // The left-most ink is the ellipse stroke around y = 150.
    const left = r.inkBounds.x;
    expect(cutoutPixel(r, left - Math.floor(border / 2), 150)).toEqual([255, 255, 255, 255]);
    const cut = cutoutPixel(r, left - border - 2, 150);
    expect(cut[0]).toBeLessThan(90);
    expect(cut[3]).toBe(255);
    expect(cutoutPixel(r, left - border - 6, 150)[3]).toBe(0);
    // Nothing touches the bitmap edge.
    const { width: w, height: h, data } = r.cutout;
    for (let x = 0; x < w; x++) {
      expect(data[x * 4 + 3]).toBe(0);
      expect(data[((h - 1) * w + x) * 4 + 3]).toBe(0);
    }
    for (let y = 0; y < h; y++) {
      expect(data[y * w * 4 + 3]).toBe(0);
      expect(data[(y * w + w - 1) * 4 + 3]).toBe(0);
    }
  });

  it("produces sane polygons, anchor, aspect, coverage and palette", () => {
    const r = processBoardDrawing(fish());
    const m = r.meta;
    expect(m.width).toBe(r.cutout.width);
    expect(m.height).toBe(r.cutout.height);
    expect(m.polygons.length).toBe(1);
    const poly = m.polygons[0];
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of poly) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(m.width);
      expect(y).toBeLessThanOrEqual(m.height);
    }
    // Consistent winding (positive shoelace area) and area matches coverage.
    expect(selfIntersects(poly)).toBe(false);
    const area = polygonArea(poly);
    expect(area).toBeGreaterThan(0);
    expect(Math.abs(area - m.coverage * m.width * m.height) / area).toBeLessThan(0.03);

    expect(m.aspect).toBeCloseTo(m.width / m.height, 10);
    expect(m.aspect).toBeGreaterThan(1.4);
    expect(m.aspect).toBeLessThan(2.4);
    expect(m.coverage).toBeGreaterThan(0.4);
    expect(m.coverage).toBeLessThan(0.95);

    // Bottom-centre of the fish body (ellipse bottom is at x = 180).
    const [ax] = toCutout(r, 180, 0);
    expect(Math.abs(m.anchor[0] - (ax + 0.5) / m.width)).toBeLessThan(0.03);
    expect(m.anchor[1]).toBeGreaterThan(0.95);
    expect(m.anchor[1]).toBeLessThanOrEqual(1);

    expect(m.palette[0]).toBe("#1e5ac8");
    expect(m.palette).toContain("#f0781e");
    expect(m.palette).toContain("#dc1e28");
    expect(m.palette.length).toBeLessThanOrEqual(5);
    expect(m.roofLine).toBeGreaterThanOrEqual(0.15);
    expect(m.roofLine).toBeLessThanOrEqual(0.7);
  });

  it("does not bridge a large gap", () => {
    const r = processBoardDrawing(fish(25));
    // Body interior is not enclosed, so it's cut away (far from any ink).
    expect(cutoutPixel(r, 200, 150)[3]).toBe(0);
  });

  it("removes an isolated speck but keeps a deliberate small piece", () => {
    const clean = processBoardDrawing(fish());

    const speckled = fish();
    fillRect(speckled, 10, 290, 2, 2, BLUE);
    const r = processBoardDrawing(speckled);
    expect(r.inkBounds).toEqual(clean.inkBounds); // the speck is ignored…
    expect(r.meta.polygons.length).toBe(1); // …and not in the cut-out
    const [sx, sy] = toCutout(r, 10, 290);
    if (sx >= 0 && sy >= 0 && sx < r.cutout.width && sy < r.cutout.height) {
      expect(getPixel(r.cutout, sx, sy)[3]).toBe(0);
    }
    // Same picture as without the speck (scale is 1 in both cases).
    expect(r.cutout.width).toBe(clean.cutout.width);
    expect(Buffer.from(r.cutout.data).equals(Buffer.from(clean.cutout.data))).toBe(true);

    const withBubble = fish();
    disc(withBubble, 30, 40, 6, BLUE); // a little bubble, drawn on purpose
    const b = processBoardDrawing(withBubble);
    expect(b.meta.polygons.length).toBe(2);
    expect(cutoutPixel(b, 30, 40)).toEqual(BLUE);
  });

  it("finds the roof line of a house", () => {
    const img = blank(400, 450);
    const WALL: RGBA = [200, 60, 50, 255];
    const ROOF: RGBA = [90, 50, 30, 255];
    fillRect(img, 100, 200, 200, 200, WALL);
    fillTriangle(img, [100, 200], [300, 200], [200, 90], ROOF);
    const r = processBoardDrawing(img);
    const [, wallTop] = toCutout(r, 0, 200);
    expect(Math.abs(r.meta.roofLine - wallTop / r.meta.height)).toBeLessThan(0.06);
    expect(r.meta.palette.slice(0, 2).sort()).toEqual(["#5a321e", "#c83c32"]);
  });

  it("works at a bounded resolution for big drawings", () => {
    const img = blank(1400, 1000);
    ellipseStroke(img, 700, 500, 600, 400, 12, BLUE);
    const r = processBoardDrawing(img);
    expect(r.scale).toBeLessThan(1);
    expect(Math.max(r.cutout.width, r.cutout.height)).toBeLessThanOrEqual(480 + 60);
    expect(cutoutPixel(r, 700, 500)).toEqual([255, 255, 255, 255]);
    // Middle of the thick stroke keeps its exact colour after area averaging.
    expect(cutoutPixel(r, 100, 500)).toEqual(BLUE);
  });

  it("asks for a drawing when the board is empty", () => {
    expect(() => processBoardDrawing(blank(200, 200))).toThrow("Draw something first!");
    // Nearly invisible marks don't count as ink either.
    const faint = blank(200, 200);
    disc(faint, 100, 100, 10, [0, 0, 0, 10]);
    expect(() => processBoardDrawing(faint)).toThrow(DrawingError);
  });

  it("is deterministic", () => {
    const a = processBoardDrawing(fish());
    const b = processBoardDrawing(fish());
    expect(Buffer.from(a.cutout.data).equals(Buffer.from(b.cutout.data))).toBe(true);
    expect(a.meta).toEqual(b.meta);
    expect(a.inkBounds).toEqual(b.inkBounds);
  });
});

describe("content hash", () => {
  it("is a plain SHA-256 of width, height and pixels", async () => {
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const long = new Uint8Array(1000).map((_, i) => i * 7);
    const { createHash } = await import("node:crypto");
    expect(hex(sha256(long))).toBe(createHash("sha256").update(long).digest("hex"));

    const img = fish();
    const copy = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
    expect(await hashPixels(img)).toBe(await hashPixels(copy));
    expect(await hashPixels(img)).toMatch(/^[0-9a-f]{64}$/);
    copy.data[1000] ^= 1;
    expect(await hashPixels(img)).not.toBe(await hashPixels(copy));
  });
});
