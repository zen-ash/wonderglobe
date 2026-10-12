// Cute synthesized creature calls (meow, woof, tweet, ribbit, quack, moo …)
// and soft footsteps. All on the sfx bus, throttled and voice-limited.

import type { GroundType } from "@/core/types";
import { KIND_BY_ID } from "@/core/kinds";
import { getAudioContext, getSfxBus } from "./engine";
import { bell, makeOut, noise, pick, rand, tone, type Kit } from "./kit";
import {
  activeVoices,
  creatureFamily,
  footstepVolume,
  CREATURE_MIN_INTERVAL_MS,
  FOOTSTEP_MIN_INTERVAL_MS,
  MAX_CREATURE_VOICES,
  Throttle,
  voicePitch,
  type CreatureFamily,
} from "./logic";

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- creature calls

/** Each recipe plays the call and returns its length in seconds. */
const CALLS: Record<CreatureFamily, (k: Kit) => number> = {
  meow(k) {
    tone(k, {
      type: "triangle",
      from: 620,
      curve: [
        [0.12, 900],
        [0.42, 540],
      ],
      peak: 0.12,
      attack: 0.03,
      hold: 0.15,
      decay: 0.25,
      vibrato: { rate: 6, depth: 15 },
      filter: { type: "bandpass", freq: 1300, freqTo: 800, q: 1.2 },
    });
    return 0.5;
  },
  woof(k) {
    [0, 0.2].forEach((d) => {
      tone(k, { type: "triangle", from: 540, to: 330, glide: 0.09, peak: 0.16, attack: 0.008, decay: 0.12, at: k.t + d, filter: { type: "lowpass", freq: 1600 } });
      noise(k, { type: "bandpass", freq: 900, q: 1.5, peak: 0.04, attack: 0.004, decay: 0.05, at: k.t + d });
    });
    return 0.4;
  },
  yip(k) {
    [0, 0.14].forEach((d) =>
      tone(k, { type: "triangle", from: 900, curve: [[0.04, 1350], [0.1, 800]], peak: 0.1, attack: 0.005, decay: 0.1, at: k.t + d }),
    );
    return 0.3;
  },
  tweet(k) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = rand(2500, 3200);
      tone(k, { from: f, to: f * rand(1.2, 1.45), glide: 0.05, peak: 0.07, attack: 0.004, decay: 0.07, at: k.t + i * 0.1 });
    }
    return n * 0.1 + 0.1;
  },
  hoot(k) {
    [0, 0.42].forEach((d, i) =>
      tone(k, { from: i ? 400 : 430, to: i ? 370 : 410, glide: 0.3, peak: 0.12, attack: 0.06, hold: 0.12, decay: 0.25, at: k.t + d, filter: { type: "lowpass", freq: 900 } }),
    );
    return 0.9;
  },
  ribbit(k) {
    [
      [0, 0.09, 260],
      [0.13, 0.07, 300],
    ].forEach(([d, len, f]) =>
      tone(k, {
        type: "triangle",
        from: f,
        to: f * 1.15,
        glide: len,
        peak: 0.13,
        attack: 0.01,
        hold: len * 0.5,
        decay: len,
        at: k.t + d,
        am: { rate: 34, depth: 0.85 },
        filter: { type: "lowpass", freq: 1300 },
      }),
    );
    return 0.35;
  },
  quack(k) {
    [0, 0.2].forEach((d) =>
      tone(k, {
        type: "sawtooth",
        from: 440,
        to: 340,
        glide: 0.12,
        peak: 0.07,
        attack: 0.01,
        decay: 0.13,
        at: k.t + d,
        filter: { type: "bandpass", freq: 1100, q: 3.5 },
        am: { rate: 42, depth: 0.3 },
      }),
    );
    return 0.4;
  },
  honk(k) {
    tone(k, { type: "sawtooth", from: 380, to: 330, glide: 0.3, peak: 0.07, attack: 0.02, hold: 0.12, decay: 0.2, filter: { type: "bandpass", freq: 950, q: 3 } });
    return 0.4;
  },
  moo(k) {
    tone(k, {
      type: "sawtooth",
      from: 150,
      curve: [
        [0.3, 178],
        [0.9, 128],
      ],
      peak: 0.1,
      attack: 0.12,
      hold: 0.4,
      decay: 0.45,
      filter: { type: "lowpass", freq: 450, freqTo: 900, q: 2 },
      vibrato: { rate: 5, depth: 12 },
    });
    return 1;
  },
  baa(k) {
    tone(k, {
      type: "sawtooth",
      from: 390,
      to: 360,
      glide: 0.5,
      peak: 0.07,
      attack: 0.03,
      hold: 0.25,
      decay: 0.25,
      vibrato: { rate: 8, depth: 70 },
      filter: { type: "bandpass", freq: 1300, q: 1.4 },
    });
    return 0.6;
  },
  oink(k) {
    [0, 0.17].forEach((d) =>
      tone(k, {
        type: "triangle",
        from: 320,
        to: 230,
        glide: 0.1,
        peak: 0.12,
        attack: 0.01,
        decay: 0.11,
        at: k.t + d,
        am: { rate: 48, depth: 0.7 },
        filter: { type: "lowpass", freq: 1000 },
      }),
    );
    return 0.35;
  },
  cluck(k) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      tone(k, { type: "triangle", from: 720, to: 460, glide: 0.05, peak: 0.09, attack: 0.004, decay: 0.05, at: k.t + i * 0.09, filter: { type: "bandpass", freq: 1200, q: 1.5 } });
    }
    return n * 0.09 + 0.1;
  },
  neigh(k) {
    tone(k, {
      type: "sawtooth",
      from: 700,
      curve: [
        [0.1, 1000],
        [0.65, 560],
      ],
      peak: 0.06,
      attack: 0.03,
      hold: 0.3,
      decay: 0.3,
      vibrato: { rate: 12, depth: 110 },
      filter: { type: "bandpass", freq: 1400, q: 1.6 },
    });
    return 0.7;
  },
  buzz(k) {
    tone(k, {
      type: "sawtooth",
      from: 230,
      to: 250,
      glide: 0.4,
      peak: 0.045,
      attack: 0.05,
      hold: 0.25,
      decay: 0.2,
      vibrato: { rate: 6, depth: 45 },
      filter: { type: "lowpass", freq: 900, q: 1.5 },
    });
    return 0.55;
  },
  roar(k) {
    // A small, friendly "rawr".
    tone(k, {
      type: "sawtooth",
      from: 210,
      curve: [
        [0.15, 270],
        [0.55, 160],
      ],
      peak: 0.09,
      attack: 0.04,
      hold: 0.2,
      decay: 0.3,
      vibrato: { rate: 18, depth: 45 },
      filter: { type: "lowpass", freq: 800, freqTo: 420, q: 1.2 },
    });
    noise(k, { type: "lowpass", freq: 600, peak: 0.03, attack: 0.04, hold: 0.15, decay: 0.25, color: "pink" });
    return 0.6;
  },
  trumpet(k) {
    tone(k, {
      type: "sawtooth",
      from: 480,
      curve: [
        [0.15, 720],
        [0.55, 640],
      ],
      peak: 0.06,
      attack: 0.04,
      hold: 0.25,
      decay: 0.25,
      vibrato: { rate: 7, depth: 30 },
      filter: { type: "bandpass", freq: 1500, q: 1.8 },
    });
    return 0.6;
  },
  squeak(k) {
    [0, 0.1].forEach((d) => tone(k, { from: 1800, to: 2500, glide: 0.05, peak: 0.07, attack: 0.004, decay: 0.06, at: k.t + d }));
    return 0.25;
  },
  robot(k) {
    [880, 660, 1320].forEach((f, i) =>
      tone(k, { type: "square", from: f, peak: 0.035, attack: 0.004, hold: 0.05, decay: 0.04, at: k.t + i * 0.11, filter: { type: "lowpass", freq: 2200 } }),
    );
    return 0.4;
  },
  engine(k) {
    // Toy "putt-putt" then a "beep beep".
    tone(k, { type: "triangle", from: 75, peak: 0.1, attack: 0.02, hold: 0.15, decay: 0.1, am: { rate: 13, depth: 0.9 }, filter: { type: "lowpass", freq: 500 } });
    [0.2, 0.36].forEach((d) =>
      tone(k, { type: "square", from: 520, peak: 0.035, attack: 0.005, hold: 0.06, decay: 0.05, at: k.t + d, filter: { type: "lowpass", freq: 1800 } }),
    );
    return 0.5;
  },
  toot(k) {
    for (const f of [587, 740]) {
      tone(k, { from: f, peak: 0.06, attack: 0.05, hold: 0.3, decay: 0.3, vibrato: { rate: 5, depth: 8 }, filter: { type: "lowpass", freq: 1600 } });
    }
    return 0.7;
  },
  ring(k) {
    bell(k, 2350, 0.07, 0.5, k.t);
    bell(k, 2350, 0.06, 0.6, k.t + 0.13);
    return 0.8;
  },
  zoom(k) {
    noise(k, { type: "bandpass", freq: 600, freqTo: 2400, q: 1.4, peak: 0.08, attack: 0.15, decay: 0.3 });
    tone(k, { from: 500, to: 1100, glide: 0.4, peak: 0.03, attack: 0.1, decay: 0.3 });
    return 0.5;
  },
  blub(k) {
    for (let i = 0; i < 3; i++) {
      const f = rand(280, 420);
      tone(k, { from: f, to: f * 2.6, glide: 0.06, peak: 0.08, attack: 0.004, decay: 0.07, at: k.t + i * rand(0.08, 0.14) });
    }
    return 0.45;
  },
  whale(k) {
    tone(k, {
      from: 300,
      curve: [
        [0.5, 480],
        [1.2, 360],
      ],
      peak: 0.07,
      attack: 0.3,
      hold: 0.4,
      decay: 0.5,
      vibrato: { rate: 4, depth: 20 },
      filter: { type: "lowpass", freq: 1000 },
    });
    return 1.3;
  },
  twinkle(k) {
    const notes = [1568, 1760, 2093, 2349, 2637];
    for (let i = 0; i < 4; i++) bell(k, pick(notes), 0.05, 0.4, k.t + i * 0.07, [[2.76, 0.08]]);
    return 0.7;
  },
  boo(k) {
    tone(k, {
      type: "triangle",
      from: 300,
      curve: [
        [0.3, 480],
        [0.8, 260],
      ],
      peak: 0.08,
      attack: 0.15,
      hold: 0.3,
      decay: 0.35,
      vibrato: { rate: 6, depth: 80 },
      filter: { type: "lowpass", freq: 1100 },
    });
    return 0.85;
  },
  chatter(k) {
    const fs = [750, 950, 700, 1100, 1000];
    fs.forEach((f, i) => tone(k, { type: "triangle", from: f, to: f * 1.3, glide: 0.05, peak: 0.07, attack: 0.005, decay: 0.07, at: k.t + i * 0.1 }));
    return 0.6;
  },
  hum(k) {
    tone(k, { type: "triangle", from: 220, to: 245, glide: 0.4, peak: 0.08, attack: 0.08, hold: 0.2, decay: 0.25, vibrato: { rate: 5, depth: 15 }, filter: { type: "lowpass", freq: 900 } });
    return 0.6;
  },
  rustle(k) {
    for (let i = 0; i < 4; i++) {
      noise(k, { type: "bandpass", freq: rand(2400, 4600), q: 1.2, peak: rand(0.04, 0.07), attack: 0.01, decay: rand(0.06, 0.11), at: k.t + i * 0.06 + rand(0, 0.02) });
    }
    return 0.4;
  },
  pop(k) {
    tone(k, { from: 900, to: 300, glide: 0.09, peak: 0.12, decay: 0.12 });
    return 0.2;
  },
  chime(k) {
    bell(k, 1318.5, 0.07, 0.9, k.t);
    bell(k, 1975.5, 0.06, 0.9, k.t + 0.1);
    return 1;
  },
  hello(k) {
    [
      [523, 0],
      [659, 0.2],
    ].forEach(([f, d]) =>
      tone(k, { type: "triangle", from: f, peak: 0.08, attack: 0.03, hold: 0.08, decay: 0.15, at: k.t + d, vibrato: { rate: 6, depth: 15 }, filter: { type: "lowpass", freq: 1600 } }),
    );
    return 0.45;
  },
  boing(k) {
    tone(k, { type: "triangle", from: 180, to: 420, glide: 0.25, peak: 0.13, attack: 0.01, decay: 0.42, vibrato: { rate: 14, depth: 90 } });
    return 0.5;
  },
};

