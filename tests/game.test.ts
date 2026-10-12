// Pure game-progress logic: stickers, quests, treasure placement, storybook text.

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import type { CreationRecord, EaselRecord, WorldSave } from "@/core/types";
import { createEmptyWorld } from "@/persistence/worlds";
import { Terrain, REGION_BY_ID, REGIONS, WATER_BODIES } from "@/world/planet";
import { generateScenery } from "@/world/scenery";
import { ObstacleGrid } from "@/world/collision";
import { walkable } from "@/world/player";
import { angleBetween, pointAt, PLANET_RADIUS } from "@/world/sphere";
import { STICKERS, STICKER_BY_ID, newStickers, stickerCount, stickersEarnedByWorld, stickersForMode, withStickers } from "@/game/stickers";
import { QUESTS, QUEST_BY_ID, questAction, questsForMode, syncQuests } from "@/game/quests";
import {
  PICKUP_RADIUS,
  butterflyPoint,
  canCatchButterfly,
  canCollect,
  goldenButterflies,
  placeTreasures,
  treasureIdsFor,
} from "@/game/collectibles";
import { creationSentence, storybookTitle } from "@/game/story";
import { ICONS } from "@/art/stickerIcons";

let cid = 0;
function creation(kind: string, behavior: CreationRecord["behavior"]): CreationRecord {
  cid++;
  return {
    id: `c${cid}`,
    artworkId: `a${cid}`,
    kind,
    name: "Bob",
    behavior,
    facing: "right",
    classifiedBy: "player",
    position: [1, 0, 0],
    heading: [0, 0, 1],
    createdAt: cid,
    chat: [],
  };
}

function easel(notes = 0): EaselRecord {
  cid++;
  return {
    id: `e${cid}`,
    artworkId: `a${cid}`,
    title: "Hi",
    artist: "Me",
    story: "",
    notes: Array.from({ length: notes }, (_, i) => ({ id: `n${cid}-${i}`, color: "#ffe066", text: "yay", createdAt: 1 })),
    position: [0, 1, 0],
    heading: [1, 0, 0],
    createdAt: cid,
  };
}

const paper = (patch: Partial<WorldSave> = {}): WorldSave => ({ ...createEmptyWorld("paper", 42), ...patch });
const gallery = (patch: Partial<WorldSave> = {}): WorldSave => ({ ...createEmptyWorld("gallery", 42), ...patch });

// ---------------------------------------------------------------------------

describe("stickers", () => {
  it("has about thirty stickers with unique ids and drawable icons", () => {
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    expect(stickersForMode("paper").length).toBeGreaterThanOrEqual(28);
    expect(stickersForMode("gallery").length).toBeGreaterThanOrEqual(20);
    for (const s of STICKERS) {
      expect(ICONS[s.icon], s.icon).toBeTypeOf("function");
      expect(s.hint.length).toBeLessThanOrEqual(30);
      expect(s.title.length).toBeLessThanOrEqual(20);
    }
    // One per region.
    for (const r of REGIONS) expect(STICKER_BY_ID[`place-${r.id}`]).toBeTruthy();
  });

  it("an empty world has earned nothing", () => {
    expect(stickersEarnedByWorld(paper())).toEqual([]);
    expect(stickersEarnedByWorld(gallery())).toEqual([]);
  });

  it("earns region, count, family and bridge stickers from creations", () => {
    const w = paper({
      visited: ["garden", "farm"],
      creations: [creation("fish", "swim"), creation("bird", "fly"), creation("bridge", "build"), creation("tree", "grow"), creation("car", "drive")],
    });
    const got = stickersEarnedByWorld(w);
    expect(got).toEqual(
      expect.arrayContaining(["place-garden", "place-farm", "make-1", "make-5", "family-animal", "family-swimmer", "family-flyer", "family-building", "family-plant", "family-vehicle", "bridge"]),
    );
    expect(got).not.toContain("make-10");
    expect(got).not.toContain("family-imaginary");
    expect(got).not.toContain("place-lake");
  });

  it("an imaginary creature that drifts counts as imaginary and a flyer", () => {
    const got = stickersEarnedByWorld(paper({ creations: [creation("ghost", "hover")] }));
    expect(got).toEqual(expect.arrayContaining(["family-imaginary", "family-flyer"]));
  });

  it("gallery stickers come from pictures and notes", () => {
    const got = stickersEarnedByWorld(gallery({ easels: [easel(2), easel(3), easel(0)] }));
    expect(got).toEqual(expect.arrayContaining(["picture-1", "picture-3", "note-1", "note-5"]));
    expect(got).not.toContain("picture-10");
    expect(got).not.toContain("make-1");
  });

  it("treasure stickers: first, all, summit star (paper only), golden butterfly", () => {
    expect(stickersEarnedByWorld(paper({ found: ["key"] }))).toContain("treasure-1");
    expect(stickersEarnedByWorld(paper({ found: ["golden-2"] }))).toEqual(["golden-butterfly"]);
    const all = treasureIdsFor("paper");
    const got = stickersEarnedByWorld(paper({ found: all }));
    expect(got).toEqual(expect.arrayContaining(["treasure-1", "treasure-all", "summit-star"]));
    // The gallery has no summit star, so its "all" doesn't need it.
    const g = stickersEarnedByWorld(gallery({ found: treasureIdsFor("gallery") }));
    expect(g).toContain("treasure-all");
    expect(g).not.toContain("summit-star");
  });

  it("newStickers only returns real, new stickers for the mode (no duplicates)", () => {
    const w = paper({ stickers: ["make-1"] });
    expect(newStickers(w, ["make-1", "pat", "pat", "picture-1", "nonsense", "rider"])).toEqual(["pat", "rider"]);
    expect(newStickers(gallery(), ["pat", "postcard"])).toEqual(["postcard"]);
    expect(withStickers(w, ["pat", "make-1"])).toEqual(["make-1", "pat"]);
  });

  it("counts earned stickers for the mode", () => {
    const c = stickerCount(paper({ stickers: ["make-1", "picture-1", "pat"] }));
    expect(c.earned).toBe(2);
    expect(c.total).toBe(stickersForMode("paper").length);
  });
});

