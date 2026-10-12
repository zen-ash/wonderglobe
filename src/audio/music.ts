// Gentle generative background music. Calm on purpose: sparse pentatonic
// notes, slow pad chords (I–vi–IV–V in C major, ~8 s each), lots of silence,
// and a soft reverb + echo. Two flavours: "paper" (soft) and "gallery"
// (brighter, music-box sprinkled in).
//
// The character also follows where the player is (setMusicRegion): a music box
// in the garden and cherry grove, marimba on the meadow and farm, flute-like
// sines in the forest, a harp by the lake and coast, airy pads on the
// mountain. Changes are never abrupt: the instrument blends note by note over
// ~8 s and tempo/brightness glide. Time of day and weather are read from the
// shared `environment`: night is slower, softer and lower (a lullaby); rain is
// sparser.
//
// Scheduling uses a ~100 ms setInterval look-ahead against AudioContext time,
// so timing stays smooth even if the main thread is busy.

import type { RegionKind } from "@/world/planet";
import { environment } from "@/world/environment";
import { getAudioContext, getMusicBus, onAudioUnlocked } from "./engine";
import { noiseBuffer } from "./kit";
import {
  moodFromEnv,
  paletteForRegion,
  shapeMusic,
  smoothToward,
  transitionMix,
  type MusicInstrument,
  type MusicPalette,
  type MusicShape,
} from "./logic";

export type MusicFlavor = "paper" | "gallery";

const STEP_SECONDS = 0.5; // eighth notes at 60 bpm (echo spacing)
const STEPS_PER_CHORD = 16; // ~8 s per chord
const TRANSITION_SECONDS = 8;
const LOOKAHEAD_SECONDS = 0.4;
const TICK_MS = 100;

/** MIDI note voicings (open, low-mid register). */
const CHORDS: Record<"I" | "ii" | "IV" | "V" | "vi", number[]> = {
  I: [48, 55, 64], // C3 G3 E4
  ii: [50, 57, 65], // D3 A3 F4
  IV: [41, 48, 57], // F2 C3 A3
  V: [43, 50, 59], // G2 D3 B3
  vi: [45, 52, 60], // A2 E3 C4
};
const PROGRESSIONS: Array<Array<keyof typeof CHORDS>> = [
  ["I", "vi", "IV", "V"],
  ["I", "IV", "vi", "V"],
  ["vi", "IV", "I", "V"],
  ["I", "vi", "ii", "V"],
];
/** Pitch classes of chord tones per chord, for gentle melodic gravity. */
const CHORD_PCS: Record<keyof typeof CHORDS, number[]> = {
  I: [0, 4, 7],
  ii: [2, 5, 9],
  IV: [5, 9, 0],
  V: [7, 11, 2],
  vi: [9, 0, 4],
};

interface Session {
  ctx: AudioContext;
  out: GainNode;
  dry: GainNode;
  echoIn: GainNode;
  tone: BiquadFilterNode;
  flavor: MusicFlavor;
  palette: MusicPalette;
  prevPalette: MusicPalette;
  transitionStart: number;
  shape: MusicShape;
  stepSeconds: number;
  transpose: number;
  lastTickTime: number;
  timer: ReturnType<typeof setInterval>;
  nextStepTime: number;
  step: number;
  progression: Array<keyof typeof CHORDS>;
  chordIndex: number;
  melodyIndex: number;
  restingPhrase: boolean;
  nodes: AudioNode[];
}

