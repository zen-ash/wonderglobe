import { getConfig } from "@/server/config";
import { createRateLimiter, jsonError, rateLimitResponse, readJsonBody } from "@/server/limits";
import { generateKindSound, soundPromptFor } from "@/server/voice";
import { SoundRequestSchema } from "@/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 40, windowMs: 60_000 });

/** POST { kind } → audio/mpeg (generated once per kind, LRU-cached on the server). */
export async function POST(req: Request): Promise<Response> {
  const cfg = getConfig();
  if (!cfg.elevenLabsApiKey) return jsonError("unavailable");
  const limited = rateLimitResponse(limiter, req);
  if (limited) return limited;

  const body = await readJsonBody(req, 1024);
  if (!body.ok) return jsonError("invalid", body.status);
  const parsed = SoundRequestSchema.safeParse(body.value);
  if (!parsed.success || !soundPromptFor(parsed.data.kind)) return jsonError("invalid");

  const out = await generateKindSound({ apiKey: cfg.elevenLabsApiKey }, parsed.data.kind, req.signal);
  if (!out.ok) return jsonError(out.reason, out.reason === "invalid" ? 502 : undefined);
  return new Response(out.audio, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
}
