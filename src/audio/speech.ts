// Character voices. One utterance at a time; music is ducked while speaking.
// Path order: server voice (ElevenLabs via /api/speak, cached in Cache Storage)
// → browser speechSynthesis (stable pitch/rate per character) → none.
// say() reports which path was used so the UI can label it honestly.

import { getKind } from "@/core/kinds";
import { cacheHash, hashString, unitHash } from "@/ai/hash";
import { clampText, SPEAK_TEXT_MAX, type VoiceType } from "@/ai/schemas";
import { fetchServiceStatus } from "@/ai/services";
import { duckMusic, getAudioContext, getSfxBus, getVoiceBus, isSoundEnabled, setVoiceBusEnabled } from "./engine";
import { playCreatureSound } from "./creatures";

export type SpeechVia = "elevenlabs" | "browser" | "none";

export interface SayRequest {
  text: string;
  characterId: string;
  voiceType: VoiceType;
  kindId?: string;
  /** Called when audio actually starts, with the path used. */
  onStart?: (via: Exclude<SpeechVia, "none">) => void;
}

const VOICE_CACHE = "wonderglobe-voice-v1";
const MAX_CACHE_ENTRIES = 300;
const SPEAK_TIMEOUT_MS = 17_000;
const SOUND_TIMEOUT_MS = 17_000;
/** After a server voice failure that looks persistent, skip it for a while. */
const SERVER_BACKOFF_MS = 5 * 60_000;

// ---------------------------------------------------------------- cache helpers

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(VOICE_CACHE);
  } catch {
    return null;
  }
}

async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

let putsSincePrune = 0;
async function cachePut(key: string, audio: ArrayBuffer): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  try {
    await cache.put(key, new Response(audio.slice(0), { headers: { "Content-Type": "audio/mpeg" } }));
    if (++putsSincePrune >= 20) {
      putsSincePrune = 0;
      const keys = await cache.keys();
      const excess = keys.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
    }
  } catch {
    /* quota or private mode: ignore */
  }
}

function storageGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function fetchAudio(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ ok: true; audio: ArrayBuffer; voiceId: string | null } | { ok: false; persistent: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, persistent: res.status === 503 };
    }
    return { ok: true, audio: await res.arrayBuffer(), voiceId: res.headers.get("x-voice-id") };
  } catch {
    return { ok: false, persistent: false };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function decode(ctx: AudioContext, audio: ArrayBuffer): Promise<AudioBuffer | null> {
  try {
    return await ctx.decodeAudioData(audio.slice(0));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- browser voice

const BASE_PITCH: Record<VoiceType, number> = { small: 1.5, bright: 1.25, calm: 1.0, silly: 1.35, big: 0.65 };
const BASE_RATE: Record<VoiceType, number> = { small: 1.05, bright: 1.05, calm: 0.92, silly: 1.1, big: 0.88 };

/** Stable browser-voice parameters for a character. */
export function browserVoiceParams(characterId: string, voiceType: VoiceType): { pitch: number; rate: number } {
  const p = BASE_PITCH[voiceType] + (unitHash(`pitch:${characterId}`) - 0.5) * 0.3;
  const r = BASE_RATE[voiceType] + (unitHash(`rate:${characterId}`) - 0.5) * 0.1;
  return { pitch: Math.min(2, Math.max(0.1, p)), rate: Math.min(1.5, Math.max(0.6, r)) };
}

function browserSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function pickBrowserVoice(characterId: string): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices();
  if (!all.length) return null;
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  let pool = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (!pool.length) pool = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!pool.length) pool = all;
  const local = pool.filter((v) => v.localService);
  if (local.length) pool = local;
  return pool[hashString(`bvoice:${characterId}`) % pool.length];
}

// ---------------------------------------------------------------- channel

export class SpeechChannel {
  private enabled = true;
  private token = 0;
  private stopCurrent: (() => void) | null = null;
  private voiceByCharacter = new Map<string, string>();
  private serverVoiceBlockedUntil = 0;
  private serverSoundBlockedUntil = 0;
  private soundBuffers = new Map<string, AudioBuffer>();
  private lastAnimalSound = new Map<string, number>();

  setVoiceEnabled(on: boolean): void {
    this.enabled = on;
    setVoiceBusEnabled(on);
    if (!on) this.stop();
  }

  isVoiceEnabled(): boolean {
    return this.enabled;
  }

  isSpeaking(): boolean {
    return this.stopCurrent !== null;
  }

  /** Stop the current utterance (if any). */
  stop(): void {
    this.token++;
    const s = this.stopCurrent;
    this.stopCurrent = null;
    s?.();
    duckMusic(false);
  }

  /**
   * Speak a line in the character's voice. Stops any previous utterance.
   * Resolves when the line finishes (or is interrupted) with the path used.
   */
  async say(req: SayRequest): Promise<{ via: SpeechVia }> {
    const text = clampText(req.text, SPEAK_TEXT_MAX);
    this.stop();
    if (!this.enabled || !text) return { via: "none" };
    const my = this.token;
    const abort = new AbortController();
    this.stopCurrent = () => abort.abort();

    const ctx = getAudioContext();
    const bus = getVoiceBus();
    if (ctx && bus && Date.now() >= this.serverVoiceBlockedUntil) {
      const status = await fetchServiceStatus();
      if (my !== this.token) return { via: "none" };
      if (status.voice) {
        const buffer = await this.loadVoice(ctx, text, req, abort.signal);
        if (my !== this.token) return { via: "none" };
        if (buffer) {
          await this.playBuffer(ctx, bus, buffer, my, () => req.onStart?.("elevenlabs"));
          return { via: "elevenlabs" };
        }
      }
    }
    if (my !== this.token) return { via: "none" };
    if (browserSpeechAvailable()) {
      const spoke = await this.speakWithBrowser(text, req, my);
      return { via: spoke ? "browser" : "none" };
    }
    if (my === this.token) this.stopCurrent = null;
    return { via: "none" };
  }

  private async loadVoice(
    ctx: AudioContext,
    text: string,
    req: SayRequest,
    signal: AbortSignal,
  ): Promise<AudioBuffer | null> {
    const storeKey = `wg-voice:${req.characterId}`;
    const knownVoice = this.voiceByCharacter.get(req.characterId) ?? storageGet(storeKey);
    if (knownVoice) {
      const hit = await cacheGet(`/__wg-voice/${cacheHash(`${knownVoice}|${text}`)}`);
      if (hit) {
        const decoded = await decode(ctx, hit);
        if (decoded) return decoded;
      }
    }
    const res = await fetchAudio(
      "/api/speak",
      { text, characterId: req.characterId, voiceType: req.voiceType },
      SPEAK_TIMEOUT_MS,
      signal,
    );
    if (!res.ok) {
      if (res.persistent) this.serverVoiceBlockedUntil = Date.now() + SERVER_BACKOFF_MS;
      return null;
    }
    if (res.voiceId) {
      this.voiceByCharacter.set(req.characterId, res.voiceId);
      storageSet(storeKey, res.voiceId);
      void cachePut(`/__wg-voice/${cacheHash(`${res.voiceId}|${text}`)}`, res.audio);
    }
    return decode(ctx, res.audio);
  }

  private playBuffer(
    ctx: AudioContext,
    bus: AudioNode,
    buffer: AudioBuffer,
    my: number,
    onStart: () => void,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(bus);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
        if (my === this.token) {
          this.stopCurrent = null;
          duckMusic(false);
        }
        resolve();
      };
      src.onended = finish;
      this.stopCurrent = () => {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
        finish();
      };
      duckMusic(true);
      src.start();
      onStart();
    });
  }

  private speakWithBrowser(text: string, req: SayRequest, my: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const synth = window.speechSynthesis;
      let settled = false;
      const u = new SpeechSynthesisUtterance(text);
      const { pitch, rate } = browserVoiceParams(req.characterId, req.voiceType);
      u.pitch = pitch;
      u.rate = rate;
      const voice = pickBrowserVoice(req.characterId);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      // Some browsers occasionally never fire onend: guard with a generous timer.
      const guard = setTimeout(() => finish(true), 2000 + text.length * 140);
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        if (my === this.token) {
          this.stopCurrent = null;
          duckMusic(false);
        }
        resolve(ok);
      };
      u.onstart = () => req.onStart?.("browser");
      u.onend = () => finish(true);
      u.onerror = (ev) => finish(ev.error === "interrupted" || ev.error === "canceled");
      this.stopCurrent = () => {
        synth.cancel();
        finish(true);
      };
      try {
        synth.cancel();
        duckMusic(true);
        synth.speak(u);
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Play the kind's sound: generated (cached) when the server offers sounds and
   * the kind has a sound prompt, otherwise a short synthesized creature call.
   */
  async playAnimalSound(kindId: string): Promise<{ via: "elevenlabs" | "synth" | "none" }> {
    const ctx = getAudioContext();
    const bus = getSfxBus();
    if (!ctx || !bus || !isSoundEnabled()) return { via: "none" };
    const now = Date.now();
    if (now - (this.lastAnimalSound.get(kindId) ?? 0) < 700) return { via: "none" };
    this.lastAnimalSound.set(kindId, now);

    const kind = getKind(kindId);
    if (kind.id === kindId && kind.soundPrompt && now >= this.serverSoundBlockedUntil) {
      const buffer = await this.loadSound(ctx, kindId);
      if (buffer) {
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = 0.8;
        src.buffer = buffer;
        src.connect(g).connect(bus);
        src.onended = () => {
          src.disconnect();
          g.disconnect();
        };
        src.start();
        return { via: "elevenlabs" };
      }
    }
    // Cute synthesized call for the kind (meow, woof, beep …).
    playCreatureSound(kindId);
    return { via: "synth" };
  }

  private async loadSound(ctx: AudioContext, kindId: string): Promise<AudioBuffer | null> {
    const mem = this.soundBuffers.get(kindId);
    if (mem) return mem;
    const key = `/__wg-sound/${kindId}`;
    let audio = await cacheGet(key);
    if (!audio) {
      const status = await fetchServiceStatus();
      if (!status.sounds) return null;
      const res = await fetchAudio("/api/sound", { kind: kindId }, SOUND_TIMEOUT_MS, new AbortController().signal);
      if (!res.ok) {
        if (res.persistent) this.serverSoundBlockedUntil = Date.now() + SERVER_BACKOFF_MS;
        return null;
      }
      audio = res.audio;
      void cachePut(key, audio);
    }
    const decoded = await decode(ctx, audio);
    if (decoded) {
      this.soundBuffers.set(kindId, decoded);
      if (this.soundBuffers.size > 40) {
        const oldest = this.soundBuffers.keys().next().value;
        if (oldest !== undefined) this.soundBuffers.delete(oldest);
      }
    }
    return decoded;
  }
}

/** The app-wide speech channel. */
export const speech = new SpeechChannel();
