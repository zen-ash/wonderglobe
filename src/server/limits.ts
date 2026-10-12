// Request guards shared by the API routes: per-IP rate limiting, bounded body
// reading, timeouts and friendly JSON responses.

import type { FailReason } from "@/ai/schemas";

// ---------------------------------------------------------------- rate limiting

export interface RateLimiterOptions {
  /** Max requests per window per key. */
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys (oldest are evicted). */
  maxKeys?: number;
  now?: () => number;
}

export interface RateDecision {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateDecision;
  reset(): void;
}

/** Simple in-memory fixed-window limiter (per process; fine for a single small server). */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 5000;
  const buckets = new Map<string, { start: number; count: number }>();

  return {
    check(key: string): RateDecision {
      const t = now();
      let b = buckets.get(key);
      if (!b || t - b.start >= opts.windowMs) {
        if (b) buckets.delete(key);
        b = { start: t, count: 0 };
        buckets.set(key, b);
        if (buckets.size > maxKeys) {
          // Evict expired buckets first, then the oldest inserted.
          for (const [k, v] of buckets) {
            if (t - v.start >= opts.windowMs) buckets.delete(k);
          }
          while (buckets.size > maxKeys) {
            const oldest = buckets.keys().next().value;
            if (oldest === undefined) break;
            buckets.delete(oldest);
          }
        }
      }
      if (b.count >= opts.limit) {
        return { ok: false, remaining: 0, retryAfterMs: Math.max(0, b.start + opts.windowMs - t) };
      }
      b.count++;
      return { ok: true, remaining: opts.limit - b.count, retryAfterMs: 0 };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** Best-effort client IP (behind a proxy, the first X-Forwarded-For entry). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "local";
}

// ---------------------------------------------------------------- JSON helpers

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk<T extends object>(data: T, init?: { headers?: Record<string, string> }): Response {
  return Response.json({ ok: true, ...data }, { status: 200, headers: { ...NO_STORE, ...init?.headers } });
}

export function statusForReason(reason: FailReason): number {
  switch (reason) {
    case "unavailable":
      return 503;
    case "timeout":
      return 504;
    case "invalid":
      return 400;
    case "rate_limited":
      return 429;
    default:
      return 502;
  }
}

export function jsonError(reason: FailReason, status = statusForReason(reason), retryAfterMs?: number): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfterMs !== undefined && retryAfterMs > 0) headers["Retry-After"] = String(Math.ceil(retryAfterMs / 1000));
  return Response.json({ ok: false, reason }, { status, headers });
}

/** Returns a 429 response if the caller is over the limit, otherwise null. */
export function rateLimitResponse(limiter: RateLimiter, req: Request): Response | null {
  const d = limiter.check(clientIp(req));
  return d.ok ? null : jsonError("rate_limited", 429, d.retryAfterMs);
}

// ---------------------------------------------------------------- bounded bodies

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

/** Read the raw request body, aborting as soon as it exceeds `maxBytes`. */
export async function readLimitedBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; reason: "invalid"; status: 400 | 413 };

/** Read and JSON-parse a body of at most `maxBytes`. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult> {
  try {
    const bytes = await readLimitedBytes(req, maxBytes);
    const text = new TextDecoder().decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { ok: false, reason: "invalid", status: 413 };
    return { ok: false, reason: "invalid", status: 400 };
  }
}

// ---------------------------------------------------------------- timeouts

export interface Deadline {
  signal: AbortSignal;
  /** True once the deadline (not the caller) aborted the signal. */
  readonly timedOut: boolean;
  clear(): void;
}

/** An AbortSignal that fires after `ms`, or when `parent` (e.g. request.signal) aborts. */
export function deadline(ms: number, parent?: AbortSignal | null): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, ms);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    clear() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

// ---------------------------------------------------------------- small LRU

export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}