// ---------------------------------------------------------------------------

describe("quests", () => {
  it("every quest has a short prompt and a valid reward", () => {
    for (const q of QUESTS) {
      expect(q.prompt.split(" ").length, q.id).toBeLessThanOrEqual(14);
      if (q.reward) expect(STICKER_BY_ID[q.reward], q.reward).toBeTruthy();
      for (const m of q.modes) if (q.reward) expect(STICKER_BY_ID[q.reward].modes).toContain(m);
    }
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
  });

  it("a fresh paper world starts with the swimming quest", () => {
    const s = syncQuests(paper());
    expect(s.progress).toEqual({ completed: [], active: "swim" });
    expect(s.finished).toBeNull();
    expect(s.changed).toBe(true);
    expect(questAction(QUEST_BY_ID.swim, paper())).toEqual({ kind: "draw", label: "Draw!", prompt: "Draw something that swims!" });
  });

  it("finishes the active quest when its predicate passes, then moves on", () => {
    const w = paper({ quests: { completed: [], active: "swim" }, creations: [creation("fish", "swim")] });
    const s = syncQuests(w);
    expect(s.finished?.id).toBe("swim");
    expect(s.progress.completed).toEqual(["swim"]);
    // A fish can be patted, so the pat quest is next.
    expect(s.progress.active).toBe("pat");
  });

  it("a floating creation also completes the swim quest", () => {
    expect(QUEST_BY_ID.swim.check(paper({ creations: [creation("duck", "float")] }))).toBe(true);
    expect(QUEST_BY_ID.swim.check(paper({ creations: [creation("dog", "walk")] }))).toBe(false);
  });

  it("quietly ticks off quests the child already did, without celebrating them", () => {
    const w = paper({ quests: { completed: [], active: null }, creations: [creation("fish", "swim")], stickers: ["pat"], visited: ["farm"] });
    const s = syncQuests(w);
    expect(s.finished).toBeNull();
    expect(s.progress.completed).toEqual(["swim", "pat", "farm"]);
    expect(s.progress.active).toBe("key");
  });

  it("skips quests whose requirement isn't met yet (pat needs a creature)", () => {
    const w = paper({ quests: { completed: ["swim"], active: null } });
    expect(syncQuests(w).progress.active).toBe("farm");
  });

  it("event quests use the sticker the event earned; treasure and summit quests use found ids", () => {
    expect(QUEST_BY_ID.pat.check(paper({ stickers: ["pat"] }))).toBe(true);
    expect(QUEST_BY_ID.photo.check(gallery({ stickers: ["postcard"] }))).toBe(true);
    expect(QUEST_BY_ID.key.check(paper({ found: ["key"] }))).toBe(true);
    expect(QUEST_BY_ID.summit.check(paper({ found: ["summit-star"] }))).toBe(true);
    expect(QUEST_BY_ID.bridge.check(paper({ creations: [creation("bridge", "build")] }))).toBe(true);
  });

  it("the summit quest asks for a flyer first, then points at the mountain", () => {
    expect(questAction(QUEST_BY_ID.summit, paper())?.kind).toBe("draw");
    expect(questAction(QUEST_BY_ID.summit, paper({ creations: [creation("dragon", "fly")] }))).toMatchObject({ kind: "go", region: "mountain" });
  });

  it("gallery quests differ: hang a picture, then a sticky note, …", () => {
    expect(questsForMode("gallery").map((q) => q.id)).not.toContain("swim");
    expect(syncQuests(gallery()).progress.active).toBe("hang-1");
    const s = syncQuests(gallery({ quests: { completed: [], active: "hang-1" }, easels: [easel()] }));
    expect(s.finished?.id).toBe("hang-1");
    expect(s.progress.active).toBe("note");
  });

  it("is stable once everything is done", () => {
    const done = questsForMode("gallery").map((q) => q.id);
    const s = syncQuests(gallery({ quests: { completed: done, active: null } }));
    expect(s.changed).toBe(false);
    expect(s.progress.active).toBeNull();
  });

  it("drops an active quest from the other world", () => {
    const s = syncQuests(gallery({ quests: { completed: [], active: "swim" } }));
    expect(s.progress.active).toBe("hang-1");
    expect(s.finished).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("hidden treasures", () => {
  const seeds = [42, 7, 123456, 2024];

  it("are placed deterministically per seed", () => {
    for (const seed of seeds.slice(0, 2)) {
      const t = new Terrain(seed);
      const layout = generateScenery(t, seed);
      const a = placeTreasures(t, seed, "paper", layout);
      const b = placeTreasures(new Terrain(seed), seed, "paper", generateScenery(new Terrain(seed), seed));
      expect(a.map((x) => [x.id, x.n.toArray(), x.pos.toArray()])).toEqual(b.map((x) => [x.id, x.n.toArray(), x.pos.toArray()]));
    }
    const t1 = placeTreasures(new Terrain(1), 1, "paper");
    const t2 = placeTreasures(new Terrain(2), 2, "paper");
    expect(t1.find((t) => t.id === "acorn")!.n.equals(t2.find((t) => t.id === "acorn")!.n)).toBe(false);
  });

  it("has twelve treasures in the paper world and no summit star in the gallery", () => {
    const t = new Terrain(42);
    expect(placeTreasures(t, 42, "paper").map((x) => x.id)).toEqual(treasureIdsFor("paper"));
    expect(treasureIdsFor("paper")).toHaveLength(12);
    expect(treasureIdsFor("gallery")).not.toContain("summit-star");
    expect(placeTreasures(t, 42, "gallery").some((x) => x.id === "summit-star")).toBe(false);
  });

  for (const seed of seeds) {
    it(`are reachable (seed ${seed})`, () => {
      const terrain = new Terrain(seed);
      const layout = generateScenery(terrain, seed);
      const grid = new ObstacleGrid();
      layout.items.forEach((it, i) => {
        if (it.radius > 0) grid.add({ id: `s${i}`, n: it.n, radius: it.radius });
      });
      const list = placeTreasures(terrain, seed, "paper", layout);
      const regionIndex = (id: string) => REGIONS.findIndex((r) => r.id === id);

      for (const t of list) {
        expect(Number.isFinite(t.pos.x + t.pos.y + t.pos.z), t.id).toBe(true);
        expect(Math.abs(t.n.length() - 1)).toBeLessThan(1e-6);
        if (t.id === "summit-star") {
          // On the very top of the mountain, above the peak.
          const peak = REGION_BY_ID.mountain.center;
          expect(angleBetween(t.n, peak)).toBeLessThan(1e-6);
          expect(t.airborne).toBe(true);
          expect(t.pos.length()).toBeGreaterThan(terrain.heightAt(peak) + 1);
          for (let k = 0; k < 12; k++) expect(t.pos.length()).toBeGreaterThan(terrain.heightAt(pointAt(peak, 0.03, k, new Vector3())));
          // A flying ride gets it; walking around the mountain doesn't.
          const flyBy = t.pos.clone().add(new Vector3(0.5, 0.5, 0.5));
          expect(canCollect(t, flyBy, flyBy.clone().normalize())).toBe(true);
          const foot = pointAt(peak, 0.16, 1, new Vector3());
          expect(canCollect(t, foot.clone().multiplyScalar(terrain.heightAt(foot)), foot)).toBe(false);
          continue;
        }
        if (t.id === "bottle" || t.id === "lily" || t.id === "pearl") {
          // Right at a water edge: in the water, with dry walkable shore within reach.
          expect(t.onWater, t.id).toBe(true);
          expect(terrain.waterAt(t.n), t.id).toBeGreaterThanOrEqual(0);
          let reach = false;
          for (let k = 0; k < 64 && !reach; k++) {
            const p = pointAt(t.n, (PICKUP_RADIUS * 0.9) / PLANET_RADIUS, (k / 64) * Math.PI * 2, new Vector3());
            if (walkable(terrain, grid, p)) reach = canCollect(t, p.clone().multiplyScalar(terrain.heightAt(p)), p);
          }
          expect(reach, `${t.id} reachable from the shore`).toBe(true);
          continue;
        }
        // Everything else lies on dry, walkable land in its region.
        expect(t.onWater, t.id).toBe(false);
        expect(terrain.waterAt(t.n), t.id).toBe(-1);
        expect(walkable(terrain, grid, t.n), `${t.id} walkable`).toBe(true);
        expect(terrain.regionAt(t.n).index, t.id).toBe(regionIndex(t.region));
        const stand = t.n.clone();
        expect(canCollect(t, stand.clone().multiplyScalar(terrain.heightAt(stand)), stand)).toBe(true);
      }
    });
  }

  it("the key hides beside a mushroom in the forest", () => {
    const seed = 42;
    const terrain = new Terrain(seed);
    const layout = generateScenery(terrain, seed);
    const key = placeTreasures(terrain, seed, "paper", layout).find((t) => t.id === "key")!;
    const nearest = Math.min(...layout.items.filter((i) => i.art === "mushroom").map((m) => angleBetween(m.n, key.n) * PLANET_RADIUS));
    expect(nearest).toBeLessThan(0.8);
    expect(key.region).toBe("forest");
  });

  it("shore treasures sit next to the right water", () => {
    const terrain = new Terrain(42);
    const list = placeTreasures(terrain, 42, "paper", generateScenery(terrain, 42));
    const water = (id: string) => WATER_BODIES.findIndex((w) => w.id === id);
    expect(terrain.waterAt(list.find((t) => t.id === "lily")!.n)).toBe(water("lily"));
    expect(terrain.waterAt(list.find((t) => t.id === "pearl")!.n)).toBe(water("lake"));
    expect(terrain.waterAt(list.find((t) => t.id === "bottle")!.n)).toBe(water("sea"));
  });

  it("walking far away doesn't pick anything up", () => {
    const terrain = new Terrain(42);
    const acorn = placeTreasures(terrain, 42, "paper").find((t) => t.id === "acorn")!;
    const away = pointAt(acorn.n, 3 / PLANET_RADIUS, 0.5, new Vector3());
    expect(canCollect(acorn, away.clone().multiplyScalar(terrain.heightAt(away)), away)).toBe(false);
  });
});

describe("golden butterflies", () => {
  it("are deterministic per seed and day, and vanish once caught", () => {
    const a = goldenButterflies(42, 20000);
    const b = goldenButterflies(42, 20000);
    expect(a.map((x) => [x.id, x.region, x.phase])).toEqual(b.map((x) => [x.id, x.region, x.phase]));
    // Over a few weeks both appear sometimes, in land regions other than the start garden.
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) for (const bf of goldenButterflies(42, 20000 + d)) {
      seen.add(bf.id);
      expect(["garden", "lily", "duckpond", "lake", "coast", "mountain"]).not.toContain(bf.region);
    }
    expect([...seen].sort()).toEqual(["golden-1", "golden-2"]);
    for (let d = 0; d < 30; d++) expect(goldenButterflies(42, 20000 + d, ["golden-1", "golden-2"])).toEqual([]);
  });

  it("flutter above the ground near their region and can be caught by walking under them", () => {
    const terrain = new Terrain(42);
    let def = null;
    for (let d = 0; !def; d++) def = goldenButterflies(42, 20000 + d)[0] ?? null;
    const n = new Vector3();
    const p = butterflyPoint(def, 12.5, terrain, new Vector3(), n);
    expect(p.length()).toBeGreaterThan(terrain.heightAt(n) + 0.5);
    expect(angleBetween(n, def.center)).toBeLessThan(0.2);
    expect(canCatchButterfly(n, n.clone())).toBe(true);
    expect(canCatchButterfly(n, pointAt(n, 0.3, 0, new Vector3()))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("storybook text", () => {
  it("makes a friendly sentence per creation", () => {
    const fish = { ...creation("fish", "swim"), id: "fixed", name: "Bubbles" };
    const s = creationSentence(fish, "Lily Pond");
    expect(s.startsWith("Bubbles the fish ")).toBe(true);
    expect(s).toContain("Lily Pond");
    expect(creationSentence(fish, "Lily Pond")).toBe(s);
    expect(creationSentence({ ...fish, name: "Fish" }, "Lily Pond").startsWith("The fish ")).toBe(true);
  });

  it("titles the cover with the child's name", () => {
    expect(storybookTitle("Mia")).toBe("Mia's Wonderglobe");
    expect(storybookTitle("James")).toBe("James' Wonderglobe");
    expect(storybookTitle("  ")).toBe("My Wonderglobe");
  });
});

describe("quest order", () => {
  it("lists every quest of a mode exactly once", () => {
    for (const mode of ["paper", "gallery"] as const) {
      const ids = questsForMode(mode).map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(QUESTS.filter((q) => q.modes.includes(mode)).map((q) => q.id).sort());
    }
  });
});
