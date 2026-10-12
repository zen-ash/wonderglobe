// Artwork storage (original picture + paper cut-out) and an object-URL cache.

import type { ArtworkRecord } from "@/core/types";
import { withDB, type StoredArtwork } from "./db";

async function toStored(rec: ArtworkRecord): Promise<StoredArtwork> {
  const [originalBytes, cutoutBytes] = await Promise.all([rec.original.arrayBuffer(), rec.cutout.arrayBuffer()]);
  const stored: StoredArtwork = {
    id: rec.id,
    contentHash: rec.contentHash,
    source: rec.source,
    meta: rec.meta,
    originalWidth: rec.originalWidth,
    originalHeight: rec.originalHeight,
    createdAt: rec.createdAt,
    originalBytes,
    originalType: rec.original.type || "image/png",
    cutoutBytes,
    cutoutType: rec.cutout.type || "image/png",
  };
  if (rec.sampleLabel !== undefined) stored.sampleLabel = rec.sampleLabel;
  return stored;
}

function fromStored(s: StoredArtwork): ArtworkRecord {
  const rec: ArtworkRecord = {
    id: s.id,
    contentHash: s.contentHash,
    source: s.source,
    original: new Blob([s.originalBytes], { type: s.originalType }),
    cutout: new Blob([s.cutoutBytes], { type: s.cutoutType }),
    meta: s.meta,
    originalWidth: s.originalWidth,
    originalHeight: s.originalHeight,
    createdAt: s.createdAt,
  };
  if (s.sampleLabel !== undefined) rec.sampleLabel = s.sampleLabel;
  return rec;
}

const FULL_MESSAGE = "There's no more room to keep new pictures. Remove a few creations, then try again!";

/** Save (insert or replace) an artwork. Throws StorageFullError when the disk quota is hit. */
export async function saveArtwork(rec: ArtworkRecord): Promise<void> {
  const stored = await toStored(rec);
  await withDB(async (db) => {
    await db.put("artworks", stored);
  }, FULL_MESSAGE);
  // Replaced bytes → cached URLs are stale.
  releaseArtworkUrls(rec.id);
}

export async function getArtwork(id: string): Promise<ArtworkRecord | null> {
  const s = await withDB((db) => db.get("artworks", id));
  return s ? fromStored(s) : null;
}

/** Same picture → same artwork: look up an existing artwork by content hash. */
export async function findArtworkByHash(hash: string): Promise<ArtworkRecord | null> {
  const s = await withDB((db) => db.getFromIndex("artworks", "contentHash", hash));
  return s ? fromStored(s) : null;
}

/** Cheap existence check (doesn't load the picture bytes). */
export async function hasArtwork(id: string): Promise<boolean> {
  const key = await withDB((db) => db.getKey("artworks", id));
  return key !== undefined;
}

export async function deleteArtwork(id: string): Promise<void> {
  await withDB((db) => db.delete("artworks", id));
  releaseArtworkUrls(id);
}

export async function listArtworkIds(): Promise<string[]> {
  return withDB((db) => db.getAllKeys("artworks"));
}

/**
 * Delete every artwork whose id is not in `referenced` (garbage collection after
 * removals). Pass ids referenced by BOTH worlds. Artworks newer than
 * `keepNewerThanMs` are kept (protects pictures whose creation hasn't been
 * autosaved yet). Returns the deleted ids.
 */
export async function deleteUnreferencedArtworks(
  referenced: Set<string>,
  opts: { keepNewerThanMs?: number; now?: number } = {},
): Promise<string[]> {
  const keepAfter = opts.keepNewerThanMs ? (opts.now ?? Date.now()) - opts.keepNewerThanMs : Infinity;
  const deleted = await withDB(async (db) => {
    const tx = db.transaction("artworks", "readwrite");
    const out: string[] = [];
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const v = cursor.value;
      if (!referenced.has(v.id) && !(v.createdAt > keepAfter)) {
        out.push(v.id);
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return out;
  });
  for (const id of deleted) releaseArtworkUrls(id);
  return deleted;
}

// ---------------------------------------------------------------------------
// Object URL cache

export interface ArtworkUrls {
  originalUrl: string;
  cutoutUrl: string;
}

const urlCache = new Map<string, ArtworkUrls>();
const inflight = new Map<string, Promise<ArtworkUrls | null>>();

function revoke(urls: ArtworkUrls): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  try {
    URL.revokeObjectURL(urls.originalUrl);
    URL.revokeObjectURL(urls.cutoutUrl);
  } catch {
    /* ignore */
  }
}

/**
 * Object URLs for an artwork's original and cut-out, created once per id and cached.
 * Returns null if the artwork doesn't exist.
 */
export function getArtworkUrls(id: string): Promise<ArtworkUrls | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const holder: { p?: Promise<ArtworkUrls | null> } = {};
  const p = (async (): Promise<ArtworkUrls | null> => {
    try {
      const rec = await getArtwork(id);
      if (!rec) return null;
      const urls: ArtworkUrls = {
        originalUrl: URL.createObjectURL(rec.original),
        cutoutUrl: URL.createObjectURL(rec.cutout),
      };
      if (inflight.get(id) !== holder.p) {
        // Released (or replaced) while loading – don't leak.
        revoke(urls);
        return null;
      }
      urlCache.set(id, urls);
      return urls;
    } finally {
      if (inflight.get(id) === holder.p) inflight.delete(id);
    }
  })();
  holder.p = p;
  inflight.set(id, p);
  return p;
}

/** Revoke and forget the cached object URLs for an artwork. */
export function releaseArtworkUrls(id: string): void {
  inflight.delete(id);
  const urls = urlCache.get(id);
  if (urls) {
    urlCache.delete(id);
    revoke(urls);
  }
}

/** Revoke every cached object URL (e.g. when switching worlds). */
export function releaseAllArtworkUrls(): void {
  inflight.clear();
  for (const urls of urlCache.values()) revoke(urls);
  urlCache.clear();
}
