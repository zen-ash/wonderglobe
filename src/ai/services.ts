// Browser-side client for the optional AI routes. Holds no secrets: it only
// talks to this app's own /api/* endpoints. Every function resolves (never
// rejects) with an honest status so the game can fall back to offline paths.

import { NO_SERVICES, type Behavior, type Facing, type ServiceStatus } from "@/core/types";
import {
  ChatResponseSchema,
  RecognizeResponseSchema,
  ServiceStatusSchema,
  TranscribeResponseSchema,
  type ChatRequest,
  type FailReason,
} from "./schemas";

export type { ChatRequest, ChatCharacter, ChatTurn } from "./schemas";

export interface RecognitionResult {
  kind: string;
  name: string;
  facing: Facing;
  behavior: Behavior;
  confidence: number;
  description?: string;
}

export type ServiceFailure = { status: "unavailable" | "timeout" | "failed" };
export type RecognitionOutcome = { status: "ok"; result: RecognitionResult; uncertain: boolean } | ServiceFailure;
export type ChatOutcome = { status: "ok"; reply: string } | ServiceFailure;
export type TranscriptionOutcome = { status: "ok"; text: string } | ServiceFailure;

/** Below this, the UI should treat the recognition as a guess and ask the player. */
export const UNCERTAIN_CONFIDENCE = 0.55;

// Client timeouts sit slightly above the server's provider timeouts.
const STATUS_TIMEOUT_MS = 5_000;
const RECOGNIZE_TIMEOUT_MS = 18_000;
const CHAT_TIMEOUT_MS = 14_500;
const TRANSCRIBE_TIMEOUT_MS = 18_000;

const MAX_RECOGNITION_SIDE = 384;
const MAX_IMAGE_BYTES = 590 * 1024;
const PNG_PREFERRED_BYTES = 140 * 1024;

// ---------------------------------------------------------------- plumbing

interface Linked {
  signal: AbortSignal;
  timedOut(): boolean;
  done(): void;
}

function linkSignal(ms: number, parent?: AbortSignal): Linked {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const onAbort = () => ctrl.abort();
  if (parent) {
    if (parent.aborted) ctrl.abort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function fromReason(reason: FailReason): ServiceFailure {
  if (reason === "unavailable") return { status: "unavailable" };
  if (reason === "timeout") return { status: "timeout" };
  return { status: "failed" };
}

/** POST and parse JSON; maps network/timeout/shape problems to a ServiceFailure. */
async function postJson(
  url: string,
  init: { body: BodyInit; headers?: Record<string, string> },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: true; json: unknown } | { ok: false; failure: ServiceFailure }> {
  const link = linkSignal(timeoutMs, signal);
  try {
    const res = await fetch(url, { method: "POST", body: init.body, headers: init.headers, signal: link.signal });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, failure: { status: res.status === 503 ? "unavailable" : "failed" } };
    }
    return { ok: true, json };
  } catch {
    if (link.timedOut()) return { ok: false, failure: { status: "timeout" } };
    return { ok: false, failure: { status: "failed" } };
  } finally {
    link.done();
  }
}

// ---------------------------------------------------------------- status

let statusPromise: Promise<ServiceStatus> | null = null;
let lastStatus: ServiceStatus = { ...NO_SERVICES };
let statusFetchedAt = 0;
const STATUS_FAILURE_RETRY_MS = 30_000;

