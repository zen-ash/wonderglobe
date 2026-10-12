// Small, soft, synthesized sound effects (no audio files needed).

import { getAudioContext, getSfxBus } from "./engine";
import { bell, makeOut, noise, rand, tone, type Kit } from "./kit";

export type SfxName =
  | "pop"
  | "chime"
  | "rustle"
  | "boing"
  | "sparkle"
  | "whoosh"
  | "splash"
  | "click"
  | "error"
  | "stamp"
  | "note"
  | "step"
  | "sticker"
  | "camera"
  | "ribbon"
  | "cheer"
  | "plane"
  | "unfold"
  | "rain-start"
  | "rainbow"
  | "pat"
  | "jump"
  | "found"
  | "guide";

export interface SfxOptions {
  /** 0..1 multiplier (default 1). */
  volume?: number;
  /** Pitch multiplier (default 1; e.g. 1.2 = higher). */
  pitch?: number;
  /** Stereo position -1 (left) .. 1 (right), default centre. */
  pan?: number;
}

const MIN_INTERVAL_MS: Partial<Record<SfxName, number>> = {
  step: 110,
  sparkle: 120,
  rustle: 90,
  click: 40,
  pat: 90,
  jump: 150,
  cheer: 400,
  camera: 300,
  "rain-start": 3000,
  rainbow: 1500,
  guide: 600,
};
const DEFAULT_INTERVAL_MS = 60;
/** Long enough for the longest recipe to ring out before its output stage is disconnected. */
const SFX_LIFETIME_SECONDS = 3.5;
const lastPlayed = new Map<SfxName, number>();

const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2];

