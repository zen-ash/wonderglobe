// Portable world files (`.wonderglobe.json`): export a world with its pictures,
// and safely parse + import one (validation, dedupe by content hash, rollback).

import type { ArtworkRecord, WorldMode, WorldSave } from "@/core/types";
import { deleteArtwork, findArtworkByHash, getArtwork, hasArtwork, saveArtwork } from "./artworks";
import { StorageFullError, isQuotaError, translateStorageError, withDB } from "./db";
import { isPlainObject, referencedArtworkIds, repairWorld } from "./repair";
import {
  CUTOUT_IMAGE_TYPES,
  EXPORT_EXTENSION,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportFileEnvelopeSchema,
  ORIGINAL_IMAGE_TYPES,
  type ExportFile,
  type ExportedArtwork,
} from "./schema";
import { loadWorld } from "./worlds";

/** Largest world file we'll try to open. */
export const MAX_IMPORT_BYTES = 60 * 1024 * 1024;
/** Largest single decoded picture inside a world file. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Errors

export type ImportErrorCode =
  | "too-big"
  | "read-failed"
  | "not-json"
  | "not-wonderglobe"
  | "newer-version"
  | "damaged"
  | "bad-picture";

const IMPORT_MESSAGES: Record<ImportErrorCode, string> = {
  "too-big": "This world file is too big to open.",
  "read-failed": "We couldn't read that file. Please try again.",
  "not-json": "This file isn't a Wonderglobe world.",
  "not-wonderglobe": "This file isn't a Wonderglobe world.",
  "newer-version": "This world was made with a newer Wonderglobe. Ask a grown-up to refresh the page and try again.",
  damaged: "This world file is a bit broken, so we can't open it.",
  "bad-picture": "One of the pictures in this world file is broken, so we can't open it.",
};

/** Error with a child-friendly `message`; `detail` holds the technical reason. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly detail?: string;
  constructor(code: ImportErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(IMPORT_MESSAGES[code], options);
    this.name = "ImportError";
    this.code = code;
    this.detail = detail;
  }
}

export class ExportError extends Error {
  constructor(message = "There's no world to save yet. Make something first!") {
    super(message);
    this.name = "ExportError";
  }
}

// ---------------------------------------------------------------------------
// Base64 / data URLs (no fetch / FileReader – works in Node tests too)

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Identify an image by its magic bytes. */
export function sniffImageType(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return "image/webp";
  return null;
}

