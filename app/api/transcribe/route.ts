import { getConfig } from "@/server/config";
import {
  BodyTooLargeError,
  createRateLimiter,
  jsonError,
  jsonOk,
  rateLimitResponse,
  readLimitedBytes,
} from "@/server/limits";
import { MAX_TRANSCRIBE_UPLOAD_BYTES, isAcceptedAudioType, transcribe } from "@/server/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 15, windowMs: 60_000 });

/**
 * POST multipart/form-data with field `audio` (≤ 2 MB; webm/ogg/mp4/wav) → { ok:true, text }.
 * Duration is bounded indirectly: the client stops recording after 12 s and the
 * upload size is capped.
 */
export async function POST(req: Request): Promise<Response> {
  const cfg = getConfig();
  if (!cfg.elevenLabsApiKey) return jsonError("unavailable");
  const limited = rateLimitResponse(limiter, req);
  if (limited) return limited;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return jsonError("invalid", 415);

  let form: FormData;
  try {
    // Read with a hard cap first, then let the platform parse the multipart body.
    const bytes = await readLimitedBytes(req, MAX_TRANSCRIBE_UPLOAD_BYTES + 16 * 1024);
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch (e) {
    return jsonError("invalid", e instanceof BodyTooLargeError ? 413 : 400);
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return jsonError("invalid");
  if (audio.size > MAX_TRANSCRIBE_UPLOAD_BYTES) return jsonError("invalid", 413);
  if (!isAcceptedAudioType(audio.type)) return jsonError("invalid", 415);

  const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "mp4" : audio.type.includes("wav") ? "wav" : "webm";
  const out = await transcribe({ apiKey: cfg.elevenLabsApiKey }, audio, `speech.${ext}`, req.signal);
  if (!out.ok) return jsonError(out.reason, out.reason === "invalid" ? 502 : undefined);
  return jsonOk({ text: out.text });
}