let session: Session | null = null;
let wanted = false;
let flavor: MusicFlavor = "paper";
let region: RegionKind | null = null;
let unsubscribeUnlock: (() => void) | null = null;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function buildSession(ctx: AudioContext, bus: GainNode, f: MusicFlavor): Session {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(bus);

  // Reverb (generated-noise convolver).
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, f === "gallery" ? 2.6 : 3.2, 3);
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  reverb.connect(wet).connect(out);

  // Dry path with a gentle low-pass to keep everything soft.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = f === "gallery" ? 5000 : 2600;
  tone.Q.value = 0.3;
  const dry = ctx.createGain();
  dry.gain.value = 0.7;
  dry.connect(tone);
  tone.connect(out);
  tone.connect(reverb);

  // Soft feedback echo for melody notes.
  const echoIn = ctx.createGain();
  echoIn.gain.value = 0.22;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = STEP_SECONDS * 1.5;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 1800;
  echoIn.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(feedback).connect(delay);
  echoTone.connect(reverb);
  echoTone.connect(out);

  const now = ctx.currentTime;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(1, now + 3);

  const palette = paletteForRegion(region);
  const shape = shapeMusic(palette, moodFromEnv(environment));
  tone.frequency.value = brightnessFor(f, shape);
  const s: Session = {
    ctx,
    out,
    dry,
    echoIn,
    tone,
    flavor: f,
    palette,
    prevPalette: palette,
    transitionStart: now - TRANSITION_SECONDS,
    shape,
    stepSeconds: shape.stepSeconds,
    transpose: shape.transpose,
    lastTickTime: now,
    timer: setInterval(() => tick(s), TICK_MS),
    nextStepTime: now + 0.1,
    step: 0,
    progression: PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)],
    chordIndex: 0,
    melodyIndex: 2 + Math.floor(Math.random() * 3),
    restingPhrase: false,
    nodes: [out, reverb, wet, tone, dry, echoIn, delay, feedback, echoTone],
  };
  return s;
}

function brightnessFor(f: MusicFlavor, shape: MusicShape): number {
  return Math.min(6000, shape.brightness * (f === "gallery" ? 1.5 : 1));
}

function tick(s: Session): void {
  const { ctx } = s;
  if (ctx.state !== "running") return;
  const dt = Math.min(0.5, Math.max(0, ctx.currentTime - s.lastTickTime));
  s.lastTickTime = ctx.currentTime;
  // Mood (night / rain) and region shape the arrangement; glide tempo and tone.
  s.shape = shapeMusic(s.palette, moodFromEnv(environment));
  s.stepSeconds = smoothToward(s.stepSeconds, s.shape.stepSeconds, dt, 4);
  s.tone.frequency.setTargetAtTime(brightnessFor(s.flavor, s.shape), ctx.currentTime, 2);
  // If timers were throttled, skip ahead rather than bursting notes.
  if (s.nextStepTime < ctx.currentTime - 0.2) s.nextStepTime = ctx.currentTime + 0.05;
  while (s.nextStepTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
    scheduleStep(s, s.step, s.nextStepTime);
    s.nextStepTime += s.stepSeconds;
    s.step++;
  }
}

/** Which instrument plays the next note (blends old → new during a transition). */
function noteInstrument(s: Session, t: number): MusicInstrument {
  const mix = transitionMix(t - s.transitionStart, TRANSITION_SECONDS);
  const inst = Math.random() < mix ? s.palette.instrument : s.prevPalette.instrument;
  if (s.flavor === "gallery" && Math.random() < 0.45) return "musicbox";
  return inst;
}

/** The palette whose scale/pads lead right now. */
function leadPalette(s: Session, t: number): MusicPalette {
  return transitionMix(t - s.transitionStart, TRANSITION_SECONDS) >= 0.5 ? s.palette : s.prevPalette;
}

