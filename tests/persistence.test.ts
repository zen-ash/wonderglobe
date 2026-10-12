import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtworkRecord, CreationRecord, EaselRecord, Vec3, WorldSave } from "@/core/types";
import { DEFAULT_PREFERENCES } from "@/core/types";
import {
  StorageFullError,
  StorageUnavailableError,
  getDB,
  isStorageAvailable,
  setIDBFactory,
  translateStorageError,
} from "@/persistence/db";
import {
  deleteArtwork,
  deleteUnreferencedArtworks,
  findArtworkByHash,
  getArtwork,
  getArtworkUrls,
  hasArtwork,
  listArtworkIds,
  releaseAllArtworkUrls,
  releaseArtworkUrls,
  saveArtwork,
} from "@/persistence/artworks";
import {
  collectUnusedArtworks,
  createAutosaver,
  createEmptyWorld,
  deleteWorld,
  loadWorld,
  saveWorld,
} from "@/persistence/worlds";
import { LIMITS, WorldSaveSchema } from "@/persistence/schema";
import { loadPreferences, savePreferences, PREFS_KEY } from "@/persistence/prefs";

// ---------------------------------------------------------------------------
// Fixtures

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngBlob(seed: number, len = 32): Blob {
  const b = new Uint8Array(len);
  b.set(PNG_SIG);
  for (let i = PNG_SIG.length; i < len; i++) b[i] = (seed * 31 + i * 7) & 0xff;
  return new Blob([b], { type: "image/png" });
}

function makeArtwork(id: string, hash = `hash-${id}`, seed = 1): ArtworkRecord {
  return {
    id,
    contentHash: hash,
    source: "drawing",
    original: pngBlob(seed, 40),
    cutout: pngBlob(seed + 100, 24),
    meta: {
      width: 100,
      height: 80,
      polygons: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ],
      anchor: [0.5, 1],
      aspect: 1.25,
      coverage: 0.4,
      palette: ["#ff0000", "#00ff00"],
      roofLine: 0.3,
    },
    originalWidth: 200,
    originalHeight: 160,
    createdAt: 1000,
  };
}

const len = (v: Vec3) => Math.hypot(...v);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function creation(id: string, artworkId: string, extra: Partial<CreationRecord> = {}): CreationRecord {
  return {
    id,
    artworkId,
    kind: "cat",
    name: "Whiskers",
    behavior: "walk",
    facing: "right",
    classifiedBy: "ai",
    position: [0, 1, 0],
    heading: [1, 0, 0],
    createdAt: 5,
    chat: [
      { role: "player", text: "hi", at: 1 },
      { role: "character", text: "Meow!", via: "local", at: 2 },
    ],
    ...extra,
  };
}

function easel(id: string, artworkId: string): EaselRecord {
  return {
    id,
    artworkId,
    title: "My house",
    artist: "Ada",
    story: "It is a house.",
    notes: [
      { id: "n1", color: "#ffe066", text: "Lovely!", createdAt: 3 },
      { id: "n2", color: "#9fd3ff", text: "Blue sky", createdAt: 4 },
    ],
    position: [0, 0, 1],
    heading: [0, 1, 0],
    createdAt: 6,
  };
}

