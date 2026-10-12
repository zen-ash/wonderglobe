import { getConfig } from "@/server/config";
import { createRateLimiter, jsonError, rateLimitResponse, readJsonBody } from "@/server/limits";
import { pickVoice, synthesizeSpeech } from "@/server/voice";
import { SpeakRequestSchema } from "@/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** POST { text, characterId, voiceType } → audio/mpeg (header X-Voice-Id) | 503/4xx JSON */
export async function POST(req: Request): Promise<Response> {
  const cfg = getConfig();
  if (!cfg.elevenLabsApiKey) return jsonError("unavailable");
  const limited = rateLimitResponse(limiter, req);
  if (limited) return limited;

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError("invalid", body.status);
  const parsed = SpeakRequestSchema.safeParse(body.value);
  if (!parsed.success) return jsonError("invalid");

  const voiceId = pickVoice(parsed.data.characterId, parsed.data.voiceType, cfg.voices);
  const out = await synthesizeSpeech(
    { apiKey: cfg.elevenLabsApiKey },
    { text: parsed.data.text, voiceId, model: cfg.ttsModel },
    req.signal,
  );
  if (!out.ok) return jsonError(out.reason, out.reason === "invalid" ? 502 : undefined);
  return new Response(out.audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Voice-Id": voiceId,
    },
  });
}