function scheduleStep(s: Session, step: number, t: number): void {
  const inChord = step % STEPS_PER_CHORD;
  const lead = leadPalette(s, t);
  if (inChord === 0) {
    if (step > 0) {
      s.chordIndex = (s.chordIndex + 1) % s.progression.length;
      if (s.chordIndex === 0 && Math.random() < 0.35) {
        s.progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
      }
    }
    // Register changes (night lullaby voicing) only at chord boundaries.
    s.transpose = s.shape.transpose;
    // Generous pauses: some chords have no melody at all.
    s.restingPhrase = Math.random() < s.shape.restChance;
    playPadChord(s, s.progression[s.chordIndex], t, lead);
    if (lead.arpeggio && Math.random() < 0.6 * Math.min(1, s.shape.density + 0.2)) {
      playArpeggio(s, s.progression[s.chordIndex], t + s.stepSeconds * 2);
    }
  }
  if (s.restingPhrase) return;
  // Leave the first beat of each chord to the pad, and rest near the end.
  if (inChord < 2 || inChord > 13) return;
  const strong = inChord % 2 === 0;
  const base = s.flavor === "gallery" ? (strong ? 0.26 : 0.08) : strong ? 0.2 : 0.06;
  const chance = base * s.shape.density;
  if (Math.random() > chance) return;
  const midi = chooseMelodyNote(s, strong, lead.scale) + s.transpose;
  playMelodyNote(s, midi, t, noteInstrument(s, t));
}

function chooseMelodyNote(s: Session, strong: boolean, scale: number[]): number {
  const chord = s.progression[s.chordIndex];
  if (s.melodyIndex >= scale.length) s.melodyIndex = Math.floor(scale.length / 2);
  const candidates: Array<{ i: number; w: number }> = [];
  for (let d = -2; d <= 2; d++) {
    const i = s.melodyIndex + d;
    if (i < 0 || i >= scale.length) continue;
    const pc = scale[i] % 12;
    let w = d === 0 ? 0.6 : Math.abs(d) === 1 ? 1.4 : 0.7;
    if (strong && CHORD_PCS[chord].includes(pc)) w *= 2;
    candidates.push({ i, w });
  }
  const total = candidates.reduce((a, c) => a + c.w, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.w;
    if (r <= 0) {
      s.melodyIndex = c.i;
      break;
    }
  }
  // Drift back toward the middle of the range.
  if (s.melodyIndex <= 0 || s.melodyIndex >= scale.length - 1) s.melodyIndex = Math.floor(scale.length / 2) - 1;
  return scale[s.melodyIndex];
}

function track(_s: Session, osc: OscillatorNode, ...extra: AudioNode[]): void {
  osc.onended = () => {
    osc.disconnect();
    for (const n of extra) n.disconnect();
  };
}

function playPadChord(s: Session, name: keyof typeof CHORDS, t: number, lead: MusicPalette): void {
  const { ctx } = s;
  const dur = s.stepSeconds * STEPS_PER_CHORD;
  const level = s.shape.padLevel * (s.flavor === "gallery" ? 0.65 : 1);
  const types: OscillatorType[] = s.flavor === "gallery" ? ["sine"] : lead.padTypes;
  const attack = lead.instrument === "pad" ? 3.5 : 2.5;
  for (const note of CHORDS[name]) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setValueAtTime(level, t + dur - 0.5);
    env.gain.linearRampToValueAtTime(0, t + dur + 3);
    env.connect(s.dry);
    types.forEach((type, k) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(note);
      osc.detune.value = k === 0 ? rand(-4, 4) : rand(5, 9) * (Math.random() < 0.5 ? -1 : 1);
      osc.connect(env);
      osc.start(t);
      osc.stop(t + dur + 3.1);
      track(s, osc, ...(k === types.length - 1 ? [env] : []));
    });
  }
}

/** Harp-style rolled chord (lake / coast / lily pond). */
function playArpeggio(s: Session, name: keyof typeof CHORDS, t: number): void {
  const pcs = CHORD_PCS[name];
  const notes = pcs.map((pc) => 60 + pc).concat([72 + pcs[0]]).sort((a, b) => a - b);
  notes.forEach((m, i) => playHarp(s, m + s.transpose, t + i * 0.13, 0.5));
}

function voiceOut(s: Session, t: number, peak: number, attack: number, end: number): GainNode {
  const env = s.ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0006, end);
  env.connect(s.dry);
  env.connect(s.echoIn);
  return env;
}

