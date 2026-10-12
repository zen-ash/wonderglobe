// Game-progress fields in saves: stickers, quests, found treasures, the
// player's own drawing and the onboarding flag.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtworkRecord, WorldSave } from "@/core/types";
import { setIDBFactory } from "@/persistence/db";
import { getArtwork, listArtworkIds, releaseAllArtworkUrls, saveArtwork } from "@/persistence/artworks";
import { collectUnusedArtworks, createEmptyWorld, loadWorld, saveWorld } from "@/persistence/worlds";
import { referencedArtworkIds, repairWorld } from "@/persistence/repair";
import { LIMITS, WorldSaveSchema } from "@/persistence/schema";
import { exportWorld, importWorld, parseWorldFile } from "@/persistence/exportImport";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function png(seed: number, len = 64): Blob {
  const b = new Uint8Array(len);
  b.set(PNG_SIG);
  for (let i = PNG_SIG.length; i < len; i++) b[i] = (seed * 31 + i * 7) & 0xff;
  return new Blob([b], { type: "image/png" });
}

function art(id: string, hash = `hash-${id}`, seed = 1): ArtworkRecord {
  return {
    id,
    contentHash: hash,
    source: "drawing",
    original: png(seed, 80),
    cutout: png(seed + 50, 60),
    meta: {
      width: 64,
      height: 64,
      polygons: [
        [
          [0, 0],
          [64, 0],
          [64, 64],
        ],
      ],
      anchor: [0.5, 1],
      aspect: 1,
      coverage: 0.5,
      palette: ["#123456"],
      roofLine: 0.4,
    },
    originalWidth: 64,
    originalHeight: 64,
    // Old enough that garbage collection may delete it if unreferenced.
    createdAt: 1,
  };
}

function progressWorld(): WorldSave {
  return {
    ...createEmptyWorld("paper", 1234),
    visited: ["garden", "farm"],
    stickers: ["place-garden", "make-1", "night-owl"],
    quests: { completed: ["swim", "pat"], active: "farm" },
    found: ["key", "golden-1"],
    playerArtworkId: "me",
    onboarded: true,
  };
}

