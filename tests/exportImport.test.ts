import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtworkRecord, CreationRecord, EaselRecord, WorldSave } from "@/core/types";
import { StorageFullError, setIDBFactory } from "@/persistence/db";
import { getArtwork, listArtworkIds, releaseAllArtworkUrls, saveArtwork } from "@/persistence/artworks";
import { createEmptyWorld, loadWorld, saveWorld } from "@/persistence/worlds";
import {
  ImportError,
  MAX_IMPORT_BYTES,
  exportFileName,
  exportWorld,
  importWorld,
  parseWorldFile,
} from "@/persistence/exportImport";

// ---------------------------------------------------------------------------
// Fixtures

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];

function bytes(sig: number[], seed: number, len: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(len);
  b.set(sig);
  for (let i = sig.length; i < len; i++) b[i] = (seed * 31 + i * 7) & 0xff;
  return b;
}

function makeArtwork(id: string, hash = `hash-${id}`, seed = 1, jpeg = false): ArtworkRecord {
  return {
    id,
    contentHash: hash,
    source: "upload",
    original: jpeg
      ? new Blob([bytes(JPEG_SIG, seed, 300)], { type: "image/jpeg" })
      : new Blob([bytes(PNG_SIG, seed, 300)], { type: "image/png" }),
    cutout: new Blob([bytes(PNG_SIG, seed + 50, 200)], { type: "image/png" }),
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
    createdAt: 111,
  };
}

function creation(id: string, artworkId: string): CreationRecord {
  return {
    id,
    artworkId,
    kind: "dog",
    name: "Rex",
    behavior: "walk",
    facing: "left",
    classifiedBy: "player",
    position: [1, 0, 0],
    heading: [0, 0, 1],
    createdAt: 2,
    chat: [{ role: "character", text: "Woof!", via: "ai", at: 3 }],
  };
}

function easel(id: string, artworkId: string): EaselRecord {
  return {
    id,
    artworkId,
    title: "Sunset",
    artist: "Kim",
    story: "Orange sky",
    notes: [{ id: "n1", color: "#ff9fb2", text: "Wow", createdAt: 9 }],
    position: [0, 1, 0],
    heading: [1, 0, 0],
    createdAt: 4,
  };
}

async function bytesOf(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

function jsonBlob(v: unknown) {
  return new Blob([JSON.stringify(v)], { type: "application/json" });
}

async function setupPaperWorld(): Promise<WorldSave> {
  await saveArtwork(makeArtwork("a1", "H1", 1));
  await saveArtwork(makeArtwork("a2", "H2", 2, true));
  await saveArtwork(makeArtwork("a3", "H3", 3));
  await saveArtwork(makeArtwork("unused", "HU", 4));
  const w: WorldSave = {
    ...createEmptyWorld("paper", 99),
    creations: [creation("c1", "a1"), creation("c2", "a2"), creation("c3", "a1")],
    easels: [easel("e1", "a3")],
    visited: ["hill"],
  };
  await saveWorld(w);
  return (await loadWorld("paper"))!;
}

async function exportedJson(): Promise<Record<string, unknown> & { world: WorldSave; artworks: Array<Record<string, unknown>> }> {
  return JSON.parse(await (await exportWorld("paper")).text());
}

async function expectImportError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ImportError);
  expect((err as ImportError).code).toBe(code);
  expect((err as ImportError).message.length).toBeGreaterThan(5);
}