async function putRawWorld(mode: string, raw: unknown) {
  const db = await getDB();
  // Bypass typing on purpose: simulate a corrupted record on disk.
  await (db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put("worlds", raw);
}

beforeEach(() => {
  setIDBFactory(new IDBFactory());
  releaseAllArtworkUrls();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("createEmptyWorld", () => {
  it("creates a valid world with normalised player vectors", () => {
    const w = createEmptyWorld("paper");
    expect(WorldSaveSchema.safeParse(w).success).toBe(true);
    expect(w.seed).toBeGreaterThanOrEqual(0);
    expect(w.seed).toBeLessThanOrEqual(0x7fffffff);
    expect(len(w.player.position)).toBeCloseTo(1, 9);
    expect(len(w.player.heading)).toBeCloseTo(1, 9);
    expect(dot(w.player.position, w.player.heading)).toBeCloseTo(0, 9);
    const n = Math.hypot(0, 0.35, 0.94);
    expect(w.player.position[1]).toBeCloseTo(0.35 / n, 9);
    expect(w.player.position[2]).toBeCloseTo(0.94 / n, 9);
  });

  it("uses the given seed", () => {
    expect(createEmptyWorld("gallery", 1234).seed).toBe(1234);
  });
});

describe("worlds", () => {
  it("returns null when nothing is saved", async () => {
    expect(await loadWorld("paper")).toBeNull();
  });

  it("round-trips a world with creations, easels, notes and chat", async () => {
    const w: WorldSave = {
      ...createEmptyWorld("paper", 42),
      creations: [creation("c1", "a1"), creation("c2", "a2", { kind: "fish", behavior: "swim", name: "Bubbles" })],
      easels: [easel("e1", "a3")],
      visited: ["meadow", "beach"],
    };
    await saveWorld(w);
    const loaded = await loadWorld("paper");
    expect(loaded).not.toBeNull();
    expect({ ...loaded!, updatedAt: 0 }).toEqual({ ...w, updatedAt: 0 });
    expect(await loadWorld("gallery")).toBeNull();
  });

  it("saveWorld refreshes updatedAt without mutating the input", async () => {
    const w = { ...createEmptyWorld("paper", 1), updatedAt: 5 };
    await saveWorld(w);
    expect(w.updatedAt).toBe(5);
    const loaded = await loadWorld("paper");
    expect(loaded!.updatedAt).toBeGreaterThan(5);
  });

  it("deleteWorld removes it", async () => {
    await saveWorld(createEmptyWorld("gallery", 1));
    await deleteWorld("gallery");
    expect(await loadWorld("gallery")).toBeNull();
  });

  it("repairs malformed records gently", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const longStory = "x".repeat(1000);
    const raw = {
      version: 1,
      mode: "paper",
      seed: 77,
      createdAt: 1,
      updatedAt: 2,
      player: { position: [0, 3, 0], heading: [0, 1, 1] },
      creations: [
        creation("ok", "a1", { position: [0, 2, 0] as Vec3, heading: [1, 1, 0] as Vec3 }), // not unit / not tangent
        creation("weird", "a2", { kind: "flibbertigibbet", name: "N".repeat(100) }),
        creation("nan", "a3", { position: [NaN, 0, 0] as Vec3 }), // unusable → dropped
        { id: "noart", kind: "cat" }, // malformed → dropped
        "garbage",
        creation("ok", "a9"), // duplicate id → dropped
        creation("chatty", "a4", {
          chat: Array.from({ length: 30 }, (_, i) => ({ role: "player" as const, text: `${i}` + "y".repeat(500), at: i })),
          behavior: "teleport" as never,
        }),
        creation("zeroheading", "a5", { heading: [0, 0, 0] as Vec3 }),
      ],
      easels: [
        {
          ...easel("e1", "a6"),
          title: "T".repeat(100),
          artist: "A".repeat(100),
          story: longStory,
          notes: Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, color: "not-a-colour", text: "z".repeat(300), createdAt: i })),
        },
        { ...easel("e2", "a7"), position: "up" },
      ],
      visited: ["a", 5, "a", "b"],
    };
    await putRawWorld("paper", raw);
    const w = await loadWorld("paper");
    expect(w).not.toBeNull();
    expect(WorldSaveSchema.safeParse(w).success).toBe(true);

    expect(w!.creations.map((c) => c.id)).toEqual(["ok", "weird", "chatty", "zeroheading"]);
    const ok = w!.creations[0];
    expect(ok.position).toEqual([0, 1, 0]);
    expect(len(ok.heading)).toBeCloseTo(1, 9);
    expect(dot(ok.heading, ok.position)).toBeCloseTo(0, 9);
    expect(ok.heading[0]).toBeCloseTo(1, 9);

    const weird = w!.creations[1];
    expect(weird.kind).toBe("sculpture");
    expect(weird.name.length).toBe(LIMITS.nameLength);

    const chatty = w!.creations[2];
    expect(chatty.chat).toHaveLength(LIMITS.chatLines);
    expect(chatty.chat[0].text.startsWith("10")).toBe(true); // kept the last 20
    expect(chatty.chat.every((l) => l.text.length <= LIMITS.chatLineLength)).toBe(true);
    expect(chatty.behavior).toBe("walk"); // invalid → kind default

    const zh = w!.creations[3];
    expect(len(zh.heading)).toBeCloseTo(1, 9);
    expect(Math.abs(dot(zh.heading, zh.position))).toBeLessThan(1e-9);

    expect(w!.easels).toHaveLength(1);
    const e = w!.easels[0];
    expect(e.title.length).toBe(LIMITS.titleLength);
    expect(e.artist.length).toBe(LIMITS.artistLength);
    expect(e.story.length).toBe(LIMITS.storyLength);
    expect(e.notes).toHaveLength(LIMITS.notesPerEasel);
    expect(e.notes[0].text.length).toBe(LIMITS.noteTextLength);
    expect(e.notes[0].color).toBe("#ffe066");

    expect(w!.visited).toEqual(["a", "b"]);
    expect(w!.player.position).toEqual([0, 1, 0]);
    expect(dot(w!.player.position, w!.player.heading)).toBeCloseTo(0, 9);
    expect(w!.seed).toBe(77);
  });

  it("clamps strings without splitting emoji", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await putRawWorld("paper", {
      ...createEmptyWorld("paper", 1),
      creations: [creation("c", "a", { name: "a" + "🐱".repeat(30) })],
    });
    const w = await loadWorld("paper");
    const name = w!.creations[0].name;
    expect(name.length).toBeLessThanOrEqual(LIMITS.nameLength);
    expect(name).toBe("a" + "🐱".repeat(19));
  });

  it("migrates a record with missing fields and wrong mode", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await putRawWorld("gallery", { mode: "gallery", seed: -5.7, easels: [easel("e", "a")] });
    const w = await loadWorld("gallery");
    expect(w).not.toBeNull();
    expect(w!.version).toBe(1);
    expect(w!.seed).toBe(5);
    expect(w!.creations).toEqual([]);
    expect(w!.easels).toHaveLength(1);
  });

  it("returns null for an unusable record", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await putRawWorld("paper", { mode: "paper", hello: "world" });
    expect(await loadWorld("paper")).toBeNull();
  });
});