/** Which optional services the server offers. Cached; falls back to NO_SERVICES on error. */
export function fetchServiceStatus(opts: { refresh?: boolean } = {}): Promise<ServiceStatus> {
  const stale = statusPromise === null || opts.refresh;
  if (!stale && statusPromise) return statusPromise;
  statusFetchedAt = Date.now();
  statusPromise = (async () => {
    const link = linkSignal(STATUS_TIMEOUT_MS);
    try {
      const res = await fetch("/api/status", { cache: "no-store", signal: link.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = ServiceStatusSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("bad status shape");
      lastStatus = parsed.data;
      return parsed.data;
    } catch {
      // Allow a retry later instead of caching the failure forever.
      const failedAt = statusFetchedAt;
      setTimeout(() => {
        if (statusFetchedAt === failedAt) statusPromise = null;
      }, STATUS_FAILURE_RETRY_MS);
      lastStatus = { ...NO_SERVICES };
      return { ...NO_SERVICES };
    } finally {
      link.done();
    }
  })();
  return statusPromise;
}

/** Synchronous peek at the last fetched status (NO_SERVICES until a fetch completes). */
export function getKnownServiceStatus(): ServiceStatus {
  return { ...lastStatus };
}

// ---------------------------------------------------------------- recognition

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function encodeCanvas(canvas: AnyCanvas, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Downsize to ≤ 384px on the longest side, composite onto white (cut-outs have
 * transparent edges), and encode as PNG when small, otherwise JPEG.
 */
export async function prepareRecognitionImage(image: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, MAX_RECOGNITION_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);

    const png = await encodeCanvas(canvas, "image/png");
    if (png && png.size <= PNG_PREFERRED_BYTES) return blobToDataUrl(png);
    for (const q of [0.85, 0.7, 0.55]) {
      const jpeg = await encodeCanvas(canvas, "image/jpeg", q);
      if (jpeg && jpeg.size <= MAX_IMAGE_BYTES) return blobToDataUrl(jpeg);
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** Ask the server what a drawing is. Never rejects. */
export async function recognizeDrawing(image: Blob, signal?: AbortSignal): Promise<RecognitionOutcome> {
  const status = await fetchServiceStatus();
  if (!status.recognition) return { status: "unavailable" };
  const dataUrl = await prepareRecognitionImage(image);
  if (!dataUrl) return { status: "failed" };
  if (signal?.aborted) return { status: "failed" };

  const res = await postJson(
    "/api/recognize",
    { body: JSON.stringify({ image: dataUrl }), headers: { "Content-Type": "application/json" } },
    RECOGNIZE_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) return res.failure;
  const parsed = RecognizeResponseSchema.safeParse(res.json);
  if (!parsed.success) return { status: "failed" };
  if (!parsed.data.ok) return fromReason(parsed.data.reason);
  const r = parsed.data.result;
  const result: RecognitionResult = {
    kind: r.kind,
    name: r.name,
    facing: r.facing,
    behavior: r.behavior,
    confidence: r.confidence,
    description: r.description,
  };
  return { status: "ok", result, uncertain: result.confidence < UNCERTAIN_CONFIDENCE };
}

// ---------------------------------------------------------------- chat

/** Ask a character for an AI reply. Never rejects; on failure use localReply(). */
export async function askCharacter(req: ChatRequest, signal?: AbortSignal): Promise<ChatOutcome> {
  const status = await fetchServiceStatus();
  if (!status.dialogue) return { status: "unavailable" };
  const body: ChatRequest = {
    character: req.character,
    history: req.history.slice(-12).map((t) => ({ role: t.role, text: t.text.slice(0, 300) })),
    message: req.message.slice(0, 300),
  };
  const res = await postJson(
    "/api/chat",
    { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    CHAT_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) return res.failure;
  const parsed = ChatResponseSchema.safeParse(res.json);
  if (!parsed.success) return { status: "failed" };
  if (!parsed.data.ok) return fromReason(parsed.data.reason);
  return { status: "ok", reply: parsed.data.reply };
}

// ---------------------------------------------------------------- transcription

/** Server speech-to-text for a short recording. Never rejects. */
export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<TranscriptionOutcome> {
  const status = await fetchServiceStatus();
  if (!status.transcription) return { status: "unavailable" };
  if (blob.size === 0 || blob.size > 2 * 1024 * 1024) return { status: "failed" };
  const form = new FormData();
  const type = blob.type || "audio/webm";
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : type.includes("wav") ? "wav" : "webm";
  form.append("audio", blob.type ? blob : new Blob([blob], { type }), `speech.${ext}`);
  const res = await postJson("/api/transcribe", { body: form }, TRANSCRIBE_TIMEOUT_MS, signal);
  if (!res.ok) return res.failure;
  const parsed = TranscribeResponseSchema.safeParse(res.json);
  if (!parsed.success) return { status: "failed" };
  if (!parsed.data.ok) return fromReason(parsed.data.reason);
  return { status: "ok", text: parsed.data.text.trim() };
}