beforeEach(() => {
  setIDBFactory(new IDBFactory());
  releaseAllArtworkUrls();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("export → parse → import", () => {
  it("round-trips world state and artwork bytes into a fresh database", async () => {
    const original = await setupPaperWorld();
    const file = await exportWorld("paper");
    expect(file.type).toBe("application/json");

    const json = JSON.parse(await file.text());
    expect(json.format).toBe("wonderglobe-world");
    expect(json.version).toBe(1);
    expect(json.mode).toBe("paper");
    expect(json.artworks.map((a: { id: string }) => a.id).sort()).toEqual(["a1", "a2", "a3"]); // not "unused"
    expect(json.artworks.find((a: { id: string }) => a.id === "a2").original.startsWith("data:image/jpeg;base64,")).toBe(true);

    const originals = new Map<string, ArtworkRecord>();
    for (const id of ["a1", "a2", "a3"]) originals.set(id, (await getArtwork(id))!);

    // Brand-new, empty database (another computer).
    setIDBFactory(new IDBFactory());
    const parsed = await parseWorldFile(file);
    expect(parsed.mode).toBe("paper");
    expect(parsed.warnings).toEqual([]);
    expect(parsed.artworks).toHaveLength(3);

    const imported = await importWorld(parsed);
    const loaded = (await loadWorld("paper"))!;
    const strip = (w: WorldSave) => ({ ...w, updatedAt: 0 });
    expect(strip(loaded)).toEqual(strip(original));
    expect(strip(imported)).toEqual(strip(original));

    expect((await listArtworkIds()).sort()).toEqual(["a1", "a2", "a3"]);
    for (const [id, rec] of originals) {
      const got = (await getArtwork(id))!;
      expect(await bytesOf(got.original)).toEqual(await bytesOf(rec.original));
      expect(await bytesOf(got.cutout)).toEqual(await bytesOf(rec.cutout));
      expect(got.original.type).toBe(rec.original.type);
      expect(got.contentHash).toBe(rec.contentHash);
      expect(got.meta).toEqual(rec.meta);
    }
  });

  it("can import into the other mode", async () => {
    await setupPaperWorld();
    const parsed = await parseWorldFile(await exportWorld("paper"));
    const w = await importWorld(parsed, { targetMode: "gallery" });
    expect(w.mode).toBe("gallery");
    expect((await loadWorld("gallery"))!.creations).toHaveLength(3);
  });

  it("refuses to export when there's no world", async () => {
    await expect(exportWorld("gallery")).rejects.toThrow(/no world/i);
  });

  it("suggests a file name", () => {
    expect(exportFileName("paper", new Date("2026-01-02T10:00:00Z"))).toBe("wonderglobe-paper-2026-01-02.wonderglobe.json");
  });
});

describe("parseWorldFile rejects bad files", () => {
  it("non-JSON", async () => {
    await expectImportError(parseWorldFile(new Blob(["hello, I am a cat"])), "not-json");
  });

  it("wrong format", async () => {
    await expectImportError(parseWorldFile(jsonBlob({ format: "something-else", version: 1 })), "not-wonderglobe");
    await expectImportError(parseWorldFile(jsonBlob([1, 2, 3])), "not-wonderglobe");
    await expectImportError(parseWorldFile(new Blob([])), "not-wonderglobe");
  });

  it("newer version", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    await expectImportError(parseWorldFile(jsonBlob({ ...json, version: 2 })), "newer-version");
  });

  it("damaged envelope", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    await expectImportError(parseWorldFile(jsonBlob({ ...json, mode: "space" })), "damaged");
    await expectImportError(parseWorldFile(jsonBlob({ ...json, world: "nope" })), "damaged");
  });

  it("oversized files", async () => {
    const huge = { size: MAX_IMPORT_BYTES + 1, text: async () => "{}" } as unknown as Blob;
    await expectImportError(parseWorldFile(huge), "too-big");
  });

  it("non-image data URLs", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    const bad = (patch: Record<string, unknown>) =>
      jsonBlob({ ...json, artworks: json.artworks.map((a, i) => (i === 0 ? { ...a, ...patch } : a)) });

    await expectImportError(parseWorldFile(bad({ original: "data:text/html;base64,PGgxPmhpPC9oMT4=" })), "bad-picture");
    // Claims PNG but bytes aren't a PNG.
    await expectImportError(parseWorldFile(bad({ original: `data:image/png;base64,${btoa("not a png at all")}` })), "bad-picture");
    // Not base64.
    await expectImportError(parseWorldFile(bad({ original: "data:image/png,%89PNG" })), "bad-picture");
    await expectImportError(parseWorldFile(bad({ original: "data:image/png;base64,!!!!" })), "bad-picture");
    // Cut-outs must be PNG.
    const jpeg = btoa(String.fromCharCode(...bytes(JPEG_SIG, 1, 30)));
    await expectImportError(parseWorldFile(bad({ cutout: `data:image/jpeg;base64,${jpeg}` })), "bad-picture");
    // SVG is not allowed.
    await expectImportError(parseWorldFile(bad({ original: `data:image/svg+xml;base64,${btoa("<svg/>")}` })), "bad-picture");
  });

  it("drops creations/easels whose picture is missing, with a warning", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    const file = jsonBlob({ ...json, artworks: json.artworks.filter((a) => a.id !== "a1" && a.id !== "a3") });
    const parsed = await parseWorldFile(file);
    expect(parsed.world.creations.map((c) => c.id)).toEqual(["c2"]);
    expect(parsed.world.easels).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings[0]).toMatch(/2 creations were missing a picture/);
    expect(parsed.artworks.map((a) => a.id)).toEqual(["a2"]);
  });

  it("repairs a slightly broken world inside the file", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    const world = {
      ...json.world,
      creations: [...json.world.creations, { id: "broken" }, { ...json.world.creations[0], id: "c9", kind: "zorp" }],
    };
    const parsed = await parseWorldFile(jsonBlob({ ...json, world }));
    expect(parsed.world.creations).toHaveLength(4);
    expect(parsed.world.creations[3].kind).toBe("sculpture");
    expect(parsed.warnings.some((w) => /broken/.test(w))).toBe(true);
  });
});