/** Synthesize one call of `family` into a kit (used by the ambience too). Returns its length in seconds. */
export function synthCall(family: CreatureFamily, k: Kit): number {
  return CALLS[family](k);
}

const creatureThrottle = new Throttle(CREATURE_MIN_INTERVAL_MS);
const creatureEnds: number[] = [];

export interface CreatureSoundOptions {
  /** 0..1 loudness (e.g. fade with distance). Default 1. */
  volume?: number;
  /** -1 (left) .. 1 (right). Default 0. */
  pan?: number;
}

/**
 * Play a short cute call for a creation's kind (e.g. "cat" → meow, "car" → beep).
 * Unknown kinds fall back by category, then to a "boing". No-op before audio
 * unlock; throttled per kind; at most a few calls sound at once.
 * Returns true if a sound was started.
 */
export function playCreatureSound(kindId: string, opts: CreatureSoundOptions = {}): boolean {
  const ctx = getAudioContext();
  const bus = getSfxBus();
  if (!ctx || !bus || ctx.state !== "running") return false;
  const volume = Math.min(1, Math.max(0, opts.volume ?? 1));
  if (volume < 0.02) return false;
  if (activeVoices(creatureEnds, ctx.currentTime) >= MAX_CREATURE_VOICES) return false;
  if (!creatureThrottle.tryAcquire(kindId, nowMs())) return false;

  const family = creatureFamily(kindId);
  const kind = KIND_BY_ID[kindId];
  const pitch = voicePitch(kind?.voice) * rand(0.94, 1.06);
  const out = makeOut(ctx, bus, volume * 0.9, opts.pan ?? 0, 2);
  try {
    const len = CALLS[family]({ ctx, out, t: ctx.currentTime + 0.01, pitch });
    creatureEnds.push(ctx.currentTime + len + 0.1);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- footsteps

const STEPS: Record<GroundType, (k: Kit) => void> = {
  grass(k) {
    noise(k, { type: "bandpass", freq: rand(2800, 4200), q: 0.9, peak: 0.05, attack: 0.012, decay: rand(0.06, 0.09) });
    noise(k, { type: "lowpass", freq: 500, peak: 0.025, attack: 0.004, decay: 0.04 });
  },
  sand(k) {
    for (let i = 0; i < 4; i++) {
      noise(k, { type: "bandpass", freq: rand(1400, 2800), q: 2, peak: rand(0.03, 0.05), attack: 0.002, decay: rand(0.015, 0.03), at: k.t + i * rand(0.012, 0.025) });
    }
    noise(k, { type: "lowpass", freq: 700, peak: 0.025, attack: 0.004, decay: 0.05 });
  },
  path(k) {
    tone(k, { from: rand(170, 210), to: 120, glide: 0.04, peak: 0.07, attack: 0.002, decay: 0.05 });
    noise(k, { type: "lowpass", freq: 1200, peak: 0.03, attack: 0.002, decay: 0.03 });
  },
  rock(k) {
    tone(k, { from: rand(900, 1300), to: 700, glide: 0.02, peak: 0.045, attack: 0.001, decay: 0.03 });
    noise(k, { type: "highpass", freq: 2500, peak: 0.03, attack: 0.001, decay: 0.02 });
  },
  snow(k) {
    for (let i = 0; i < 3; i++) {
      noise(k, { type: "bandpass", freq: rand(1800, 3200), q: 3, peak: rand(0.03, 0.05), attack: 0.004, decay: rand(0.02, 0.04), at: k.t + i * rand(0.015, 0.03) });
    }
    tone(k, { from: rand(950, 1150), to: 1350, glide: 0.05, peak: 0.012, attack: 0.01, decay: 0.05, at: k.t + 0.02 });
  },
  water(k) {
    noise(k, { type: "lowpass", freq: 1800, freqTo: 500, q: 0.7, peak: 0.06, attack: 0.006, decay: 0.14 });
    const f = rand(450, 700);
    tone(k, { from: f, to: f * 2, glide: 0.05, peak: 0.03, attack: 0.003, decay: 0.06, at: k.t + rand(0.03, 0.07) });
  },
};

const stepThrottle = new Throttle(FOOTSTEP_MIN_INTERVAL_MS);
let stepSide = 1;

/**
 * Very soft footstep on the given ground. `intensity` 0..1 (e.g. walking speed
 * / max speed). Throttled to ~8 per second; slightly alternates left/right.
 */
export function playFootstep(ground: GroundType, intensity = 1): void {
  const ctx = getAudioContext();
  const bus = getSfxBus();
  if (!ctx || !bus || ctx.state !== "running") return;
  const recipe = STEPS[ground] ?? STEPS.grass;
  if (!stepThrottle.tryAcquire("step", nowMs())) return;
  stepSide = -stepSide;
  const out = makeOut(ctx, bus, footstepVolume(ground, intensity), stepSide * 0.12, 0.6);
  try {
    recipe({ ctx, out, t: ctx.currentTime + 0.003, pitch: rand(0.9, 1.1) });
  } catch {
    /* ignore */
  }
}
