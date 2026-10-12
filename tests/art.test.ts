// Pure-data checks for the procedural art modules (no canvas in Node, so the
// drawings themselves are reviewed visually via src/art/preview.ts).

import { describe, expect, it } from "vitest";
import { SCENERY_IDS, pickSceneryVariant, sceneryVariantCount, type AtlasEntry } from "@/art/sceneryAtlas";
import { SAMPLE_DRAWINGS } from "@/art/samples";
import { lookFromSeed } from "@/art/characters";

describe("scenery atlas ids", () => {
  it("contains the ground-cover ids used by the world", () => {
    for (const id of ["flower_orange", "flower_purple", "wildflowers", "fern", "grass_tall", "pebbles"] as const) {
      expect(SCENERY_IDS).toContain(id);
    }
  });

  it("keeps every original id", () => {
    const original = [
      "tree_round", "tree_pine", "tree_cherry", "tree_fruit", "tree_birch", "palm", "bush", "bush_berry",
      "flower_red", "flower_yellow", "flower_blue", "flower_pink", "flower_white", "tulip", "sunflower",
      "daisy_cluster", "mushroom", "grass_tuft", "reed", "rock", "boulder", "house_red", "house_blue",
      "house_yellow", "cottage", "barn", "windmill", "well", "fence", "haystack", "scarecrow", "pumpkin",
      "cabbage_row", "cow", "sheep", "chicken", "duck", "picnic_blanket", "picnic_basket", "kite",
      "lighthouse", "beach_hut", "shell", "sailboat", "lamp_post", "signpost", "bench", "snow_pine",
      "mountain_peak", "cloud", "butterfly", "bird", "visitor_a", "visitor_b", "visitor_c",
    ];
    for (const id of original) expect(SCENERY_IDS).toContain(id);
    expect(new Set(SCENERY_IDS).size).toBe(SCENERY_IDS.length);
  });

  it("has children's variants for common items and fits a 4096 px atlas", () => {
    for (const id of ["tree_round", "bush", "flower_red", "grass_tuft", "house_red"] as const) {
      expect(sceneryVariantCount(id)).toBeGreaterThanOrEqual(2);
    }
    const cells = SCENERY_IDS.reduce((n, id) => n + sceneryVariantCount(id), 0);
    // 8 columns of 256 px cells, at most 4096 px tall.
    expect(Math.ceil(cells / 8) * 256).toBeLessThanOrEqual(4096);
  });

  it("picks variants stably", () => {
    const mk = (u: number): AtlasEntry => ({ u0: u, v0: 0, u1: u + 0.1, v1: 0.1, aspect: 1, anchorY: 0.1 });
    const a = mk(0);
    const entry: AtlasEntry = { ...a, variants: [a, mk(0.2), mk(0.4)] };
    expect(pickSceneryVariant(entry, 0)).toBe(a);
    expect(pickSceneryVariant(entry, 4).u0).toBe(0.2);
    expect(pickSceneryVariant(entry, -2).u0).toBe(0.4);
    expect(pickSceneryVariant(a, 7)).toBe(a);
  });
});

describe("sample drawings", () => {
  it("keeps sample ids and kinds unchanged", () => {
    expect(SAMPLE_DRAWINGS.map((s) => [s.id, s.suggestedKind])).toEqual([
      ["fish", "fish"],
      ["house", "house"],
      ["cat", "cat"],
      ["flower", "flower"],
      ["bird", "bird"],
      ["car", "car"],
      ["butterfly", "butterfly"],
      ["tree", "tree"],
      ["duck", "duck"],
      ["dragon", "dragon"],
      ["rocket", "rocket"],
    ]);
  });
});

describe("people", () => {
  it("derives the same look from the same seed", () => {
    expect(lookFromSeed(5)).toEqual(lookFromSeed(5));
  });
});
