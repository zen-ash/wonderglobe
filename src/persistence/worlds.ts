// World saves: one WorldSave per mode, gently repaired on load, debounced autosave.

import type { WorldMode, WorldSave } from "@/core/types";
import { deleteUnreferencedArtworks } from "./artworks";
import { translateStorageError, withDB } from "./db";
import { defaultPlayer, randomSeed, referencedArtworkIds, repairWorld } from "./repair";

export const WORLD_MODES: readonly WorldMode[] = ["paper", "gallery"];

/** A brand-new empty world. `seed` defaults to a random 31-bit integer. */
export function createEmptyWorld(mode: WorldMode, seed?: number): WorldSave {
  const now = Date.now();
  const s = seed !== undefined && Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % 0x80000000 : randomSeed();
  return {
    version: 1,
    mode,
    seed: s,
    createdAt: now,
    updatedAt: now,
    player: defaultPlayer(),
    creations: [],
    easels: [],
    visited: [],
    stickers: [],
    quests: { completed: [], active: null },
    found: [],
    playerArtworkId: null,
    onboarded: false,
  };
}

/**
 * Load the world for `mode`. Minor corruption is repaired (and logged);
 * returns null if nothing is saved or the record is unusable.
 */
export async function loadWorld(mode: WorldMode): Promise<WorldSave | null> {
  const raw = await withDB((db) => db.get("worlds", mode));
  if (raw === undefined) return null;
  const result = repairWorld(raw, mode);
  if (!result) {
    console.warn(`[wonderglobe] saved ${mode} world is unreadable – starting fresh`);
    return null;
  }
  if (result.log.fixes.length) {
    console.warn(`[wonderglobe] repaired saved ${mode} world:`, result.log.fixes);
  }
  return result.world;
}

const FULL_MESSAGE = "Your world is so full there's no room to save it! Remove a few creations to make space.";

/** Save a world (stored with a fresh `updatedAt`; the passed object isn't mutated). */
export async function saveWorld(world: WorldSave): Promise<void> {
  const toStore: WorldSave = { ...world, updatedAt: Date.now() };
  await withDB(async (db) => {
    await db.put("worlds", toStore);
  }, FULL_MESSAGE);
}

export async function deleteWorld(mode: WorldMode): Promise<void> {
  await withDB((db) => db.delete("worlds", mode));
}

/**
 * Delete artworks no longer referenced by ANY saved world. Call after removals
 * (and after the world has been saved/flushed). Artworks created in the last
 * `keepNewerThanMs` (default 10 minutes) are kept to avoid racing an unsaved world.
 */
export async function collectUnusedArtworks(opts: { keepNewerThanMs?: number } = {}): Promise<string[]> {
  const referenced = new Set<string>();
  for (const mode of WORLD_MODES) {
    const w = await loadWorld(mode);
    if (w) for (const id of referencedArtworkIds(w)) referenced.add(id);
  }
  return deleteUnreferencedArtworks(referenced, { keepNewerThanMs: opts.keepNewerThanMs ?? 10 * 60_000 });
}

// ---------------------------------------------------------------------------
// Autosave

export interface AutosaverOptions {
  /** Debounce delay (default 800 ms). */
  delayMs?: number;
  /** Called when a save fails (e.g. StorageFullError – show a friendly toast). */
  onError?: (err: Error) => void;
  /** Called after each successful save. */
  onSaved?: (world: WorldSave) => void;
}

export interface Autosaver {
  /** Mark the world dirty; saves after `delayMs` of quiet. */
  schedule(): void;
  /** Save now if dirty and wait for any in-progress save. Never rejects. */
  flush(): Promise<void>;
  /** Stop listening; saves pending changes (best effort) first. */
  dispose(): void;
}

export function createAutosaver(getWorld: () => WorldSave, opts: AutosaverOptions = {}): Autosaver {
  const delayMs = opts.delayMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let disposed = false;

  const reportError = (err: unknown) => {
    const e = translateStorageError(err);
    if (opts.onError) {
      try {
        opts.onError(e);
      } catch {
        /* ignore */
      }
    } else {
      console.error("[wonderglobe] autosave failed", e);
    }
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Runs saves one at a time until nothing is dirty (coalescing bursts into one write).
  const saveLoop = async (): Promise<void> => {
    while (dirty) {
      dirty = false;
      let world: WorldSave;
      try {
        world = getWorld();
        await saveWorld(world);
      } catch (err) {
        reportError(err);
        return; // don't hot-loop on a persistent failure; next schedule() retries
      }
      try {
        opts.onSaved?.(world);
      } catch {
        /* ignore listener errors */
      }
    }
  };

  const run = (): Promise<void> => {
    if (saving) return saving;
    const p = saveLoop();
    saving = p;
    void p.finally(() => {
      if (saving === p) saving = null;
    });
    return p;
  };

  const schedule = () => {
    if (disposed) return;
    dirty = true;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  };

  const flush = async () => {
    clearTimer();
    // Wait for an in-progress save, then save anything that became dirty meanwhile.
    if (saving) await saving;
    if (dirty) await run();
  };

  const onPageHide = () => {
    void flush();
  };
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void flush();
  };

  const hasWindow = typeof window !== "undefined" && typeof window.addEventListener === "function";
  if (hasWindow) {
    window.addEventListener("pagehide", onPageHide);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  }

  const dispose = () => {
    if (disposed) return;
    if (hasWindow) {
      window.removeEventListener("pagehide", onPageHide);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    }
    void flush();
    disposed = true;
  };

  return { schedule, flush, dispose };
}
