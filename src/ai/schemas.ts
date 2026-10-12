// Shared request/response contracts for the AI routes. Imported by both the
// server (input validation, model-output validation) and the browser client
// (response validation). Contains no secrets and no provider logic.

import { z } from "zod";
import { KIND_IDS } from "@/core/kinds";
import type { Behavior } from "@/core/types";

export const BEHAVIORS = [
  "walk",
  "hop",
  "fly",
  "flutter",
  "swim",
  "float",
  "drive",
  "grow",
  "build",
  "hover",
  "still",
] as const satisfies readonly Behavior[];

// Compile-time check that BEHAVIORS lists every Behavior.
type _MissingBehavior = Exclude<Behavior, (typeof BEHAVIORS)[number]>;
const _behaviorsComplete: _MissingBehavior extends never ? true : false = true;
void _behaviorsComplete;

export const VOICE_TYPES = ["small", "big", "bright", "calm", "silly"] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

export const FAIL_REASONS = ["unavailable", "timeout", "invalid", "rate_limited", "error"] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

export const NAME_MAX = 24;
export const CHAT_TEXT_MAX = 300;
export const CHAT_HISTORY_MAX = 12;
export const REPLY_MAX = 220;
export const SPEAK_TEXT_MAX = 240;
export const TRANSCRIPT_MAX = 300;

export const ServiceStatusSchema = z.object({
  recognition: z.boolean(),
  dialogue: z.boolean(),
  voice: z.boolean(),
  sounds: z.boolean(),
  transcription: z.boolean(),
});

export const FailureSchema = z.object({
  ok: z.literal(false),
  reason: z.enum(FAIL_REASONS),
});

/** Trim, collapse whitespace and clamp to `max` characters (whole code points). */
export function clampText(input: string, max: number): string {
  const clean = input.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return chars.slice(0, max).join("").trim();
}

/** Clamp a friendly name: strip odd characters, collapse spaces, ≤ NAME_MAX chars. */
export function clampName(input: string): string {
  const cleaned = input.replace(/[<>{}[\]\\`"*_#|~^]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  if (chars.length <= NAME_MAX) return cleaned;
  // Prefer cutting at a word boundary.
  const cut = chars.slice(0, NAME_MAX).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace >= 10 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Validated recognition result (server-side second pass and client response check).
 * Unknown kinds/behaviours are rejected; the name is clamped; confidence is clamped to 0..1.
 */
export const RecognitionResultSchema = z.object({
  kind: z.enum(KIND_IDS),
  name: z
    .string()
    .transform(clampName)
    .pipe(z.string().min(1)),
  facing: z.enum(["left", "right", "none"]),
  behavior: z.enum(BEHAVIORS),
  confidence: z
    .number()
    .refine((n) => Number.isFinite(n))
    .transform((n) => Math.min(1, Math.max(0, n))),
  description: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : clampText(s, 160))),
});
export type ValidRecognition = z.output<typeof RecognitionResultSchema>;

export const RecognizeResponseSchema = z.union([
  z.object({ ok: z.literal(true), result: RecognitionResultSchema }),
  FailureSchema,
]);

export const ChatCharacterSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  behavior: z.enum(BEHAVIORS),
  region: z.string().max(60),
  mode: z.enum(["paper", "gallery"]),
  title: z.string().max(80).optional(),
  artist: z.string().max(60).optional(),
  story: z.string().max(400).optional(),
});
export type ChatCharacter = z.infer<typeof ChatCharacterSchema>;

export const ChatTurnSchema = z.object({
  role: z.enum(["player", "character"]),
  text: z.string().max(CHAT_TEXT_MAX),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const ChatRequestSchema = z.object({
  character: ChatCharacterSchema,
  history: z.array(ChatTurnSchema).max(CHAT_HISTORY_MAX),
  message: z.string().trim().min(1).max(CHAT_TEXT_MAX),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.union([
  z.object({ ok: z.literal(true), reply: z.string().min(1).max(REPLY_MAX) }),
  FailureSchema,
]);

export const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(SPEAK_TEXT_MAX),
  characterId: z.string().min(1).max(80),
  voiceType: z.enum(VOICE_TYPES),
});
export type SpeakRequest = z.infer<typeof SpeakRequestSchema>;

export const SoundRequestSchema = z.object({
  kind: z.enum(KIND_IDS),
});

export const TranscribeResponseSchema = z.union([
  z.object({ ok: z.literal(true), text: z.string().max(TRANSCRIPT_MAX) }),
  FailureSchema,
]);
