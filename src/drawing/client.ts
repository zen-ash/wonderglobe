// Browser-side API for turning drawings and uploads into paper cut-outs.
//
// Heavy pixel work runs in a single, lazily created Web Worker. If a worker
// can't be created (or fails to load), the same pure functions run on the
// main thread, with yields before and after so a spinner can paint.
//
// Only call these functions in the browser. Nothing here ever looks at a
// file's name or MIME type: pictures are identified purely by their pixels.

import type { CutoutMeta } from "@/core/types";
import { hashPixels } from "./hash";
import type { CutoutResult, UploadAnalysis, UploadSettings } from "./process";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import {
  createImage,
  cropImage,
  downscaleToFit,
  DrawingError,
  expandRect,
  resolveCrop,
  type RGBAImage,
} from "./raster";

export type { RGBAImage, Rect } from "./raster";
export type { CutoutResult, UploadAnalysis, UploadIssue, UploadSettings } from "./process";

// ---------------------------------------------------------------------------
// Public types & constants
// ---------------------------------------------------------------------------

export interface ProcessedArtwork {
  /** PNG of the original: board ink (+ margin) or the cropped upload pixels. */
  original: Blob;
  /** PNG of the paper cut-out. */
  cutout: Blob;
  meta: CutoutMeta;
  /** Hex SHA-256 of the `original` pixels (width, height, RGBA) — never of a filename. */
  contentHash: string;
  originalWidth: number;
  originalHeight: number;
  /** Object URLs for immediate display. The caller revokes them. */
  cutoutUrl: string;
  originalUrl: string;
}

export interface UploadSession {
  /** Decoded picture, deterministically downscaled to ≤ 1024 px longest side. */
  image: RGBAImage;
  /**
   * Hex SHA-256 of `image` (the decoded, downscaled pixels; width, height,
   * RGBA). Filename-independent. Crop coordinates in UploadSettings are in
   * `image` pixels too.
   */
  contentHash: string;
  /** Object URL of `image` as PNG. The caller revokes it. */
  previewUrl: string;
  /**
   * Runs background removal with `settings`. `maskPreviewUrl` shows the
   * cropped picture with removed areas faded onto a checkerboard and the cut
   * line in pink (for the correction UI). The caller revokes all URLs.
   */
  run(settings: UploadSettings): Promise<{
    analysis: UploadAnalysis;
    artwork: ProcessedArtwork | null;
    maskPreviewUrl: string;
  }>;
}

export const DEFAULT_UPLOAD_SETTINGS: UploadSettings = { crop: null, tolerance: 35, mode: "auto" };

/** Longest side of a decoded upload. */
export const MAX_UPLOAD_SIDE = 1024;

const TIMEOUT_MS = 20_000;
const TIMEOUT_MESSAGE = "That took too long – let's try again!";
const NOT_A_PICTURE = "That file doesn't look like a picture.";
const FALLBACK_ERROR = "Oops, the scissors slipped! Please try again.";
/** Pictures larger than this are resized by the browser while decoding. */
const MAX_DECODE_SIDE = 4096;

// ---------------------------------------------------------------------------
// Worker plumbing
// ---------------------------------------------------------------------------

type Job = { type: "board"; image: RGBAImage } | { type: "upload"; image: RGBAImage; settings: UploadSettings };

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Thrown internally when the worker can't be used; triggers the fallback. */
class WorkerUnavailable extends Error {}

/** undefined = not tried yet, null = unavailable (use the main thread). */
let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();
let nextId = 1;

function rejectAll(error: () => Error): void {
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(error());
  }
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return (worker = null);
  try {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      clearTimeout(job.timer);
      job.resolve(event.data);
    };
    const broken = (event: Event) => {
      event.preventDefault();
      console.warn("[drawing] worker failed; processing on the main thread instead");
      w.terminate();
      worker = null;
      rejectAll(() => new WorkerUnavailable());
    };
    w.onerror = broken;
    w.onmessageerror = broken;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function postToWorker(w: Worker, job: Job): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      // A stuck worker is replaced on the next call.
      w.terminate();
      if (worker === w) worker = undefined;
      rejectAll(() => new Error(TIMEOUT_MESSAGE));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    // The image is copied (structured clone) so callers keep their pixels.
    w.postMessage({ ...job, id } as WorkerRequest);
  });
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function runOnMainThread(job: Job): Promise<WorkerResponse> {
  await yieldToUI();
  const { processBoardDrawing, processUpload } = await import("./process");
  let response: WorkerResponse;
  try {
    if (job.type === "board") {
      response = { id: 0, ok: true, type: "board", result: processBoardDrawing(job.image) };
    } else {
      const { analysis, result } = processUpload(job.image, job.settings);
      response = { id: 0, ok: true, type: "upload", analysis, result };
    }
  } catch (err) {
    if (err instanceof DrawingError) response = { id: 0, ok: false, error: err.message, code: err.code };
    else {
      console.error("[drawing]", err);
      response = { id: 0, ok: false, error: FALLBACK_ERROR };
    }
  }
  await yieldToUI();
  return response;
}

async function runJob(job: Job): Promise<WorkerResponse> {
  const w = getWorker();
  if (w) {
    try {
      return await postToWorker(w, job);
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
    }
  }
  return runOnMainThread(job);
}

function unwrap(response: WorkerResponse): Extract<WorkerResponse, { ok: true }> {
  if (response.ok) return response;
  if (response.code) throw new DrawingError(response.code as DrawingError["code"], response.error);
  throw new Error(response.error);
}

// ---------------------------------------------------------------------------
// Canvas / bitmap helpers
// ---------------------------------------------------------------------------

