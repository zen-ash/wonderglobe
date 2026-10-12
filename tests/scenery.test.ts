// Paper-world dressing: decorative carpets are deterministic, dense, walk-through
// and never disturb the main layout (items + ambient) other systems rely on.

import { describe, expect, it } from "vitest";
import { Terrain } from "@/world/planet";
import { generateScenery, generateDecor, ART_SPECS } from "@/world/scenery";
import { angleBetween, PLANET_RADIUS, toVec3 } from "@/world/sphere";

const key = (list: { art: string; n: { x: number; y: number; z: number } }[]) => list.map((i) => `${i.art}:${toVec3(i.n as never).join()}`);

describe("paper scenery dressing", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = generateScenery(new Terrain(77), 77);
    const b = generateScenery(new Terrain(77), 77);
    const c = generateScenery(new Terrain(78), 78);
    expect(key(a.decor)).toEqual(key(b.decor));
    expect(key(a.decor)).not.toEqual(key(c.decor));
  });

  it("lands in the ~1100–1450 piece range for the paper world", () => {
    for (const seed of [1, 77, 4242]) {
      const l = generateScenery(new Terrain(seed), seed);
      const total = l.items.filter((i) => !i.flat).length + l.decor.length;
      expect(total).toBeGreaterThanOrEqual(1100);
      expect(total).toBeLessThanOrEqual(1450);
    }
  });

  it("keeps the main layout identical to a decor-free generation", () => {
    const t = new Terrain(9);
    const l = generateScenery(t, 9);
    // Decor uses its own random stream: regenerating it from the same items gives the same result.
    expect(key(generateDecor(t, 9, l.items))).toEqual(key(l.decor));
  });

  it("is walk-through, on dry land and clear of solid pieces", () => {
    const t = new Terrain(5);
    const l = generateScenery(t, 5);
    const solid = l.items.filter((i) => i.radius > 0);
    for (const d of l.decor) {
      expect(d.radius).toBe(0);
      expect(d.decor).toBe(true);
      expect(ART_SPECS[d.art]).toBeDefined();
      expect(t.sample(d.n).water).toBeLessThan(0);
      for (const s of solid) expect(angleBetween(s.n, d.n) * PLANET_RADIUS).toBeGreaterThan(s.radius);
    }
  });

  it("includes the new carpet arts", () => {
    const l = generateScenery(new Terrain(3), 3);
    const arts = new Set(l.decor.map((d) => d.art));
    for (const a of ["flower_orange", "flower_purple", "wildflowers", "fern", "grass_tall", "pebbles"]) expect(arts.has(a as never)).toBe(true);
  });

  it("faces houses toward their plaza and lines fences along their ring", () => {
    const l = generateScenery(new Terrain(11), 11);
    const houses = l.items.filter((i) => i.art.startsWith("house_") || i.art === "cottage");
    expect(houses.length).toBeGreaterThan(0);
    for (const h of houses) {
      expect(h.facing).toBeDefined();
      expect(Math.abs(h.facing!.dot(h.n))).toBeLessThan(1e-6);
    }
    expect(l.items.filter((i) => i.art === "fence").every((f) => !!f.facing)).toBe(true);
  });
});
