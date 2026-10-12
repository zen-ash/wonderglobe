// Web Audio engine singleton. The AudioContext is created lazily and only
// after a user gesture (call unlockAudio() from a click/keydown handler).
//
//   source → musicGain ─┐
//   source → sfxGain   ─┼→ master → destination
//   source → voiceGain ─┘

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  voice: GainNode;
}

let engine: Engine | null = null;
let unlocked = false;
let visibilityHooked = false;
const unlockListeners = new Set<(ctx: AudioContext) => void>();
const duckListeners = new Set<(ducked: boolean) => void>();

const settings = {
  musicEnabled: true,
  musicVolume: 0.5,
  soundEnabled: true,
  soundVolume: 0.7,
  voiceEnabled: true,
  voiceVolume: 1,
  ducked: false,
};

/** Music sits well below effects and voices. */
const MUSIC_LEVEL = 0.35;
const DUCK_FACTOR = 0.25;

function musicTarget(): number {
  if (!settings.musicEnabled) return 0;
  return settings.musicVolume * MUSIC_LEVEL * (settings.ducked ? DUCK_FACTOR : 1);
}
function sfxTarget(): number {
  return settings.soundEnabled ? settings.soundVolume : 0;
}
function voiceTarget(): number {
  return settings.voiceEnabled ? settings.voiceVolume : 0;
}

function ramp(param: AudioParam, value: number, seconds = 0.25): void {
  if (!engine) return;
  const now = engine.ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, seconds / 3);
}

function hookVisibility(): void {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (!engine) return;
    if (document.hidden) {
      void engine.ctx.suspend().catch(() => undefined);
    } else if (unlocked) {
      void engine.ctx.resume().catch(() => undefined);
    }
  });
}

function createEngine(): Engine | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // Gentle safety limiter so stacked sounds never get harsh.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);

  const music = ctx.createGain();
  const sfx = ctx.createGain();
  const voice = ctx.createGain();
  music.gain.value = musicTarget();
  sfx.gain.value = sfxTarget();
  voice.gain.value = voiceTarget();
  music.connect(master);
  sfx.connect(master);
  voice.connect(master);
  return { ctx, master, music, sfx, voice };
}

/**
 * Create/resume the AudioContext. Call from a user-gesture handler (click,
 * keydown, pointerup). Safe to call repeatedly. Returns null if Web Audio is
 * unsupported.
 */
export function unlockAudio(): AudioContext | null {
  if (!engine) engine = createEngine();
  if (!engine) return null;
  hookVisibility();
  const { ctx } = engine;
  const wasUnlocked = unlocked;
  unlocked = true;
  if (ctx.state === "suspended" && !(typeof document !== "undefined" && document.hidden)) {
    void ctx.resume().catch(() => undefined);
  }
  if (!wasUnlocked) {
    // Play a silent buffer: required by some mobile browsers to fully unlock.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    for (const fn of unlockListeners) fn(ctx);
  }
  return ctx;
}

export function isAudioUnlocked(): boolean {
  return unlocked && engine !== null;
}

/** The context, or null if audio hasn't been unlocked by a user gesture yet. */
export function getAudioContext(): AudioContext | null {
  return unlocked && engine ? engine.ctx : null;
}

/** Run `fn` once audio is unlocked (immediately if it already is). Returns an unsubscribe. */
export function onAudioUnlocked(fn: (ctx: AudioContext) => void): () => void {
  if (unlocked && engine) {
    fn(engine.ctx);
    return () => undefined;
  }
  const once = (ctx: AudioContext) => {
    unlockListeners.delete(once);
    fn(ctx);
  };
  unlockListeners.add(once);
  return () => unlockListeners.delete(once);
}

export function getMusicBus(): GainNode | null {
  return unlocked && engine ? engine.music : null;
}
export function getSfxBus(): GainNode | null {
  return unlocked && engine ? engine.sfx : null;
}
export function getVoiceBus(): GainNode | null {
  return unlocked && engine ? engine.voice : null;
}

export function setMusicEnabled(on: boolean): void {
  settings.musicEnabled = on;
  if (engine) ramp(engine.music.gain, musicTarget(), 0.6);
}
export function setMusicVolume(v: number): void {
  settings.musicVolume = clamp01(v);
  if (engine) ramp(engine.music.gain, musicTarget(), 0.2);
}
export function setSoundEnabled(on: boolean): void {
  settings.soundEnabled = on;
  if (engine) ramp(engine.sfx.gain, sfxTarget(), 0.1);
}
export function setSoundVolume(v: number): void {
  settings.soundVolume = clamp01(v);
  if (engine) ramp(engine.sfx.gain, sfxTarget(), 0.1);
}
/** Mutes the voice bus (generated speech). SpeechChannel also checks this. */
export function setVoiceBusEnabled(on: boolean): void {
  settings.voiceEnabled = on;
  if (engine) ramp(engine.voice.gain, voiceTarget(), 0.1);
}
export function setVoiceVolume(v: number): void {
  settings.voiceVolume = clamp01(v);
  if (engine) ramp(engine.voice.gain, voiceTarget(), 0.1);
}

export function isMusicEnabled(): boolean {
  return settings.musicEnabled;
}
export function isSoundEnabled(): boolean {
  return settings.soundEnabled;
}

/** Smoothly lower music to ~25% while a character speaks (and restore after). */
export function duckMusic(on: boolean): void {
  if (settings.ducked === on) return;
  settings.ducked = on;
  if (engine) ramp(engine.music.gain, musicTarget(), on ? 0.35 : 1.2);
  for (const fn of duckListeners) fn(on);
}

export function isMusicDucked(): boolean {
  return settings.ducked;
}

/** Be told when speech ducks/unducks (the ambience dips a little too). Returns an unsubscribe. */
export function onDuckChange(fn: (ducked: boolean) => void): () => void {
  duckListeners.add(fn);
  return () => duckListeners.delete(fn);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
