// ElevenLabs integration: text-to-speech, sound effects and speech-to-text.
// Uses raw fetch (injectable for tests). The API key never leaves the server.

import { z } from "zod";
import { getKind } from "@/core/kinds";
import { hashString } from "@/ai/hash";
import { TRANSCRIPT_MAX, clampText, type FailReason, type VoiceType } from "@/ai/schemas";
import type { ServerConfig } from "./config";
import { LruCache, deadline } from "./limits";

export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
export const TTS_TIMEOUT_MS = 15_000;
export const SOUND_TIMEOUT_MS = 15_000;
export const STT_TIMEOUT_MS = 15_000;
export const MAX_AUDIO_RESPONSE_BYTES = 3 * 1024 * 1024;
export const MAX_TRANSCRIBE_UPLOAD_BYTES = 2 * 1024 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ElevenDeps {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export type AudioOutcome = { ok: true; audio: ArrayBuffer } | { ok: false; reason: FailReason };

// ---------------------------------------------------------------- voice choice

/**
 * Stable voice for a character: hash(characterId) over the voice list for the
 * kind's voice type. Same id + same config ⇒ same voice, always.
 */
export function pickVoice(characterId: string, voiceType: VoiceType, voices: ServerConfig["voices"]): string {
  const list = voices[voiceType]?.length ? voices[voiceType] : voices.calm;
  return list[hashString(`voice:${characterId}`) % list.length];
}

// ---------------------------------------------------------------- helpers

export function reasonForStatus(status: number): FailReason {
  if (status === 401 || status === 403) return "unavailable";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413 || status === 415 || status === 422) return "invalid";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "unavailable";
  return "error";
}

async function readBounded(res: Response, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

async function postAudio(
  deps: ElevenDeps,
  url: string,
  body: unknown,
  defaultTimeout: number,
  parentSignal?: AbortSignal | null,
): Promise<AudioOutcome> {
  const doFetch = deps.fetch ?? fetch;
  const dl = deadline(deps.timeoutMs ?? defaultTimeout, parentSignal);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "xi-api-key": deps.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
      signal: dl.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: reasonForStatus(res.status) };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("audio/")) return { ok: false, reason: "invalid" };
    const audio = await readBounded(res, MAX_AUDIO_RESPONSE_BYTES);
    if (!audio || audio.byteLength < 64) return { ok: false, reason: "invalid" };
    return { ok: true, audio };
  } catch {
    return { ok: false, reason: dl.timedOut ? "timeout" : "unavailable" };
  } finally {
    dl.clear();
  }
}

// ---------------------------------------------------------------- TTS

export interface SpeakInput {
  text: string;
  voiceId: string;
  model: string;
}

export function synthesizeSpeech(
  deps: ElevenDeps,
  input: SpeakInput,
  parentSignal?: AbortSignal | null,
): Promise<AudioOutcome> {
  const url = `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_64`;
  return postAudio(
    deps,
    url,
    {
      text: input.text,
      model_id: input.model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
    },
    TTS_TIMEOUT_MS,
    parentSignal,
  );
}

// ---------------------------------------------------------------- sound effects

const soundCache = new LruCache<string, ArrayBuffer>(30);
const soundInFlight = new Map<string, Promise<AudioOutcome>>();

/** Sound prompt for a kind, or null if the kind has none. */
export function soundPromptFor(kindId: string): string | null {
  const k = getKind(kindId);
  if (k.id !== kindId || !k.soundPrompt) return null;
  return `${k.soundPrompt}, soft, cute and gentle, suitable for young children`;
}

/** Generated sound effect for a kind, cached in a bounded in-memory LRU (30 entries). */
export async function generateKindSound(
  deps: ElevenDeps,
  kindId: string,
  parentSignal?: AbortSignal | null,
): Promise<AudioOutcome> {
  const prompt = soundPromptFor(kindId);
  if (!prompt) return { ok: false, reason: "invalid" };
  const hit = soundCache.get(kindId);
  if (hit) return { ok: true, audio: hit };
  const pending = soundInFlight.get(kindId);
  if (pending) return pending;

  const p = postAudio(
    deps,
    `${ELEVENLABS_BASE}/sound-generation`,
    { text: prompt, duration_seconds: 1.5, prompt_influence: 0.6 },
    SOUND_TIMEOUT_MS,
    // Shared between callers, so don't tie it to one request's lifetime.
    undefined,
  ).then((out) => {
    if (out.ok) soundCache.set(kindId, out.audio);
    return out;
  });
  soundInFlight.set(kindId, p);
  try {
    if (!parentSignal) return await p;
    return await Promise.race([
      p,
      new Promise<AudioOutcome>((resolve) => {
        if (parentSignal.aborted) resolve({ ok: false, reason: "error" });
        parentSignal.addEventListener("abort", () => resolve({ ok: false, reason: "error" }), { once: true });
      }),
    ]);
  } finally {
    p.finally(() => soundInFlight.delete(kindId)).catch(() => undefined);
  }
}

/** For tests. */
export function clearSoundCache(): void {
  soundCache.clear();
}

// ---------------------------------------------------------------- speech-to-text

export const ACCEPTED_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/wave", "video/webm"];

export function isAcceptedAudioType(type: string): boolean {
  const base = type.split(";")[0].trim().toLowerCase();
  return ACCEPTED_AUDIO_TYPES.includes(base);
}

const SttResponseSchema = z.object({ text: z.string() }).loose();

export type TranscribeOutcome = { ok: true; text: string } | { ok: false; reason: FailReason };

export async function transcribe(
  deps: ElevenDeps,
  audio: Blob,
  filename: string,
  parentSignal?: AbortSignal | null,
): Promise<TranscribeOutcome> {
  const doFetch = deps.fetch ?? fetch;
  const dl = deadline(deps.timeoutMs ?? STT_TIMEOUT_MS, parentSignal);
  try {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model_id", "scribe_v1");
    const res = await doFetch(`${ELEVENLABS_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": deps.apiKey, Accept: "application/json" },
      body: form,
      signal: dl.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: reasonForStatus(res.status) };
    }
    const buf = await readBounded(res, 256 * 1024);
    if (!buf) return { ok: false, reason: "invalid" };
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return { ok: false, reason: "invalid" };
    }
    const parsed = SttResponseSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: "invalid" };
    return { ok: true, text: clampText(parsed.data.text, TRANSCRIPT_MAX) };
  } catch {
    return { ok: false, reason: dl.timedOut ? "timeout" : "unavailable" };
  } finally {
    dl.clear();
  }
}
