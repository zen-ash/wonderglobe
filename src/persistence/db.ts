// IndexedDB access for Wonderglobe: one lazily opened database with two stores.
//
//   artworks (keyPath "id", index "contentHash") – pictures + paper cut-outs
//   worlds   (keyPath "mode")                    – one WorldSave per world mode
//
// Artwork bytes are stored as ArrayBuffer + mime type (not Blob) because Blob
// support in IndexedDB has historically been unreliable (older Safari, some
// private modes). The public API in ./artworks.ts always hands out Blobs.

import { wrap, type DBSchema, type IDBPDatabase } from "idb";
import type { ArtworkSource, CutoutMeta, WorldSave } from "@/core/types";

export const DB_NAME = "wonderglobe";
export const DB_VERSION = 1;

/** How an artwork is actually kept on disk. */
export interface StoredArtwork {
  id: string;
  contentHash: string;
  source: ArtworkSource;
  sampleLabel?: string;
  meta: CutoutMeta;
  originalWidth: number;
  originalHeight: number;
  createdAt: number;
  originalBytes: ArrayBuffer;
  originalType: string;
  cutoutBytes: ArrayBuffer;
  cutoutType: string;
}

export interface WonderglobeDB extends DBSchema {
  artworks: {
    key: string;
    value: StoredArtwork;
    indexes: { contentHash: string };
  };
  worlds: {
    key: string;
    value: WorldSave;
  };
}

export type WonderDB = IDBPDatabase<WonderglobeDB>;

// ---------------------------------------------------------------------------
// Errors

/** IndexedDB can't be used at all (private browsing, disabled storage, very old browser). */
export class StorageUnavailableError extends Error {
  readonly friendlyMessage =
    "This browser can't keep your world safe right now (maybe it's in private mode). You can still play, but your world won't be saved.";
  constructor(message = "IndexedDB is unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

/** The browser's storage space for this site is full. */
export class StorageFullError extends Error {
  readonly friendlyMessage: string;
  constructor(
    friendlyMessage = "Your backpack of pictures is full! Remove a few creations to make room for new ones.",
    options?: { cause?: unknown },
  ) {
    super(friendlyMessage, options);
    this.name = "StorageFullError";
    this.friendlyMessage = friendlyMessage;
  }
}

const QUOTA_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED", "NS_ERROR_FILE_NO_DEVICE_SPACE"]);

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; inner?: unknown; cause?: unknown };
  if (err instanceof StorageFullError) return true;
  if (typeof e.name === "string" && QUOTA_NAMES.has(e.name)) return true;
  // Legacy DOMException codes: 22 (QUOTA_EXCEEDED_ERR), 1014 (Firefox).
  if (e.code === 22 || e.code === 1014) return true;
  if (typeof e.message === "string" && /quota/i.test(e.message)) return true;
  if (e.cause && e.cause !== err) return isQuotaError(e.cause);
  return false;
}

/** Convert low-level storage errors into our typed errors (quota → StorageFullError). */
export function translateStorageError(err: unknown, friendlyFullMessage?: string): Error {
  if (err instanceof StorageFullError || err instanceof StorageUnavailableError) return err;
  if (isQuotaError(err)) return new StorageFullError(friendlyFullMessage, { cause: err });
  if (err instanceof Error) return err;
  // DOMException in some environments is not instanceof Error.
  if (err && typeof err === "object" && "name" in err) {
    const e = err as { name: string; message?: string };
    const wrapped = new Error(e.message || e.name, { cause: err });
    wrapped.name = e.name;
    return wrapped;
  }
  return new Error(String(err));
}

// ---------------------------------------------------------------------------
// Singleton

let injectedFactory: IDBFactory | null = null;
let dbPromise: Promise<WonderDB> | null = null;
let openDb: WonderDB | null = null;

const OPEN_TIMEOUT_MS = 10_000;

function resolveFactory(): IDBFactory | null {
  if (injectedFactory) return injectedFactory;
  try {
    const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    return f ?? null;
  } catch {
    // Some sandboxed iframes throw on access.
    return null;
  }
}

/**
 * Use a specific IDBFactory (e.g. `new IDBFactory()` from fake-indexeddb in tests).
 * Pass null to go back to the global `indexedDB`. Closes any open connection.
 */
export function setIDBFactory(factory: IDBFactory | null): void {
  closeDB();
  injectedFactory = factory;
}

/** Close the connection (next call to getDB reopens). */
export function closeDB(): void {
  if (openDb) {
    try {
      openDb.close();
    } catch {
      /* ignore */
    }
  }
  openDb = null;
  dbPromise = null;
}

function upgrade(db: WonderDB, oldVersion: number): void {
  if (oldVersion < 1) {
    const artworks = db.createObjectStore("artworks", { keyPath: "id" });
    artworks.createIndex("contentHash", "contentHash", { unique: false });
    db.createObjectStore("worlds", { keyPath: "mode" });
  }
}

function openWith(factory: IDBFactory): Promise<WonderDB> {
  return new Promise<WonderDB>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new StorageUnavailableError("Opening IndexedDB timed out"));
    }, OPEN_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      reject(new StorageUnavailableError("indexedDB.open threw", { cause: err }));
      return;
    }

    request.addEventListener("upgradeneeded", (event) => {
      try {
        upgrade(wrap(request.result) as unknown as WonderDB, event.oldVersion);
      } catch (err) {
        try {
          request.transaction?.abort();
        } catch {
          /* ignore */
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(translateStorageError(err));
        }
      }
    });

    (wrap(request) as unknown as Promise<WonderDB>).then(
      (db) => {
        clearTimeout(timer);
        if (settled) {
          // Timed out earlier – don't leak the connection.
          db.close();
          return;
        }
        settled = true;
        const raw = db as unknown as IDBDatabase;
        // Another tab wants to upgrade: let it, we'll reopen lazily.
        raw.addEventListener("versionchange", () => {
          if (openDb === db) closeDB();
          else db.close();
        });
        // Browser closed the connection unexpectedly (e.g. storage cleared).
        raw.addEventListener("close", () => {
          if (openDb === db) {
            openDb = null;
            dbPromise = null;
          }
        });
        resolve(db);
      },
      (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (isQuotaError(err)) reject(translateStorageError(err));
        else reject(new StorageUnavailableError("Could not open IndexedDB", { cause: err }));
      },
    );
  });
}

/** Get the (lazily opened) database. Throws StorageUnavailableError if IndexedDB can't be used. */
export function getDB(): Promise<WonderDB> {
  if (dbPromise) return dbPromise;
  const factory = resolveFactory();
  if (!factory) return Promise.reject(new StorageUnavailableError());
  const p = openWith(factory).then((db) => {
    if (dbPromise === p) openDb = db;
    return db;
  });
  dbPromise = p;
  // Don't cache failures – a later attempt may succeed.
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

/** Run an operation against the database, translating quota errors into StorageFullError. */
export async function withDB<T>(fn: (db: WonderDB) => Promise<T>, friendlyFullMessage?: string): Promise<T> {
  const db = await getDB();
  try {
    return await fn(db);
  } catch (err) {
    throw translateStorageError(err, friendlyFullMessage);
  }
}

/** True if IndexedDB can be opened here (false in e.g. some private modes). Never throws. */
export async function isStorageAvailable(): Promise<boolean> {
  try {
    await getDB();
    return true;
  } catch {
    return false;
  }
}
