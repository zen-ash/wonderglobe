import { getConfig } from "@/server/config";
import { getClaudeClient } from "@/server/claude";
import { CHAT_BODY_LIMIT, generateReply } from "@/server/dialogue";
import { createRateLimiter, jsonError, jsonOk, rateLimitResponse, readJsonBody } from "@/server/limits";
import { ChatRequestSchema } from "@/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** POST { character, history, message } → { ok:true, reply } | { ok:false, reason } */
export async function POST(req: Request): Promise<Response> {
  const client = getClaudeClient();
  if (!client) return jsonError("unavailable");
  const limited = rateLimitResponse(limiter, req);
  if (limited) return limited;

  const body = await readJsonBody(req, CHAT_BODY_LIMIT);
  if (!body.ok) return jsonError("invalid", body.status);
  const parsed = ChatRequestSchema.safeParse(body.value);
  if (!parsed.success) return jsonError("invalid");

  const out = await generateReply({ client, model: getConfig().claudeModel }, parsed.data, req.signal);
  if (!out.ok) return jsonError(out.reason, out.reason === "invalid" ? 502 : undefined);
  return jsonOk({ reply: out.reply });
}
