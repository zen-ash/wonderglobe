// Shared Anthropic client plumbing: lazy client, refusal fallbacks, typed error mapping.

import Anthropic from "@anthropic-ai/sdk";
import type { FailReason } from "@/ai/schemas";
import { getConfig, type Env } from "./config";

/** The subset of the SDK client we use (lets tests inject a fake). */
export type ClaudeClient = Pick<Anthropic, "beta">;

let cached: { key: string; client: Anthropic } | null = null;

/** Returns a client only when ANTHROPIC_API_KEY is set; otherwise null. */
export function getClaudeClient(env: Env = process.env): ClaudeClient | null {
  const key = getConfig(env).anthropicApiKey;
  if (!key) return null;
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

/** Models that accept the server-side refusal fallback parameter (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Extra beta params enabling server-side refusal fallbacks when the model supports them. */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  if (process.env.WONDERGLOBE_CLAUDE_FALLBACKS === "off") return {};
  return FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {};
}

/** Map an SDK error (most specific first) to a friendly reason. */
export function reasonForClaudeError(err: unknown, timedOut: boolean): FailReason {
  if (timedOut) return "timeout";
  if (err instanceof Anthropic.APIUserAbortError) return "error"; // caller went away
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIConnectionError) return "unavailable";
  if (err instanceof Anthropic.RateLimitError) return "rate_limited";
  if (err instanceof Anthropic.AuthenticationError) return "unavailable";
  if (err instanceof Anthropic.PermissionDeniedError) return "unavailable";
  if (err instanceof Anthropic.NotFoundError) return "unavailable"; // e.g. unknown model id
  if (err instanceof Anthropic.BadRequestError) return "invalid";
  if (err instanceof Anthropic.UnprocessableEntityError) return "invalid";
  if (err instanceof Anthropic.InternalServerError) return "unavailable";
  if (err instanceof Anthropic.APIError) return "error";
  // Non-API AnthropicError: structured output failed to parse/validate.
  if (err instanceof Anthropic.AnthropicError) return "invalid";
  return "error";
}
