// Screen-level polish helpers: vignette tone, planet-view label fading, the
// cut-out show's scissors progress, and region signpost placement.

import { describe, expect, it } from "vitest";
import { Terrain, REGIONS } from "@/world/planet";
import { generateScenery } from "@/world/scenery";
import { PLANET_RADIUS, angleBetween } from "@/world/sphere";
import { vignetteTone } from "@/ui/ScreenFX";
import { labelFacingFade, planetViewFade } from "@/ui/WorldLabels";
import { cutProgress } from "@/ui/LifePanel";
import { pickSignSpots } from "@/render/RegionSigns";

describe("vignette tone", () => {
  it("follows the light", () => {
    expect(vignetteTone(1, 0)).toBe("day");
    expect(vignetteTone(0.6, 0.8)).toBe("dusk");
    expect(vignetteTone(0.1, 0.2)).toBe("night");
  });
});

describe("planet-view labels", () => {
  it("hide near and beyond the horizon, show facing the camera", () => {
    const dist = 62;
    expect(labelFacingFade(1, dist)).toBe(1);
    expect(labelFacingFade(0.9, dist)).toBe(1);
    expect(labelFacingFade(PLANET_RADIUS / dist, dist)).toBe(0);
    expect(labelFacingFade(-0.5, dist)).toBe(0);
    const mid = labelFacingFade(PLANET_RADIUS / dist + 0.09, dist);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
  it("only appear in the planet view", () => {
    expect(planetViewFade(0)).toBe(0);
    expect(planetViewFade(0.5)).toBe(0);
    expect(planetViewFade(1)).toBe(1);
  });
});

describe("cut-out show", () => {
  it("shares time across every piece of the cut line by length", () => {
    const lengths = [100, 50, 50];
    expect(cutProgress(lengths, 0)).toEqual({ index: 0, along: 0, drawn: [0, 0, 0] });
    expect(cutProgress(lengths, 0.25).drawn).toEqual([50, 0, 0]);
    const mid = cutProgress(lengths, 0.625);
    expect(mid.index).toBe(1);
    expect(mid.along).toBe(25);
    expect(mid.drawn).toEqual([100, 25, 0]);
    const end = cutProgress(lengths, 1);
    expect(end.drawn).toEqual(lengths);
    expect(end.index).toBe(2);
    expect(cutProgress(lengths, 7).drawn).toEqual(lengths);
  });
});

describe("region signposts", () => {
  for (const seed of [4242, 77, 913]) {
    it(`one sign per region on open, dry land (seed ${seed})`, () => {
      const terrain = new Terrain(seed);
      const layout = generateScenery(terrain, seed);
      const spots = pickSignSpots(terrain, layout.items);
      expect(spots.length).toBe(REGIONS.length);
      expect(new Set(spots.map((s) => s.region)).size).toBe(REGIONS.length);
      for (const s of spots) {
        expect(terrain.regionAt(s.n).index).toBe(s.region);
        expect(terrain.isWater(s.n)).toBe(false);
        expect(terrain.isBlockedTerrain(s.n)).toBe(false);
        expect(["path", "sand", "water"]).not.toContain(terrain.sample(s.n).ground);
        expect(Math.abs(s.facing.dot(s.n))).toBeLessThan(1e-6);
        expect(s.facing.length()).toBeCloseTo(1, 6);
        // Near the region's heart, clear of solid scenery.
        expect(angleBetween(s.n, REGIONS[s.region].center)).toBeLessThan(0.53);
        for (const it of layout.items) {
          if (it.radius > 0) expect(angleBetween(it.n, s.n) * PLANET_RADIUS).toBeGreaterThan(it.radius + 0.5);
        }
      }
      // Deterministic.
      const again = pickSignSpots(terrain, layout.items);
      again.forEach((s, i) => expect(s.n.distanceTo(spots[i].n)).toBe(0));
    });
  }
});