function osc(s: Session, type: OscillatorType, f: number, t: number, end: number, into: AudioNode, detune = 0, ...extra: AudioNode[]): OscillatorNode {
  const o = s.ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.connect(into);
  o.start(t);
  o.stop(end + 0.05);
  track(s, o, ...extra);
  return o;
}

function playHarp(s: Session, midi: number, t: number, gain = 1): void {
  const f = mtof(midi);
  const peak = s.shape.melodyLevel * 0.9 * gain;
  const end = t + 2;
  const env = voiceOut(s, t, peak, 0.004, end);
  const lp = s.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(800, t + 0.8);
  lp.connect(env);
  osc(s, "triangle", f, t, end, lp, rand(-3, 3), lp, env);
  const g = s.ctx.createGain();
  g.gain.value = 0.3;
  g.connect(env);
  osc(s, "sine", f * 2, t, end, g, 0, g);
}

function playMelodyNote(s: Session, midi: number, t: number, instrument: MusicInstrument): void {
  const { ctx } = s;
  const level = s.shape.melodyLevel;
  switch (instrument) {
    case "musicbox": {
      // Music box: bright sine + inharmonic tine partial, quick attack, long decay.
      const f = mtof(midi + 12);
      const env = voiceOut(s, t, Math.min(0.05, level), 0.005, t + 2.2);
      const partials: Array<[number, number]> = [
        [1, 1],
        [4.02, 0.12],
        [2, 0.18],
      ];
      partials.forEach(([mult, g], k) => {
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(g, t);
        if (mult > 2) pg.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
        pg.connect(env);
        osc(s, "sine", f * mult, t, t + 2.25, pg, 0, pg, ...(k === 0 ? [env] : []));
      });
      return;
    }
    case "marimba": {
      const f = mtof(midi);
      const end = t + 1;
      const env = voiceOut(s, t, level, 0.003, end);
      osc(s, "sine", f, t, end, env, rand(-3, 3), env);
      const bar = ctx.createGain();
      bar.gain.setValueAtTime(0.28, t);
      bar.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      bar.connect(env);
      osc(s, "sine", f * 3.93, t, t + 0.2, bar, 0, bar);
      const low = ctx.createGain();
      low.gain.value = 0.35;
      low.connect(env);
      osc(s, "sine", f / 2, t, end, low, 0, low);
      // Sometimes a soft repeated "grace" note, like a mallet roll.
      if (Math.random() < 0.2) playMelodyNoteSoft(s, midi, t + s.stepSeconds / 2);
      return;
    }
    case "flute": {
      const f = mtof(midi);
      const end = t + 2.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(level, t + 0.14);
      env.gain.setValueAtTime(level * 0.85, t + 0.9);
      env.gain.exponentialRampToValueAtTime(0.0006, end);
      env.connect(s.dry);
      env.connect(s.echoIn);
      const o = osc(s, "sine", f, t, end, env, 0, env);
      // Gentle delayed vibrato.
      const vib = ctx.createOscillator();
      vib.frequency.value = 5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(12, t + 0.6);
      vib.connect(depth).connect(o.detune);
      vib.start(t);
      vib.stop(end);
      vib.onended = () => {
        vib.disconnect();
        depth.disconnect();
      };
      const tri = ctx.createGain();
      tri.gain.value = 0.18;
      tri.connect(env);
      osc(s, "triangle", f, t, end, tri, 3, tri);
      // Breath at the start of the note.
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, "white");
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * 2;
      bp.Q.value = 3;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(level * 0.12, t + 0.05);
      ng.gain.exponentialRampToValueAtTime(0.0003, t + 0.3);
      n.connect(bp).connect(ng).connect(s.dry);
      n.start(t, Math.random());
      n.stop(t + 0.35);
      n.onended = () => {
        n.disconnect();
        bp.disconnect();
        ng.disconnect();
      };
      return;
    }
    case "harp":
      playHarp(s, midi, t);
      return;
    case "pad": {
      // Airy mountain voice: slow swell of two detuned sines.
      const f = mtof(midi);
      const end = t + 4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(level, t + 0.9);
      env.gain.setValueAtTime(level, t + 1.6);
      env.gain.exponentialRampToValueAtTime(0.0006, end);
      env.connect(s.dry);
      env.connect(s.echoIn);
      osc(s, "sine", f, t, end, env, -6, env);
      osc(s, "sine", f, t, end, env, 6);
      return;
    }
    default:
      playSoft(s, midi, t, level);
  }
}