const RECIPES: Record<SfxName, (k: Kit) => void> = {
  pop(k) {
    tone(k, { from: 880, to: 280, glide: 0.09, peak: 0.35, decay: 0.12 });
    noise(k, { type: "highpass", freq: 2500, peak: 0.05, decay: 0.03 });
  },
  chime(k) {
    const notes = [1318.5, 1975.5];
    notes.forEach((f, i) => {
      const at = k.t + i * 0.09;
      tone(k, { from: f, peak: 0.16, attack: 0.004, decay: 1.1, at });
      tone(k, { from: f * 2.76, peak: 0.025, attack: 0.002, decay: 0.3, at });
    });
  },
  rustle(k) {
    for (let i = 0; i < 4; i++) {
      noise(k, {
        type: "bandpass",
        freq: 2400 + Math.random() * 2200,
        q: 1.2,
        peak: 0.06 + Math.random() * 0.04,
        attack: 0.01,
        decay: 0.06 + Math.random() * 0.05,
        at: k.t + i * 0.055 + Math.random() * 0.02,
      });
    }
  },
  boing(k) {
    const osc = tone(k, { type: "triangle", from: 180, to: 420, glide: 0.25, peak: 0.28, attack: 0.01, decay: 0.45 });
    const lfo = k.ctx.createOscillator();
    const depth = k.ctx.createGain();
    lfo.frequency.value = 14;
    depth.gain.setValueAtTime(40 * k.pitch, k.t);
    depth.gain.exponentialRampToValueAtTime(1, k.t + 0.45);
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(k.t);
    lfo.stop(k.t + 0.5);
    lfo.onended = () => {
      lfo.disconnect();
      depth.disconnect();
    };
  },
  sparkle(k) {
    const base = 1046.5;
    for (let i = 0; i < 5; i++) {
      const ratio = PENTA[Math.min(PENTA.length - 1, i + Math.floor(Math.random() * 3))];
      tone(k, { from: base * ratio, peak: 0.07, attack: 0.003, decay: 0.35, at: k.t + i * 0.06 });
    }
  },
  whoosh(k) {
    noise(k, { type: "bandpass", freq: 350, freqTo: 1800, q: 1.4, peak: 0.16, attack: 0.18, decay: 0.4 });
  },
  splash(k) {
    noise(k, { type: "lowpass", freq: 2600, freqTo: 500, q: 0.6, peak: 0.2, attack: 0.01, decay: 0.45 });
    for (let i = 0; i < 3; i++) {
      tone(k, {
        from: 500 + Math.random() * 400,
        to: 1100 + Math.random() * 500,
        glide: 0.06,
        peak: 0.06,
        decay: 0.08,
        at: k.t + 0.08 + i * 0.07 + Math.random() * 0.03,
      });
    }
  },
  click(k) {
    tone(k, { from: 1800, to: 1200, glide: 0.02, peak: 0.12, attack: 0.001, decay: 0.03 });
  },
  error(k) {
    // Gentle "uh-oh", not a harsh buzzer.
    tone(k, { type: "triangle", from: 392, peak: 0.16, attack: 0.01, decay: 0.22 });
    tone(k, { type: "triangle", from: 311, peak: 0.16, attack: 0.01, decay: 0.35, at: k.t + 0.16 });
  },
  stamp(k) {
    tone(k, { from: 150, to: 55, glide: 0.12, peak: 0.4, attack: 0.002, decay: 0.2 });
    noise(k, { type: "lowpass", freq: 900, peak: 0.12, attack: 0.002, decay: 0.08 });
  },
  note(k) {
    // Sticky note slapped onto paper.
    noise(k, { type: "highpass", freq: 1500, peak: 0.1, attack: 0.002, decay: 0.05 });
    tone(k, { from: 520, to: 340, glide: 0.06, peak: 0.12, attack: 0.003, decay: 0.08 });
  },
  step(k) {
    noise(k, { type: "lowpass", freq: 600 + Math.random() * 300, peak: 0.035, attack: 0.004, decay: 0.05 });
  },
  sticker(k) {
    // Happy reward jingle: a quick rising arpeggio landing on a bright bell, then a twinkle.
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => {
      const at = k.t + i * 0.075;
      tone(k, { type: "triangle", from: f / 2, peak: 0.07, attack: 0.004, decay: 0.22, at });
      bell(k, f, i === notes.length - 1 ? 0.13 : 0.08, i === notes.length - 1 ? 0.9 : 0.3, at);
    });
    for (let i = 0; i < 3; i++) {
      tone(k, { from: 2637 * [1, 1.25, 1.5][i], peak: 0.03, attack: 0.002, decay: 0.25, at: k.t + 0.38 + i * 0.05 });
    }
  },
  camera(k) {
    // Shutter: two soft clicks …
    [0, 0.075].forEach((d, i) => {
      noise(k, { type: "highpass", freq: 2800, peak: 0.1, attack: 0.001, decay: 0.025, at: k.t + d });
      tone(k, { from: i === 0 ? 1500 : 1100, to: 700, glide: 0.03, peak: 0.08, attack: 0.001, decay: 0.035, at: k.t + d });
    });
    // … then the photo flutters out like paper.
    noise(k, { type: "bandpass", freq: 1800, freqTo: 3200, q: 1.3, peak: 0.07, attack: 0.05, hold: 0.15, decay: 0.2, at: k.t + 0.16, am: { rate: 23, depth: 0.85, type: "square" } });
  },
  ribbon(k) {
    // Snip-snip of scissors …
    [0, 0.09].forEach((d) => {
      noise(k, { type: "highpass", freq: 4200, peak: 0.12, attack: 0.001, decay: 0.035, at: k.t + d });
      tone(k, { from: 2600, to: 1900, glide: 0.02, peak: 0.05, attack: 0.001, decay: 0.03, at: k.t + d });
    });
    // … and a little cheer.
    RECIPES.cheer({ ...k, t: k.t + 0.22 });
  },
  cheer(k) {
    // A tiny crowd shouting "yay": chirpy rising blips plus a soft vowel swell.
    noise(k, { type: "bandpass", freq: 900, freqTo: 1300, q: 2.5, peak: 0.035, attack: 0.08, hold: 0.15, decay: 0.35 });
    for (let i = 0; i < 7; i++) {
      const base = rand(520, 950);
      const at = k.t + rand(0, 0.22);
      tone(k, {
        type: i % 2 ? "triangle" : "sine",
        from: base,
        curve: [
          [0.07, base * 1.45],
          [0.2, base * 1.3],
        ],
        peak: 0.045,
        attack: 0.015,
        hold: 0.06,
        decay: 0.18,
        at,
        vibrato: { rate: rand(7, 10), depth: 25 },
      });
    }
  },
  plane(k) {
    // Paper plane gliding past: an airy whoosh rising then falling, with a faint whistle.
    noise(k, { type: "bandpass", freq: 500, freqTo: 2200, q: 1.6, peak: 0.12, attack: 0.25, decay: 0.15 });
    noise(k, { type: "bandpass", freq: 2200, freqTo: 700, q: 1.6, peak: 0.1, attack: 0.01, decay: 0.45, at: k.t + 0.38 });
    tone(k, { from: 900, curve: [[0.35, 1300], [0.8, 950]], peak: 0.02, attack: 0.2, hold: 0.2, decay: 0.4 });
  },
  unfold(k) {
    // Paper crinkle: a scatter of tiny bright crackles over a soft fwump.
    noise(k, { type: "lowpass", freq: 700, peak: 0.06, attack: 0.04, decay: 0.3, color: "pink" });
    for (let i = 0; i < 11; i++) {
      noise(k, {
        type: "bandpass",
        freq: rand(2200, 6500),
        q: rand(1.5, 4),
        peak: rand(0.03, 0.08),
        attack: 0.002,
        decay: rand(0.012, 0.035),
        at: k.t + rand(0, 0.5),
      });
    }
  },
  "rain-start"(k) {
    // A hush of rain arriving with a few first drops.
    noise(k, { type: "highpass", freq: 1500, peak: 0.05, attack: 0.9, decay: 1.4, color: "pink" });
    for (let i = 0; i < 6; i++) {
      const f = rand(1700, 3200);
      tone(k, { from: f, to: f * 1.6, glide: 0.03, peak: 0.04, attack: 0.002, decay: 0.05, at: k.t + 0.1 + i * rand(0.12, 0.3) });
    }
  },
  rainbow(k) {
    // Sparkly rising pentatonic arpeggio with a shimmer on top.
    const base = 784;
    for (let i = 0; i < 9; i++) {
      const f = base * PENTA[i % PENTA.length] * (i >= PENTA.length ? 2 : 1);
      bell(k, f, 0.06, 0.7, k.t + i * 0.07, [[2.76, 0.1], [4.1, 0.05]]);
    }
    for (let i = 0; i < 5; i++) {
      tone(k, { from: rand(3000, 4600), peak: 0.018, attack: 0.002, decay: 0.3, at: k.t + 0.55 + i * 0.06 });
    }
  },
  pat(k) {
    // Soft "boop" of patting a friend.
    tone(k, { from: 560, to: 380, glide: 0.1, peak: 0.16, attack: 0.006, decay: 0.14 });
    tone(k, { type: "triangle", from: 190, to: 150, glide: 0.1, peak: 0.08, attack: 0.004, decay: 0.1 });
  },
  jump(k) {
    // Springy "boyoing" (shorter and lighter than boing).
    tone(k, { type: "triangle", from: 230, to: 700, glide: 0.18, peak: 0.13, attack: 0.008, decay: 0.24, vibrato: { rate: 16, depth: 60 } });
    tone(k, { from: 460, to: 1400, glide: 0.16, peak: 0.03, attack: 0.008, decay: 0.18 });
  },
  found(k) {
    // Short discovery fanfare: da-da-daaa!
    const seq: Array<[number, number, number]> = [
      [784, 0, 0.12],
      [1046.5, 0.11, 0.12],
      [1318.5, 0.22, 0.6],
    ];
    for (const [f, d, len] of seq) {
      tone(k, { type: "triangle", from: f, peak: 0.1, attack: 0.008, hold: len * 0.4, decay: len, at: k.t + d, vibrato: len > 0.3 ? { rate: 6, depth: 12 } : undefined });
      tone(k, { type: "sine", from: f * 2, peak: 0.03, attack: 0.005, decay: len * 0.6, at: k.t + d });
    }
    bell(k, 2637, 0.04, 0.8, k.t + 0.24);
  },
  guide(k) {
    // The snail guide's little "hmm-hm!" hum.
    tone(k, {
      type: "triangle",
      from: 330,
      curve: [[0.18, 370], [0.3, 350]],
      peak: 0.09,
      attack: 0.05,
      hold: 0.12,
      decay: 0.2,
      vibrato: { rate: 5.5, depth: 18 },
      filter: { type: "lowpass", freq: 1200 },
    });
    tone(k, {
      type: "triangle",
      from: 392,
      to: 440,
      glide: 0.15,
      peak: 0.09,
      attack: 0.04,
      hold: 0.08,
      decay: 0.3,
      at: k.t + 0.36,
      vibrato: { rate: 5.5, depth: 18 },
      filter: { type: "lowpass", freq: 1300 },
    });
  },
};