/** Encodes an RGBA image as a PNG blob. */
export async function rgbaToBlob(img: RGBAImage): Promise<Blob> {
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.putImageData(data, 0, 0);
      return canvas.convertToBlob({ type: "image/png" });
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't save the picture.");
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the picture."))), "image/png"),
  );
}

/** Reads the pixels of any drawable (canvas, bitmap) via a 2D canvas. */
function readPixels(source: CanvasImageSource, width: number, height: number): RGBAImage {
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) throw new Error("Couldn't read the picture.");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/** Reads a board canvas' pixels directly when it is a 2D canvas. */
function readCanvas(canvas: HTMLCanvasElement): RGBAImage {
  const { width, height } = canvas;
  if (!(width > 0 && height > 0)) throw new DrawingError("empty-drawing", "Draw something first!");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  return readPixels(canvas, width, height); // e.g. a WebGL canvas
}

async function toArtwork(original: RGBAImage, cutout: RGBAImage, meta: CutoutMeta): Promise<ProcessedArtwork> {
  const [originalBlob, cutoutBlob, contentHash] = await Promise.all([
    rgbaToBlob(original),
    rgbaToBlob(cutout),
    hashPixels(original),
  ]);
  return {
    original: originalBlob,
    cutout: cutoutBlob,
    meta,
    contentHash,
    originalWidth: original.width,
    originalHeight: original.height,
    cutoutUrl: URL.createObjectURL(cutoutBlob),
    originalUrl: URL.createObjectURL(originalBlob),
  };
}

/**
 * Correction-UI preview: kept pixels as they are (over a checkerboard where
 * transparent), removed pixels faded into the checkerboard, and a 2 px pink
 * line along the inside of the cut.
 */
function buildMaskPreview(img: RGBAImage, mask: Uint8Array): RGBAImage {
  const { width: w, height: h } = img;
  const out = createImage(w, h);
  const removedNear = (x: number, y: number) => {
    for (let d = 1; d <= 2; d++) {
      if (x - d >= 0 && !mask[y * w + x - d]) return true;
      if (x + d < w && !mask[y * w + x + d]) return true;
      if (y - d >= 0 && !mask[(y - d) * w + x]) return true;
      if (y + d < h && !mask[(y + d) * w + x]) return true;
    }
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const check = ((x >> 3) + (y >> 3)) & 1 ? 255 : 222;
      const a = img.data[p + 3] / 255;
      if (mask[i] && removedNear(x, y)) {
        out.data.set([255, 79, 139, 255], p);
        continue;
      }
      const keep = mask[i] ? 1 : 0.3;
      for (let c = 0; c < 3; c++) {
        const base = img.data[p + c] * a + check * (1 - a);
        out.data[p + c] = base * keep + check * (1 - keep);
      }
      out.data[p + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Turns the drawing on a board canvas (transparent where nothing is drawn)
 * into a cut-out. Throws a DrawingError("Draw something first!") when empty.
 */
export async function processBoardCanvas(canvas: HTMLCanvasElement): Promise<ProcessedArtwork> {
  const board = readCanvas(canvas);
  const response = unwrap(await runJob({ type: "board", image: board }));
  if (response.type !== "board") throw new Error(FALLBACK_ERROR);
  const result: CutoutResult = response.result;
  // Original = the board drawing cropped to its (kept) ink plus a margin.
  const margin = Math.max(8, Math.round(Math.max(result.inkBounds.w, result.inkBounds.h) * 0.04));
  const original = cropImage(board, expandRect(result.inkBounds, margin, board.width, board.height));
  return toArtwork(original, result.cutout, result.meta);
}

/**
 * Decodes an uploaded picture (PNG, JPEG, WebP, GIF first frame, BMP — whatever
 * `createImageBitmap` can read) into an UploadSession. Throws
 * Error("That file doesn't look like a picture.") otherwise.
 */
export async function openUpload(file: Blob): Promise<UploadSession> {
  if (!(file instanceof Blob) || file.size === 0) throw new Error(NOT_A_PICTURE);
  let full: RGBAImage;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (!(width > 0 && height > 0)) throw new Error(NOT_A_PICTURE);
    if (Math.max(width, height) > MAX_DECODE_SIDE) {
      // Keep memory sane for huge photos; our own resampler finishes the job.
      const s = MAX_DECODE_SIDE / Math.max(width, height);
      const rw = Math.max(1, Math.round(width * s));
      const rh = Math.max(1, Math.round(height * s));
      bitmap.close();
      bitmap = await createImageBitmap(file, { resizeWidth: rw, resizeHeight: rh, resizeQuality: "high" });
    }
    full = readPixels(bitmap, bitmap.width, bitmap.height);
  } catch {
    throw new Error(NOT_A_PICTURE);
  } finally {
    bitmap?.close();
  }

  const image = downscaleToFit(full, MAX_UPLOAD_SIDE);
  const [contentHash, previewBlob] = await Promise.all([hashPixels(image), rgbaToBlob(image)]);

  return {
    image,
    contentHash,
    previewUrl: URL.createObjectURL(previewBlob),
    async run(settings: UploadSettings) {
      const response = unwrap(await runJob({ type: "upload", image, settings }));
      if (response.type !== "upload") throw new Error(FALLBACK_ERROR);
      const { analysis, result } = response;
      const cropped = cropImage(image, resolveCrop(settings.crop, image));
      const [maskBlob, artwork] = await Promise.all([
        rgbaToBlob(buildMaskPreview(cropped, analysis.mask)),
        result ? toArtwork(cropped, result.cutout, result.meta) : Promise.resolve(null),
      ]);
      return { analysis, artwork, maskPreviewUrl: URL.createObjectURL(maskBlob) };
    },
  };
}
