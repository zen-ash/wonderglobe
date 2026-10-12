// Paper cut-out cards and hand-cut gallery shapes: closed, crack-free meshes.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CutoutMeta } from "@/core/types";
import { buildCutoutGeometry, CARD_GROUP } from "@/render/cutoutGeometry";
import { handCut, primGeometry, primHullGeometry, type Prim } from "@/render/shapes";

/** Each undirected edge (by rounded position) must be shared by exactly two triangles. */
function openEdges(g: THREE.BufferGeometry, decimals = 4): number {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const key = (i: number) => `${pos.getX(i).toFixed(decimals)},${pos.getY(i).toFixed(decimals)},${pos.getZ(i).toFixed(decimals)}`;
  const uses = new Map<string, number>();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const k = [key(i), key(i + 1), key(i + 2)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; // degenerate sliver
    for (let e = 0; e < 3; e++) {
      const a = k[e], b = k[(e + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open++;
  return open;
}

const meta = (polygons: CutoutMeta["polygons"]): CutoutMeta => ({
  width: 200,
  height: 200,
  polygons,
  anchor: [0.5, 0.95],
  aspect: 1,
  coverage: 0.5,
  palette: ["#ff0000"],
  roofLine: 0.4,
});

describe("paper cut-out card", () => {
  const blob = meta([
    [
      [40, 190],
      [30, 120],
      [60, 40],
      [100, 20],
      [150, 50],
      [170, 120],
      [120, 130],
      [110, 190],
    ],
  ]);

  it("has front, edge and back groups and no cracks", () => {
    const cut = buildCutoutGeometry(blob, 1.5);
    const g = cut.geometry;
    const groups = new Map(g.groups.map((gr) => [gr.materialIndex, gr]));
    expect(groups.get(CARD_GROUP.front)!.count).toBe(groups.get(CARD_GROUP.back)!.count);
    expect(groups.get(CARD_GROUP.edge)!.count).toBeGreaterThan(0);
    expect(openEdges(g)).toBe(0);
    expect(cut.height).toBeCloseTo(1.5, 5);
  });

  it("is sliced so the paper can bend smoothly", () => {
    const g = buildCutoutGeometry(blob, 1.5).geometry;
    const front = g.groups.find((gr) => gr.materialIndex === CARD_GROUP.front)!;
    // The outline alone has 8 points (6 triangles); slicing adds many more.
    expect(front.count / 3).toBeGreaterThan(40);
  });

  it("bows the middle toward the viewer with shading that follows the curve", () => {
    const g = buildCutoutGeometry(blob, 1.5, 0.05, { bow: 0.08 }).geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const col = g.getAttribute("color") as THREE.BufferAttribute;
    const front = g.groups.find((gr) => gr.materialIndex === CARD_GROUP.front)!;
    let mid = -Infinity, side = Infinity, shadeL = 0, shadeR = 0;
    for (let i = front.start; i < front.start + front.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x) < 0.05) mid = Math.max(mid, z);
      if (Math.abs(x) > 0.5) side = Math.min(side, z);
      if (x < -0.4) shadeL = Math.max(shadeL, col.getX(i));
      if (x > 0.4) shadeR = Math.max(shadeR, col.getX(i));
    }
    expect(mid - side).toBeGreaterThan(0.03);
    expect(shadeL).not.toBeCloseTo(shadeR, 2);
  });

  it("handles several pieces and flat cards", () => {
    const two = meta([
      [
        [10, 190],
        [10, 100],
        [80, 100],
        [80, 190],
      ],
      [
        [120, 190],
        [120, 60],
        [190, 60],
        [190, 190],
      ],
    ]);
    const cut = buildCutoutGeometry(two, 1, 0.05, { bow: 0 });
    expect(openEdges(cut.geometry)).toBe(0);
    const pos = cut.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(0.0251);
  });
});

describe("hand-cut gallery shapes", () => {
  it("stay closed after the corner jitter", () => {
    const { fill, hull } = handCut(new THREE.IcosahedronGeometry(1, 1), 0.08, 3);
    expect(openEdges(fill)).toBe(0);
    expect(hull.getAttribute("position").count).toBe(fill.getAttribute("position").count);
  });

  it("has per-facet brightness and flat facets; outline twin has smooth unit normals", () => {
    for (const prim of ["sphere", "cyl", "cone", "box", "roof", "rock"] as Prim[]) {
      const fill = primGeometry(prim);
      const facet = fill.getAttribute("aFacet") as THREE.BufferAttribute;
      const nrm = fill.getAttribute("normal") as THREE.BufferAttribute;
      expect(facet.count).toBe(fill.getAttribute("position").count);
      const values = new Set<number>();
      for (let i = 0; i < facet.count; i += 3) {
        values.add(Math.round(facet.getX(i) * 1000));
        expect(facet.getX(i)).toBe(facet.getX(i + 2));
        // Flat: the three corners of a facet share one normal.
        expect(nrm.getX(i)).toBeCloseTo(nrm.getX(i + 1), 5);
      }
      expect(values.size).toBeGreaterThan(2);
      const hn = primHullGeometry(prim).getAttribute("normal") as THREE.BufferAttribute;
      for (let i = 0; i < hn.count; i++) expect(Math.hypot(hn.getX(i), hn.getY(i), hn.getZ(i))).toBeCloseTo(1, 4);
    }
  });

  it("is deterministic", () => {
    const a = handCut(new THREE.DodecahedronGeometry(1, 0), 0.1, 9).fill.getAttribute("position").array;
    const b = handCut(new THREE.DodecahedronGeometry(1, 0), 0.1, 9).fill.getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