/** Play a soft synthesized effect. No-op until audio is unlocked or for unknown names; throttles rapid repeats. */
export function playSfx(name: SfxName, opts: SfxOptions = {}): void {
  const recipe = Object.prototype.hasOwnProperty.call(RECIPES, name) ? RECIPES[name] : undefined;
  if (!recipe) return;
  const ctx = getAudioContext();
  const bus = getSfxBus();
  if (!ctx || !bus || ctx.state !== "running") return;
  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = lastPlayed.get(name) ?? -Infinity;
  if (nowMs - last < (MIN_INTERVAL_MS[name] ?? DEFAULT_INTERVAL_MS)) return;
  lastPlayed.set(name, nowMs);

  const out = makeOut(ctx, bus, opts.volume ?? 1, opts.pan ?? 0, SFX_LIFETIME_SECONDS);
  const pitch = Math.min(3, Math.max(0.3, opts.pitch ?? 1)) * (1 + (Math.random() - 0.5) * 0.04);
  try {
    recipe({ ctx, out, t: ctx.currentTime + 0.005, pitch });
  } catch {
    /* never let a sound effect break the game */
  }
}

/** Whether `name` is a known effect (handy for string-typed callers). */
export function isSfxName(name: string): name is SfxName {
  return Object.prototype.hasOwnProperty.call(RECIPES, name);
}

/** A short cute "blip-blip" used when no generated animal sound is available. */
export function playBlip(seed = 0, voice: "small" | "big" | "bright" | "calm" | "silly" = "calm"): void {
  const ctx = getAudioContext();
  const bus = getSfxBus();
  if (!ctx || !bus || ctx.state !== "running") return;
  const out = makeOut(ctx, bus, 0.9, 0, 1.2);
  const base = { small: 900, bright: 700, calm: 480, silly: 560, big: 260 }[voice] * (1 + ((seed % 7) - 3) * 0.03);
  const k: Kit = { ctx, out, t: ctx.currentTime + 0.005, pitch: 1 };
  const type: OscillatorType = voice === "silly" ? "square" : voice === "big" ? "triangle" : "sine";
  const peak = type === "square" ? 0.05 : 0.18;
  tone(k, { type, from: base, to: base * 1.35, glide: 0.08, peak, attack: 0.008, decay: 0.12 });
  tone(k, { type, from: base * 1.2, to: base * (voice === "big" ? 0.8 : 1.6), glide: 0.1, peak, attack: 0.008, decay: 0.16, at: k.t + 0.14 });
}