describe("artworks", () => {
  it("saves and loads blobs with identical bytes", async () => {
    const a = makeArtwork("a1");
    await saveArtwork(a);
    const got = await getArtwork("a1");
    expect(got).not.toBeNull();
    expect(got!.original).toBeInstanceOf(Blob);
    expect(got!.original.type).toBe("image/png");
    expect(new Uint8Array(await got!.original.arrayBuffer())).toEqual(new Uint8Array(await a.original.arrayBuffer()));
    expect(new Uint8Array(await got!.cutout.arrayBuffer())).toEqual(new Uint8Array(await a.cutout.arrayBuffer()));
    expect(got!.meta).toEqual(a.meta);
    expect(await getArtwork("nope")).toBeNull();
    expect(await hasArtwork("a1")).toBe(true);
    expect(await hasArtwork("nope")).toBe(false);
  });

  it("finds artworks by content hash (dedupe)", async () => {
    await saveArtwork(makeArtwork("a1", "H1"));
    await saveArtwork(makeArtwork("a2", "H2"));
    expect((await findArtworkByHash("H2"))!.id).toBe("a2");
    expect(await findArtworkByHash("H3")).toBeNull();
  });

  it("lists and deletes", async () => {
    await saveArtwork(makeArtwork("a1"));
    await saveArtwork(makeArtwork("a2"));
    expect((await listArtworkIds()).sort()).toEqual(["a1", "a2"]);
    await deleteArtwork("a1");
    expect(await listArtworkIds()).toEqual(["a2"]);
  });

  it("garbage-collects unreferenced artworks", async () => {
    for (const id of ["a1", "a2", "a3", "a4"]) await saveArtwork(makeArtwork(id));
    const deleted = await deleteUnreferencedArtworks(new Set(["a1", "a3"]));
    expect(deleted.sort()).toEqual(["a2", "a4"]);
    expect((await listArtworkIds()).sort()).toEqual(["a1", "a3"]);
  });

  it("GC keeps very new artworks when asked", async () => {
    await saveArtwork({ ...makeArtwork("old"), createdAt: 1000 });
    await saveArtwork({ ...makeArtwork("new"), createdAt: 9_500 });
    const deleted = await deleteUnreferencedArtworks(new Set(), { keepNewerThanMs: 1000, now: 10_000 });
    expect(deleted).toEqual(["old"]);
  });

  it("collectUnusedArtworks considers both worlds", async () => {
    for (const id of ["p", "g", "orphan"]) await saveArtwork({ ...makeArtwork(id), createdAt: 0 });
    await saveWorld({ ...createEmptyWorld("paper", 1), creations: [creation("c", "p")] });
    await saveWorld({ ...createEmptyWorld("gallery", 1), easels: [easel("e", "g")] });
    expect(await collectUnusedArtworks()).toEqual(["orphan"]);
    expect((await listArtworkIds()).sort()).toEqual(["g", "p"]);
  });

  it("caches object URLs per id", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await saveArtwork(makeArtwork("a1"));
    const [u1, u2] = await Promise.all([getArtworkUrls("a1"), getArtworkUrls("a1")]);
    expect(u1).not.toBeNull();
    expect(u1).toBe(u2);
    expect(u1!.originalUrl.startsWith("blob:")).toBe(true);
    expect(await getArtworkUrls("a1")).toBe(u1);
    releaseArtworkUrls("a1");
    expect(revoke).toHaveBeenCalledWith(u1!.originalUrl);
    expect(revoke).toHaveBeenCalledWith(u1!.cutoutUrl);
    const u3 = await getArtworkUrls("a1");
    expect(u3).not.toBe(u1);
    expect(await getArtworkUrls("missing")).toBeNull();
  });
});

