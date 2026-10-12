import { z } from "zod";
import { getConfig } from "@/server/config";
import { getClaudeClient } from "@/server/claude";
import { createRateLimiter, jsonError, jsonOk, rateLimitResponse, readJsonBody } from "@/server/limits";
import { RECOGNIZE_BODY_LIMIT, decodeImageDataUrl, recognizeImage } from "@/server/recognize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 12, windowMs: 60_000 });
const BodySchema = z.object({ image: z.string().max(RECOGNIZE_BODY_LIMIT) });

/** POST { image: dataURL } → { ok:true, result } | { ok:false, reason } */
export async function POST(req: Request): Promise<Response> {
  const client = getClaudeClient();
  if (!client) return jsonError("unavailable");
  const limited = rateLimitResponse(limiter, req);
  if (limited) return limited;

  const body = await readJsonBody(req, RECOGNIZE_BODY_LIMIT);
  if (!body.ok) return jsonError("invalid", body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError("invalid");
  const image = decodeImageDataUrl(parsed.data.image);
  if (!image) return jsonError("invalid");

  const out = await recognizeImage({ client, model: getConfig().claudeModel }, image, req.signal);
  if (!out.ok) return jsonError(out.reason, out.reason === "invalid" ? 502 : undefined);
  return jsonOk({ result: out.result });
}