function playMelodyNoteSoft(s: Session, midi: number, t: number): void {
  const f = mtof(midi);
  const env = voiceOut(s, t, s.shape.melodyLevel * 0.4, 0.003, t + 0.6);
  osc(s, "sine", f, t, t + 0.6, env, 0, env);
}

/** The original "paper" melody voice: soft triangle + sine. */
function playSoft(s: Session, midi: number, t: number, peak: number): void {
  const { ctx } = s;
  const f = mtof(midi);
  const env = ctx.createGain();
  env.connect(s.dry);
  env.connect(s.echoIn);
  const attack = rand(0.04, 0.08);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + attack);
  env.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.6);
  env.gain.exponentialRampToValueAtTime(0.0006, t + 3);
  osc(s, "triangle", f, t, t + 3.05, env, rand(-3, 3), env);
  osc(s, "sine", f, t, t + 3.05, env, rand(4, 7));
}

function endSession(s: Session, fadeSeconds: number): void {
  clearInterval(s.timer);
  const now = s.ctx.currentTime;
  s.out.gain.cancelScheduledValues(now);
  s.out.gain.setValueAtTime(s.out.gain.value, now);
  s.out.gain.linearRampToValueAtTime(0, now + fadeSeconds);
  setTimeout(() => {
    for (const n of s.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, (fadeSeconds + 4) * 1000);
}

function begin(): void {
  if (session || !wanted) return;
  const ctx = getAudioContext();
  const bus = getMusicBus();
  if (!ctx || !bus) return;
  session = buildSession(ctx, bus, flavor);
}

/** Start the background music (waits for unlockAudio() if needed). */
export function startMusic(): void {
  wanted = true;
  if (session) return;
  if (getAudioContext()) {
    begin();
  } else if (!unsubscribeUnlock) {
    unsubscribeUnlock = onAudioUnlocked(() => {
      unsubscribeUnlock = null;
      begin();
    });
  }
}

/** Fade out and stop the music. */
export function stopMusic(): void {
  wanted = false;
  unsubscribeUnlock?.();
  unsubscribeUnlock = null;
  if (session) {
    endSession(session, 1.5);
    session = null;
  }
}

export function isMusicPlaying(): boolean {
  return session !== null;
}

/** Switch timbre/arrangement: "paper" (soft) or "gallery" (music box). Crossfades if playing. */
export function setMusicFlavor(f: MusicFlavor): void {
  if (f === flavor) return;
  flavor = f;
  if (session) {
    endSession(session, 2.5);
    session = null;
    begin();
  }
}

export function getMusicFlavor(): MusicFlavor {
  return flavor;
}

/**
 * Let the music follow the player's region (instrument palette, scale, tempo).
 * Call when the player's region changes; repeated calls with the same region
 * are free. The change blends in over ~8 s, never abruptly. Pass null for the
 * neutral "soft" palette.
 */
export function setMusicRegion(next: RegionKind | null): void {
  if (next === region) return;
  region = next;
  const s = session;
  if (!s) return;
  const palette = paletteForRegion(next);
  if (palette.instrument === s.palette.instrument) return;
  const t = s.ctx.currentTime;
  // If a transition is still in progress, start the new one from whatever leads now.
  s.prevPalette = leadPalette(s, t);
  s.palette = palette;
  s.transitionStart = t;
}

export function getMusicRegion(): RegionKind | null {
  return region;
}

/** The instrument palette currently targeted (for debugging). */
export function getMusicInstrument(): MusicInstrument {
  return session?.palette.instrument ?? paletteForRegion(region).instrument;
}