describe("autosaver", () => {
  it("debounces and coalesces bursts into one save", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let world = createEmptyWorld("paper", 3);
    const getWorld = vi.fn(() => world);
    const onSaved = vi.fn();
    const saver = createAutosaver(getWorld, { delayMs: 800, onSaved });
    for (let i = 0; i < 5; i++) {
      world = { ...world, visited: [...world.visited, `r${i}`] };
      saver.schedule();
      vi.advanceTimersByTime(300);
    }
    expect(getWorld).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    await saver.flush();
    expect(getWorld).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect((await loadWorld("paper"))!.visited).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    saver.dispose();
  });

  it("flush saves immediately; nothing to do when clean", async () => {
    let world = createEmptyWorld("gallery", 3);
    const getWorld = vi.fn(() => world);
    const saver = createAutosaver(getWorld, { delayMs: 60_000 });
    await saver.flush();
    expect(getWorld).not.toHaveBeenCalled();
    world = { ...world, visited: ["x"] };
    saver.schedule();
    await saver.flush();
    expect(getWorld).toHaveBeenCalledTimes(1);
    expect((await loadWorld("gallery"))!.visited).toEqual(["x"]);
    await saver.flush();
    expect(getWorld).toHaveBeenCalledTimes(1);
    saver.dispose();
  });

  it("reports errors via onError and keeps working", async () => {
    const onError = vi.fn();
    let fail = true;
    const getWorld = () => {
      if (fail) throw new DOMException("disk full", "QuotaExceededError");
      return createEmptyWorld("paper", 9);
    };
    const saver = createAutosaver(getWorld, { delayMs: 10, onError });
    saver.schedule();
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(StorageFullError);
    fail = false;
    saver.schedule();
    await saver.flush();
    expect((await loadWorld("paper"))!.seed).toBe(9);
    saver.dispose();
  });
});

describe("storage availability & errors", () => {
  it("isStorageAvailable is true with IndexedDB", async () => {
    expect(await isStorageAvailable()).toBe(true);
  });

  it("throws StorageUnavailableError when IndexedDB can't open", async () => {
    const broken = {
      open() {
        throw new DOMException("nope", "InvalidStateError");
      },
    } as unknown as IDBFactory;
    setIDBFactory(broken);
    expect(await isStorageAvailable()).toBe(false);
    await expect(loadWorld("paper")).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("maps QuotaExceededError to StorageFullError", () => {
    const e = translateStorageError(new DOMException("quota", "QuotaExceededError"));
    expect(e).toBeInstanceOf(StorageFullError);
    expect(e.message).toMatch(/full|room/i);
  });

  it("saveWorld throws StorageFullError on quota errors", async () => {
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } })
      .IDBObjectStore.prototype;
    const realPut = proto.put;
    vi.spyOn(proto, "put").mockImplementation(function (this: unknown, ...args: unknown[]) {
      if ((this as { name: string }).name === "worlds") throw new DOMException("quota", "QuotaExceededError");
      return realPut.apply(this, args);
    });
    await expect(saveWorld(createEmptyWorld("paper", 1))).rejects.toBeInstanceOf(StorageFullError);
  });
});

describe("preferences", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      get length() {
        return m.size;
      },
      _map: m,
    };
  }

  it("returns defaults without localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(savePreferences(DEFAULT_PREFERENCES)).toBe(false);
  });

  it("round-trips and merges with defaults, rejecting bad fields", () => {
    const ls = memoryStorage({
      [PREFS_KEY]: JSON.stringify({ music: false, musicVolume: 7, sound: "yes", lastMode: "paper", playerName: "P".repeat(80), extra: 1 }),
    });
    vi.stubGlobal("localStorage", ls);
    const p = loadPreferences();
    expect(p.music).toBe(false);
    expect(p.musicVolume).toBe(1);
    expect(p.sound).toBe(DEFAULT_PREFERENCES.sound);
    expect(p.lastMode).toBe("paper");
    expect(p.playerName.length).toBe(LIMITS.playerNameLength);
    expect("extra" in p).toBe(false);
    expect(savePreferences({ ...p, voice: false })).toBe(true);
    expect(loadPreferences().voice).toBe(false);
  });

  it("survives corrupt JSON and throwing storage", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [PREFS_KEY]: "{not json" }));
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(savePreferences(DEFAULT_PREFERENCES)).toBe(false);
  });
});
