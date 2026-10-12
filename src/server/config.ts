// Server-only configuration. Reads environment variables lazily (at call time),
// so routes work — and honestly report "unavailable" — without any credentials.
// Never import this module from client components.

import type { ServiceStatus } from "@/core/types";
import { VOICE_TYPES, type VoiceType } from "@/ai/schemas";

export type Env = Record<string, string | undefined>;

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";

/**
 * Default ElevenLabs *premade* voice ids, grouped by the kind table's voice type.
 * Override with ELEVENLABS_VOICE_IDS (one list for everything) or
 * ELEVENLABS_VOICE_IDS_SMALL / _BIG / _BRIGHT / _CALM / _SILLY.
 */
export const DEFAULT_VOICES: Record<VoiceType, string[]> = {
  // light, young-sounding voices
  small: ["jBpfuIE2acCO8z3wKNLl" /* Gigi */, "MF3mGyEYCl7XYWbV9V6O" /* Elli */, "cgSgspJ2msm6clMCkdW9" /* Jessica */],
  // deep, warm voices
  big: ["VR6AewLTigWG4xSOukaG" /* Arnold */, "2EiwWnXFnvU5JabPnv8n" /* Clyde */, "JBFqnCBsd6RMkjVDRZzb" /* George */],
  // upbeat voices
  bright: ["IKne3meq5aSn9XLyUdCD" /* Charlie */, "FGY2WhTYpPnrIDTdsKH5" /* Laura */, "TX3LPaxmHKxFdv7VOQHJ" /* Liam */],
  // gentle voices
  calm: ["21m00Tcm4TlvDq8ikWAM" /* Rachel */, "XrExE9yKIg1WjnnlVkGX" /* Matilda */, "SAz9YHcvj6GT2YYXdXww" /* River */],
  // playful voices
  silly: ["CYw3kZ02Hs0563khs1Fj" /* Dave */, "N2lVS1w4EtoT3dr4eOWO" /* Callum */, "jsCqWAovK2LkecY7zXl4" /* Freya */],
};

export interface ServerConfig {
  anthropicApiKey: string | null;
  claudeModel: string;
  elevenLabsApiKey: string | null;
  ttsModel: string;
  /** Voice ids per voice type (always non-empty lists). */
  voices: Record<VoiceType, string[]>;
}

function nonEmpty(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

const VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;

export function parseVoiceList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VOICE_ID_RE.test(s));
}

export function getConfig(env: Env = process.env): ServerConfig {
  const general = parseVoiceList(env.ELEVENLABS_VOICE_IDS);
  const voices = {} as Record<VoiceType, string[]>;
  for (const t of VOICE_TYPES) {
    const specific = parseVoiceList(env[`ELEVENLABS_VOICE_IDS_${t.toUpperCase()}`]);
    voices[t] = specific.length ? specific : general.length ? general : DEFAULT_VOICES[t];
  }
  return {
    anthropicApiKey: nonEmpty(env.ANTHROPIC_API_KEY),
    claudeModel: nonEmpty(env.WONDERGLOBE_CLAUDE_MODEL) ?? DEFAULT_CLAUDE_MODEL,
    elevenLabsApiKey: nonEmpty(env.ELEVENLABS_API_KEY),
    ttsModel: nonEmpty(env.ELEVENLABS_TTS_MODEL) ?? DEFAULT_TTS_MODEL,
    voices,
  };
}

/** What the server can do right now. Never includes secrets. */
export function getServiceStatus(env: Env = process.env): ServiceStatus {
  const cfg = getConfig(env);
  const claude = cfg.anthropicApiKey !== null;
  const eleven = cfg.elevenLabsApiKey !== null;
  return {
    recognition: claude,
    dialogue: claude,
    voice: eleven,
    sounds: eleven,
    transcription: eleven,
  };
}