beforeEach(() => {
  setIDBFactory(new IDBFactory());
  releaseAllArtworkUrls();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("progress fields in the schema", () => {
  it("a fresh world has empty progress and validates", () => {
    const w = createEmptyWorld("gallery", 5);
    expect(w.stickers).toEqual([]);
    expect(w.found).toEqual([]);
    expect(w.quests).toEqual({ completed: [], active: null });
    expect(w.playerArtworkId).toBeNull();
    expect(w.onboarded).toBe(false);
    expect(WorldSaveSchema.safeParse(w).success).toBe(true);
  });

  it("keeps the new fields (zod would strip unknown keys)", () => {
    const parsed = WorldSaveSchema.parse(progressWorld());
    expect(parsed.stickers).toEqual(["place-garden", "make-1", "night-owl"]);
    expect(parsed.quests).toEqual({ completed: ["swim", "pat"], active: "farm" });
    expect(parsed.found).toEqual(["key", "golden-1"]);
    expect(parsed.playerArtworkId).toBe("me");
    expect(parsed.onboarded).toBe(true);
  });

  it("rejects oversized lists in strict validation", () => {
    const w = { ...progressWorld(), stickers: Array.from({ length: LIMITS.stickers + 1 }, (_, i) => `s${i}`) };
    expect(WorldSaveSchema.safeParse(w).success).toBe(false);
  });
});

describe("saving and loading progress", () => {
  it("round-trips through IndexedDB", async () => {
    const w = progressWorld();
    await saveWorld(w);
    const loaded = (await loadWorld("paper"))!;
    expect({ ...loaded, updatedAt: 0 }).toEqual({ ...w, updatedAt: 0 });
  });

  it("old saves without the fields still load, unchanged", async () => {
    const old = {
      version: 1,
      mode: "paper",
      seed: 77,
      createdAt: 10,
      updatedAt: 11,
      player: { position: [0, 0, 1], heading: [0, 1, 0] },
      creations: [],
      easels: [],
      visited: ["garden"],
    };
    const r = repairWorld(old, "paper")!;
    expect(r).not.toBeNull();
    expect(r.log.fixes).toEqual([]);
    expect(r.world).toEqual(old);
    expect("stickers" in r.world).toBe(false);
    expect("onboarded" in r.world).toBe(false);
  });

  it("repairs messy progress: dedupes, drops junk, caps, clears a completed active quest", () => {
    const raw = {
      ...progressWorld(),
      stickers: ["a", "a", 5, "", "  b  ", "x".repeat(LIMITS.progressIdLength + 1), ...Array.from({ length: LIMITS.stickers + 20 }, (_, i) => `s${i}`)],
      found: "nope",
      quests: { completed: ["swim", "swim", 3], active: "swim" },
      playerArtworkId: { bad: true },
      onboarded: "yes",
    };
    const { world } = repairWorld(raw, "paper")!;
    expect(world.stickers!.slice(0, 3)).toEqual(["a", "b", "s0"]);
    expect(world.stickers!.length).toBe(LIMITS.stickers);
    expect(world.found).toEqual([]);
    expect(world.quests).toEqual({ completed: ["swim"], active: null });
    expect(world.playerArtworkId).toBeNull();
    expect(world.onboarded).toBe(false);
    expect(WorldSaveSchema.safeParse(world).success).toBe(true);
  });

  it("keeps a null player drawing and missing quests object shape", () => {
    const { world } = repairWorld({ ...progressWorld(), playerArtworkId: null, quests: null }, "paper")!;
    expect(world.playerArtworkId).toBeNull();
    expect(world.quests).toEqual({ completed: [], active: null });
  });
});

describe("the player's own drawing is a referenced artwork", () => {
  it("is part of referencedArtworkIds", () => {
    expect([...referencedArtworkIds(progressWorld())]).toContain("me");
    expect([...referencedArtworkIds({ ...progressWorld(), playerArtworkId: null })]).not.toContain("me");
  });

  it("survives garbage collection", async () => {
    await saveArtwork(art("me", "HME", 1));
    await saveArtwork(art("junk", "HJ", 2));
    await saveWorld(progressWorld());
    await collectUnusedArtworks({ keepNewerThanMs: 0 });
    expect((await listArtworkIds()).sort()).toEqual(["me"]);
  });

  it("is exported, imported and remapped onto an existing identical picture", async () => {
    await saveArtwork(art("me", "HME", 1));
    await saveWorld(progressWorld());
    const file = await exportWorld("paper");
    const json = JSON.parse(await file.text());
    expect(json.artworks.map((a: { id: string }) => a.id)).toEqual(["me"]);
    expect(json.world.playerArtworkId).toBe("me");
    expect(json.world.stickers).toEqual(["place-garden", "make-1", "night-owl"]);

    // Another computer that already has the same picture under another id.
    setIDBFactory(new IDBFactory());
    await saveArtwork(art("mine-here", "HME", 1));
    const parsed = await parseWorldFile(file);
    const imported = await importWorld(parsed);
    expect(imported.playerArtworkId).toBe("mine-here");
    expect(imported.found).toEqual(["key", "golden-1"]);
    expect(imported.quests).toEqual({ completed: ["swim", "pat"], active: "farm" });
    const loaded = (await loadWorld("paper"))!;
    expect(loaded.playerArtworkId).toBe("mine-here");
    expect(await getArtwork("mine-here")).toBeTruthy();
  });

  it("falls back to the default look when the picture is missing", async () => {
    await saveWorld(progressWorld()); // "me" was never stored
    const json = JSON.parse(await (await exportWorld("paper")).text());
    expect(json.world.playerArtworkId).toBeNull();
    json.world.playerArtworkId = "ghost";
    const parsed = await parseWorldFile(new Blob([JSON.stringify(json)], { type: "application/json" }));
    expect(parsed.world.playerArtworkId).toBeNull();
  });
});
