// Glue between drawing processing, storage and the "bring it to life" flow.
// A processed picture is saved immediately, so nothing a child made is lost
// even if recognition fails or the page reloads mid-way.

import type { ArtworkSource, WorldMode } from "@/core/types";
import type { ProcessedArtwork } from "@/drawing/client";
import {
  saveArtwork,
  findArtworkByHash,
  getArtwork,
  getArtworkUrls,
  loadWorld,
  deleteUnreferencedArtworks,
  referencedArtworkIds,
} from "@/persistence";
import { useGame, newId, type PendingArtwork } from "@/state/store";

const PENDING_KEY = (mode: WorldMode) => `wonderglobe:pending:${mode}`;

interface StoredPending {
  artworkId: string;
  source: ArtworkSource;
  suggestedKind?: string;
  sampleLabel?: string;
}

/** Save a processed picture (deduplicated by its pixel hash) and return the pending record. */
export async function commitArtwork(
  processed: ProcessedArtwork,
  source: ArtworkSource,
  extra: { sampleLabel?: string; suggestedKind?: string } = {},
): Promise<PendingArtwork> {
  let id: string;
  const existing = await findArtworkByHash(processed.contentHash);
  if (existing) {
    id = existing.id;
  } else {
    id = newId("art");
    await saveArtwork({
      id,
      contentHash: processed.contentHash,
      source,
      sampleLabel: source === "sample" ? extra.sampleLabel : undefined,
      original: processed.original,
      cutout: processed.cutout,
      meta: processed.meta,
      originalWidth: processed.originalWidth,
      originalHeight: processed.originalHeight,
      createdAt: Date.now(),
    });
  }
  // Use the stored copy's URLs (stable, cached) and free the temporary ones.
  const urls = await getArtworkUrls(id);
  URL.revokeObjectURL(processed.cutoutUrl);
  URL.revokeObjectURL(processed.originalUrl);
  const pending: PendingArtwork = {
    artworkId: id,
    originalUrl: urls?.originalUrl ?? "",
    cutoutUrl: urls?.cutoutUrl ?? "",
    meta: existing?.meta ?? processed.meta,
    source,
    suggestedKind: extra.suggestedKind,
    sampleLabel: extra.sampleLabel,
  };
  rememberPending(pending);
  return pending;
}

export function rememberPending(p: PendingArtwork | null) {
  const mode = useGame.getState().mode;
  if (!mode) return;
  try {
    if (!p) localStorage.removeItem(PENDING_KEY(mode));
    else {
      const s: StoredPending = { artworkId: p.artworkId, source: p.source, suggestedKind: p.suggestedKind, sampleLabel: p.sampleLabel };
      localStorage.setItem(PENDING_KEY(mode), JSON.stringify(s));
    }
  } catch {
    /* storage unavailable: the drawing still lives in IndexedDB */
  }
}

function readPending(mode: WorldMode): StoredPending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY(mode));
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPending;
    return typeof v?.artworkId === "string" ? v : null;
  } catch {
    return null;
  }
}

/** After a reload, bring back a drawing that was waiting to become something. */
export async function restorePending(mode: WorldMode): Promise<PendingArtwork | null> {
  const s = readPending(mode);
  if (!s) return null;
  const rec = await getArtwork(s.artworkId);
  const urls = rec ? await getArtworkUrls(s.artworkId) : null;
  if (!rec || !urls) {
    try {
      localStorage.removeItem(PENDING_KEY(mode));
    } catch {}
    return null;
  }
  return { artworkId: rec.id, originalUrl: urls.originalUrl, cutoutUrl: urls.cutoutUrl, meta: rec.meta, source: s.source, suggestedKind: s.suggestedKind, sampleLabel: s.sampleLabel };
}

/** Delete pictures that no world and no waiting drawing uses (keeps recent ones). */
export async function collectGarbage(): Promise<void> {
  const state = useGame.getState();
  await state.flushSave();
  const refs = new Set<string>();
  for (const mode of ["paper", "gallery"] as WorldMode[]) {
    const w = mode === state.mode && state.world ? state.world : await loadWorld(mode).catch(() => null);
    if (w) referencedArtworkIds(w).forEach((id) => refs.add(id));
    const p = readPending(mode);
    if (p) refs.add(p.artworkId);
  }
  if (state.pending) refs.add(state.pending.artworkId);
  await deleteUnreferencedArtworks(refs, { keepNewerThanMs: 10 * 60 * 1000 });
}