describe("importWorld", () => {
  it("remaps ids to existing artworks with the same content hash", async () => {
    await setupPaperWorld();
    const json = await exportedJson();

    // A different player already has the same picture as "a1" (hash H1) under a different id.
    setIDBFactory(new IDBFactory());
    await saveArtwork(makeArtwork("mine-7", "H1", 1));

    const parsed = await parseWorldFile(jsonBlob(json));
    const w = await importWorld(parsed);
    expect(w.creations.filter((c) => c.artworkId === "mine-7").map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(w.creations.find((c) => c.id === "c2")!.artworkId).toBe("a2");
    expect((await listArtworkIds()).sort()).toEqual(["a2", "a3", "mine-7"]);
    expect((await loadWorld("paper"))!.creations[0].artworkId).toBe("mine-7");
  });

  it("gives a fresh id when an id is taken by a different picture", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    setIDBFactory(new IDBFactory());
    await saveArtwork(makeArtwork("a1", "SOMETHING-ELSE", 8));

    const w = await importWorld(await parseWorldFile(jsonBlob(json)));
    const newId = w.creations[0].artworkId;
    expect(newId).not.toBe("a1");
    expect((await getArtwork(newId))!.contentHash).toBe("H1");
    expect((await getArtwork("a1"))!.contentHash).toBe("SOMETHING-ELSE");
  });

  it("dedupes repeated pictures inside one file", async () => {
    await setupPaperWorld();
    const json = await exportedJson();
    const a1 = json.artworks.find((a) => a.id === "a1")!;
    const file = jsonBlob({
      ...json,
      artworks: [...json.artworks, { ...a1, id: "a1-copy" }],
      world: { ...json.world, creations: [...json.world.creations, { ...json.world.creations[0], id: "c4", artworkId: "a1-copy" }] },
    });
    setIDBFactory(new IDBFactory());
    const w = await importWorld(await parseWorldFile(file));
    expect(w.creations.find((c) => c.id === "c4")!.artworkId).toBe("a1");
    expect(await listArtworkIds()).not.toContain("a1-copy");
  });

  it("rolls back new artworks and throws StorageFullError when quota is exceeded", async () => {
    await setupPaperWorld();
    const parsed = await parseWorldFile(await exportWorld("paper"));

    setIDBFactory(new IDBFactory());
    await saveArtwork(makeArtwork("keep", "HK", 5));
    const before = { ...createEmptyWorld("paper", 5), creations: [creation("old", "keep")] };
    await saveWorld(before);

    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } })
      .IDBObjectStore.prototype;
    const realPut = proto.put;
    vi.spyOn(proto, "put").mockImplementation(function (this: unknown, ...args: unknown[]) {
      if ((this as { name: string }).name === "worlds") throw new DOMException("quota", "QuotaExceededError");
      return realPut.apply(this, args);
    });

    const err = await importWorld(parsed).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StorageFullError);
    expect((err as StorageFullError).friendlyMessage).toMatch(/room/i);

    vi.restoreAllMocks();
    expect(await listArtworkIds()).toEqual(["keep"]);
    expect((await loadWorld("paper"))!.creations.map((c) => c.id)).toEqual(["old"]);
  });
});