export async function blobToDataUrl(blob: Blob, type?: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${type ?? blob.type};base64,${bytesToBase64(bytes)}`;
}

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/\s]*={0,2}\s*)$/i;

/**
 * Decode a base64 image data URL into a Blob. Throws ImportError("bad-picture")
 * unless it is base64, of an allowed image type, and its bytes really are that type.
 */
export function dataUrlToBlob(dataUrl: string, allowed: readonly string[]): Blob {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new ImportError("bad-picture", "not a base64 data URL");
  const mime = m[1].toLowerCase();
  if (!allowed.includes(mime)) throw new ImportError("bad-picture", `type ${mime} not allowed`);
  const payload = m[2].replace(/\s+/g, "");
  if (payload.length === 0 || payload.length % 4 !== 0) throw new ImportError("bad-picture", "bad base64 length");
  if ((payload.length / 4) * 3 > MAX_IMAGE_BYTES + 3) throw new ImportError("bad-picture", "picture too large");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(payload);
  } catch (err) {
    throw new ImportError("bad-picture", "invalid base64", { cause: err });
  }
  if (sniffImageType(bytes) !== mime) throw new ImportError("bad-picture", `bytes are not ${mime}`);
  return new Blob([bytes], { type: mime });
}

// ---------------------------------------------------------------------------
// Export

/** Suggested download name, e.g. "wonderglobe-paper-2026-10-11.wonderglobe.json". */
export function exportFileName(mode: WorldMode, date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `wonderglobe-${mode}-${d}${EXPORT_EXTENSION}`;
}

async function imageTypeOf(blob: Blob, allowed: readonly string[]): Promise<string | null> {
  if (allowed.includes(blob.type)) {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (sniffImageType(head) === blob.type) return blob.type;
  }
  const sniffed = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  return sniffed && allowed.includes(sniffed) ? sniffed : null;
}

/** Export the saved world for `mode` (plus every picture it uses) as a JSON Blob. */
export async function exportWorld(mode: WorldMode): Promise<Blob> {
  const world = await loadWorld(mode);
  if (!world) throw new ExportError();

  const artworks: ExportedArtwork[] = [];
  const usable = new Set<string>();
  for (const id of referencedArtworkIds(world)) {
    const rec = await getArtwork(id);
    if (!rec) continue;
    const originalType = await imageTypeOf(rec.original, ORIGINAL_IMAGE_TYPES);
    const cutoutType = await imageTypeOf(rec.cutout, CUTOUT_IMAGE_TYPES);
    if (!originalType || !cutoutType) {
      console.warn(`[wonderglobe] export: skipping artwork ${id} with unsupported image type`);
      continue;
    }
    const entry: ExportedArtwork = {
      id: rec.id,
      contentHash: rec.contentHash,
      source: rec.source,
      meta: rec.meta,
      originalWidth: rec.originalWidth,
      originalHeight: rec.originalHeight,
      createdAt: rec.createdAt,
      original: await blobToDataUrl(rec.original, originalType),
      cutout: await blobToDataUrl(rec.cutout, cutoutType),
    };
    if (rec.sampleLabel !== undefined) entry.sampleLabel = rec.sampleLabel;
    artworks.push(entry);
    usable.add(id);
  }

  // Keep the file self-consistent: leave out things whose picture is missing.
  const exportedWorld: WorldSave = {
    ...world,
    creations: world.creations.filter((c) => usable.has(c.artworkId)),
    easels: world.easels.filter((e) => usable.has(e.artworkId)),
  };
  if (exportedWorld.playerArtworkId && !usable.has(exportedWorld.playerArtworkId)) exportedWorld.playerArtworkId = null;

  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    mode,
    world: exportedWorld,
    artworks,
  };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

// ---------------------------------------------------------------------------
// Parse

export interface ParsedImport {
  mode: WorldMode;
  world: WorldSave;
  artworks: ArtworkRecord[];
  /** Friendly notes about things that were left out or fixed. */
  warnings: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Read and validate a world file. Throws ImportError with a child-friendly message. */
export async function parseWorldFile(file: Blob): Promise<ParsedImport> {
  if (!file || typeof (file as Blob).size !== "number" || typeof (file as Blob).text !== "function") {
    throw new ImportError("read-failed", "not a Blob");
  }
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError("too-big", `${file.size} bytes`);
  if (file.size === 0) throw new ImportError("not-wonderglobe", "empty file");

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new ImportError("read-failed", "could not read file", { cause: err });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ImportError("not-json", "invalid JSON", { cause: err });
  }

  if (!isPlainObject(json) || json.format !== EXPORT_FORMAT) throw new ImportError("not-wonderglobe", "wrong format tag");
  if (typeof json.version === "number" && json.version > EXPORT_VERSION) {
    throw new ImportError("newer-version", `version ${json.version}`);
  }
  const env = ExportFileEnvelopeSchema.safeParse(json);
  if (!env.success) throw new ImportError("damaged", env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5).join("; "));
  const envelope = env.data;

  const repaired = repairWorld(envelope.world, envelope.mode);
  if (!repaired) throw new ImportError("damaged", "world is not usable");
  const warnings: string[] = [];
  const { log } = repaired;
  if (log.droppedCreations) warnings.push(`${plural(log.droppedCreations, "creation was", "creations were")} broken and left out.`);
  if (log.droppedEasels) warnings.push(`${plural(log.droppedEasels, "easel was", "easels were")} broken and left out.`);
  let world = repaired.world;

  // Artworks in the file (first wins on duplicate ids).
  const byId = new Map<string, ExportedArtwork>();
  for (const a of envelope.artworks) if (!byId.has(a.id)) byId.set(a.id, a);

  // Drop references to pictures that aren't in the file.
  const before = { c: world.creations.length, e: world.easels.length };
  world = {
    ...world,
    creations: world.creations.filter((c) => byId.has(c.artworkId)),
    easels: world.easels.filter((e) => byId.has(e.artworkId)),
  };
  // The player's own drawing: if its picture isn't in the file, use the default look.
  if (world.playerArtworkId && !byId.has(world.playerArtworkId)) world.playerArtworkId = null;
  const orphanC = before.c - world.creations.length;
  const orphanE = before.e - world.easels.length;
  if (orphanC) warnings.push(`${plural(orphanC, "creation was", "creations were")} missing a picture and left out.`);
  if (orphanE) warnings.push(`${plural(orphanE, "easel was", "easels were")} missing a picture and left out.`);

  // Decode only the pictures the world actually uses (but every one must be valid).
  const used = referencedArtworkIds(world);
  const artworks: ArtworkRecord[] = [];
  for (const id of used) {
    const a = byId.get(id)!;
    const rec: ArtworkRecord = {
      id: a.id,
      contentHash: a.contentHash,
      source: a.source,
      original: dataUrlToBlob(a.original, ORIGINAL_IMAGE_TYPES),
      cutout: dataUrlToBlob(a.cutout, CUTOUT_IMAGE_TYPES),
      meta: a.meta,
      originalWidth: a.originalWidth,
      originalHeight: a.originalHeight,
      createdAt: a.createdAt,
    };
    if (a.sampleLabel !== undefined && a.source === "sample") rec.sampleLabel = a.sampleLabel;
    artworks.push(rec);
  }
  const unused = byId.size - used.size;
  if (unused > 0) console.info(`[wonderglobe] import: ignoring ${unused} unused picture(s)`);

  return { mode: envelope.mode, world, artworks, warnings };
}

// ---------------------------------------------------------------------------
// Import

function newArtworkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `art-${crypto.randomUUID()}`;
  return `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const IMPORT_FULL_MESSAGE =
  "There isn't enough room to bring in this world. Remove some creations or pictures, then try again!";

/**
 * Write a parsed world into storage, replacing the world for `targetMode`
 * (default: the file's mode). Pictures already stored (same content hash) are
 * reused and ids remapped. Pictures are written first, then the world; if
 * anything fails the newly added pictures are removed again. Quota problems
 * throw StorageFullError. Old pictures of the replaced world are NOT deleted –
 * call collectUnusedArtworks() afterwards if wanted.
 */
export async function importWorld(parsed: ParsedImport, opts: { targetMode?: WorldMode } = {}): Promise<WorldSave> {
  const mode = opts.targetMode ?? parsed.mode;
  const idMap = new Map<string, string>();
  const added: string[] = [];

  try {
    for (const art of parsed.artworks) {
      if (idMap.has(art.id)) continue;
      const existing = await findArtworkByHash(art.contentHash);
      if (existing) {
        idMap.set(art.id, existing.id);
        continue;
      }
      // Same id but different picture already here → give the new one a fresh id.
      let id = art.id;
      while (await hasArtwork(id)) id = newArtworkId();
      await saveArtwork({ ...art, id });
      added.push(id);
      idMap.set(art.id, id);
    }

    const remap = (id: string) => idMap.get(id) ?? id;
    const world: WorldSave = {
      ...parsed.world,
      version: 1,
      mode,
      updatedAt: Date.now(),
      creations: parsed.world.creations.map((c) => ({ ...c, artworkId: remap(c.artworkId) })),
      easels: parsed.world.easels.map((e) => ({ ...e, artworkId: remap(e.artworkId) })),
    };
    if (parsed.world.playerArtworkId) world.playerArtworkId = remap(parsed.world.playerArtworkId);
    await withDB(async (db) => {
      await db.put("worlds", world);
    });
    return world;
  } catch (err) {
    for (const id of added) {
      try {
        await deleteArtwork(id);
      } catch {
        /* best effort */
      }
    }
    if (isQuotaError(err)) throw new StorageFullError(IMPORT_FULL_MESSAGE, { cause: err });
    throw translateStorageError(err);
  }
}
