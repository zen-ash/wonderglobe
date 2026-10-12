// Regional ambience: per-region soundscapes (frogs, birds, bees, waves, wind …)
// crossfaded smoothly as the player walks, shaped by time of day and weather
// read from the shared `environment` object.
//
//   looping beds ─┐                                        ┌─ rain bed
//   one-shot calls ┼→ input → muffle (low-pass) → level ───┴→ duck → sfx bus
//   distant calls → echo ┘
//
// The integrator just calls updateAmbience(...) ~10×/s. An internal 100 ms tick
// smooths every layer toward its target (≈2–3 s crossfades), starts beds only
// while audible (at most MAX_AMBIENT_BEDS), stops silent ones, and schedules
// random one-shot calls (at most MAX_AMBIENT_EVENTS at once). If updates stop
// for 1.5 s the ambience fades out and tears itself down.

import { environment } from "@/world/environment";
import { getAudioContext, getSfxBus, onDuckChange, isMusicDucked } from "./engine";
import { bell, makeOut, mtof, noise, noiseBuffer, pick, rand, tone, type Kit } from "./kit";
import { synthCall } from "./creatures";
import { playSfx } from "./sfx";
import {
  activeVoices,
  BED_IDS,
  computeAmbienceTargets,
  EVENT_IDS,
  EVENT_RATES,
  eventProbability,
  MAX_AMBIENT_BEDS,
  MAX_AMBIENT_EVENTS,
  silentTargets,
  smoothTargets,
  smoothToward,
  topN,
  type AmbienceInput,
  type AmbienceTargets,
  type AmbientEventId,
  type BedId,
} from "./logic";

export type { AmbienceInput } from "./logic";

const TICK_MS = 100;
const STALE_MS = 1500;
const AMBIENCE_LEVEL = 1;
const EVENT_LEVEL = 0.6;
const DUCKED_LEVEL = 0.6;
const BED_ON = 0.003;

/** Linear gain of each bed at target weight 1 (tuned for ~-38 dBFS RMS). */
const BED_GAIN: Record<BedId, number> = {
  breeze: 0.09,
  gust: 0.16,
  leaves: 0.025,
  lap: 0.11,
  waves: 0.15,
  hum: 0.07,
  bees: 0.02,
  rain: 0.045,
  whistle: 0.25,
  space: 0.1,
};

interface Graph {
  ctx: AudioContext;
  input: GainNode;
  echoIn: GainNode;
  muffle: BiquadFilterNode;
  level: GainNode;
  rainIn: GainNode;
  duck: GainNode;
  nodes: AudioNode[];
}

interface Bed {
  id: BedId;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  quietSince: number | null;
  update?: () => void;
}

let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let input: AmbienceInput | null = null;
let lastUpdateMs = -Infinity;
let lastTickMs = 0;
let current: AmbienceTargets = silentTargets();
let lastTarget: AmbienceTargets = silentTargets();
const beds = new Map<BedId, Bed>();
const eventEnds: number[] = [];
let lastWeather: string | null = null;
let unsubscribeDuck: (() => void) | null = null;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- graph

function buildGraph(ctx: AudioContext, bus: AudioNode): Graph {
  const input = ctx.createGain();
  const muffle = ctx.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = 16000;
  muffle.Q.value = 0.5;
  const level = ctx.createGain();
  level.gain.value = 0;
  const rainIn = ctx.createGain();
  const duck = ctx.createGain();
  duck.gain.value = isMusicDucked() ? DUCKED_LEVEL : 1;
  input.connect(muffle).connect(level).connect(duck).connect(bus);
  rainIn.connect(level);

  // Soft echo for distant calls (bells, loons, owls, foghorn).
  const echoIn = ctx.createGain();
  echoIn.gain.value = 0.35;
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = 0.37;
  const fb = ctx.createGain();
  fb.gain.value = 0.33;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 1500;
  echoIn.connect(delay).connect(echoTone).connect(fb).connect(delay);
  echoTone.connect(input);

  unsubscribeDuck?.();
  unsubscribeDuck = onDuckChange((on) => {
    if (!graph) return;
    const t = graph.ctx.currentTime;
    graph.duck.gain.cancelScheduledValues(t);
    graph.duck.gain.setTargetAtTime(on ? DUCKED_LEVEL : 1, t, on ? 0.15 : 0.5);
  });
  return { ctx, input, echoIn, muffle, level, rainIn, duck, nodes: [input, muffle, level, rainIn, duck, echoIn, delay, fb, echoTone] };
}

function teardown(): void {
  for (const bed of beds.values()) stopBed(bed);
  beds.clear();
  if (timer) clearInterval(timer);
  timer = null;
  unsubscribeDuck?.();
  unsubscribeDuck = null;
  if (graph) {
    const g = graph;
    graph = null;
    setTimeout(() => {
      for (const n of g.nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 3000);
  }
  current = silentTargets();
  lastWeather = null;
}

// ---------------------------------------------------------------- beds

function noiseSource(ctx: AudioContext, color: "white" | "pink" | "brown"): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, color);
  src.loop = true;
  return src;
}

function lfo(ctx: AudioContext, rate: number, depth: number, target: AudioParam, type: OscillatorType = "sine"): [OscillatorNode, GainNode] {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  return [o, g];
}

function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** A gain whose level wobbles between (1 − depth) and 1 at `rate` Hz. */
function wobble(ctx: AudioContext, rate: number, depth: number): { node: GainNode; parts: AudioNode[]; osc: OscillatorNode } {
  const node = ctx.createGain();
  node.gain.value = 1 - depth / 2;
  const [osc, g] = lfo(ctx, rate * rand(0.85, 1.15), depth / 2, node.gain);
  return { node, parts: [node, g], osc };
}

function createBed(g: Graph, id: BedId): Bed {
  const { ctx } = g;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(id === "rain" ? g.rainIn : g.input);
  const bed: Bed = { id, gain, sources: [], nodes: [gain], quietSince: null };
  const add = (...n: AudioNode[]) => bed.nodes.push(...n);
  const src = (...s: AudioScheduledSourceNode[]) => bed.sources.push(...s);

  switch (id) {
    case "breeze": {
      const n = noiseSource(ctx, "pink");
      const f = filter(ctx, "lowpass", 650, 0.3);
      const w = wobble(ctx, 0.09, 0.5);
      n.connect(f).connect(w.node).connect(gain);
      add(n, f, ...w.parts);
      src(n, w.osc);
      break;
    }
    case "gust": {
      const n = noiseSource(ctx, "pink");
      const f = filter(ctx, "bandpass", 400, 0.8);
      const w = wobble(ctx, 0.13, 0.6);
      n.connect(f).connect(w.node).connect(gain);
      add(n, f, ...w.parts);
      src(n, w.osc);
      bed.update = () => {
        const t = ctx.currentTime;
        f.frequency.setTargetAtTime(280 + Math.min(1, Math.max(0, environment.wind)) * 700, t, 0.4);
      };
      break;
    }
    case "leaves": {
      const n = noiseSource(ctx, "white");
      const f = filter(ctx, "bandpass", 3800, 0.6);
      const w = wobble(ctx, 0.3, 0.75);
      n.connect(f).connect(w.node).connect(gain);
      add(n, f, ...w.parts);
      src(n, w.osc);
      break;
    }
    case "lap": {
      const n = noiseSource(ctx, "brown");
      const f = filter(ctx, "lowpass", 700, 0.5);
      const w = wobble(ctx, 0.45, 0.8);
      const w2 = wobble(ctx, 0.17, 0.4);
      n.connect(f).connect(w.node).connect(w2.node).connect(gain);
      add(n, f, ...w.parts, ...w2.parts);
      src(n, w.osc, w2.osc);
      break;
    }
    case "waves": {
      // Slow swells: one LFO opens the filter and raises the level together.
      const n = noiseSource(ctx, "pink");
      const f = filter(ctx, "lowpass", 700, 0.4);
      const amp = ctx.createGain();
      amp.gain.value = 0.55;
      const swell = ctx.createOscillator();
      swell.frequency.value = rand(0.07, 0.09);
      const toFreq = ctx.createGain();
      toFreq.gain.value = 380;
      const toAmp = ctx.createGain();
      toAmp.gain.value = 0.45;
      swell.connect(toFreq).connect(f.frequency);
      swell.connect(toAmp).connect(amp.gain);
      n.connect(f).connect(amp).connect(gain);
      add(n, f, amp, toFreq, toAmp);
      src(n, swell);
      break;
    }
    case "hum": {
      const n = noiseSource(ctx, "brown");
      const f = filter(ctx, "lowpass", 260, 0.4);
      const o = ctx.createOscillator();
      o.frequency.value = 98;
      const og = ctx.createGain();
      og.gain.value = 0.02;
      n.connect(f).connect(gain);
      o.connect(og).connect(gain);
      add(n, f, o, og);
      src(n, o);
      break;
    }
    case "bees": {
      const f = filter(ctx, "bandpass", 450, 1.2);
      const w = wobble(ctx, 0.23, 0.6);
      f.connect(w.node).connect(gain);
      add(f, ...w.parts);
      src(w.osc);
      for (const hz of [196, 203.5]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz * rand(0.97, 1.03);
        const [v, vg] = lfo(ctx, rand(2.5, 4), 22, o.detune);
        o.connect(f);
        add(o, vg);
        src(o, v);
      }
      break;
    }
    case "rain": {
      const n = noiseSource(ctx, "white");
      const hp = filter(ctx, "highpass", 1000, 0.5);
      const lp = filter(ctx, "lowpass", 7000, 0.5);
      const body = noiseSource(ctx, "pink");
      const blp = filter(ctx, "lowpass", 900, 0.5);
      const bg = ctx.createGain();
      bg.gain.value = 0.5;
      n.connect(hp).connect(lp).connect(gain);
      body.connect(blp).connect(bg).connect(gain);
      add(n, hp, lp, body, blp, bg);
      src(n, body);
      break;
    }
    case "whistle": {
      const n = noiseSource(ctx, "white");
      const f = filter(ctx, "bandpass", 1100, 14);
      const [o, og] = lfo(ctx, 0.05, 260, f.frequency);
      const w = wobble(ctx, 0.11, 0.7);
      n.connect(f).connect(w.node).connect(gain);
      add(n, f, og, ...w.parts);
      src(n, o, w.osc);
      break;
    }
    case "space": {
      const n = noiseSource(ctx, "pink");
      const f = filter(ctx, "bandpass", 500, 0.6);
      const [o, og] = lfo(ctx, 0.05, 220, f.frequency);
      const w = wobble(ctx, 0.07, 0.5);
      n.connect(f).connect(w.node).connect(gain);
      add(n, f, og, ...w.parts);
      src(n, o, w.osc);
      // A faint, slowly breathing fifth.
      const tw = wobble(ctx, 0.06, 0.8);
      tw.node.connect(gain);
      add(...tw.parts);
      src(tw.osc);
      for (const hz of [220, 330.5]) {
        const s = ctx.createOscillator();
        s.frequency.value = hz;
        const sg = ctx.createGain();
        sg.gain.value = 0.004 / BED_GAIN.space;
        s.connect(sg).connect(tw.node);
        add(s, sg);
        src(s);
      }
      break;
    }
  }
  const t = ctx.currentTime;
  for (const s of bed.sources) {
    if ("buffer" in s) (s as AudioBufferSourceNode).start(t, Math.random() * 1.8);
    else s.start(t);
  }
  return bed;
}

function stopBed(bed: Bed): void {
  for (const s of bed.sources) {
    try {
      s.stop();
    } catch {
      /* ignore */
    }
  }
  for (const n of bed.nodes) {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- one-shot calls

interface EventKit extends Kit {
  echo: AudioNode;
}

/** Each returns its length in seconds. */
const EVENTS: Record<AmbientEventId, (k: EventKit) => number> = {
  bird(k) {
    const species = Math.floor(Math.random() * 3);
    if (species === 0) {
      const n = 3 + Math.floor(Math.random() * 3);
      const f = rand(2600, 3400);
      for (let i = 0; i < n; i++) tone(k, { from: f, to: f * 1.35, glide: 0.05, peak: 0.06, attack: 0.004, decay: 0.06, at: k.t + i * 0.09 });
      return n * 0.09 + 0.1;
    }
    if (species === 1) {
      const n = 6 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const f = i % 2 ? rand(2000, 2300) : rand(2700, 3100);
        tone(k, { from: f, to: f * 1.08, glide: 0.04, peak: 0.04, attack: 0.004, decay: 0.045, at: k.t + i * 0.055 });
      }
      return n * 0.055 + 0.1;
    }
    tone(k, { from: 2500, to: 2550, glide: 0.15, peak: 0.05, attack: 0.02, hold: 0.08, decay: 0.08 });
    tone(k, { from: 2100, to: 1900, glide: 0.15, peak: 0.05, attack: 0.02, hold: 0.08, decay: 0.1, at: k.t + 0.24 });
    return 0.55;
  },
  eveningBird(k) {
    const n = 3 + Math.floor(Math.random() * 2);
    let t = k.t;
    for (let i = 0; i < n; i++) {
      const f = rand(1600, 2500);
      const len = rand(0.14, 0.24);
      tone(k, { from: f, to: f * rand(0.85, 1.2), glide: len, peak: 0.045, attack: 0.03, hold: len * 0.4, decay: len * 0.8, at: t, vibrato: { rate: 9, depth: 25 } });
      t += len + rand(0.06, 0.14);
    }
    return t - k.t + 0.3;
  },
  frog(k) {
    const base = rand(180, 290);
    if (Math.random() < 0.3) {
      tone(k, { type: "triangle", from: base * 0.8, to: base * 0.7, glide: 0.2, peak: 0.08, attack: 0.02, hold: 0.06, decay: 0.15, am: { rate: rand(24, 30), depth: 0.9 }, filter: { type: "lowpass", freq: 900 } });
      return 0.3;
    }
    [
      [0, 0.08, 1],
      [0.12, 0.065, 1.15],
    ].forEach(([d, len, m]) =>
      tone(k, { type: "triangle", from: base * m, to: base * m * 1.12, glide: len, peak: 0.09, attack: 0.01, hold: len * 0.5, decay: len, at: k.t + d, am: { rate: rand(30, 38), depth: 0.85 }, filter: { type: "lowpass", freq: 1200 } }),
    );
    return 0.3;
  },
  quack(k) {
    const n = 1 + Math.floor(Math.random() * 3);
    let len = 0;
    for (let i = 0; i < n; i++) len = synthCall("quack", { ...k, t: k.t + i * 0.42 }) + i * 0.42;
    return len;
  },
  chime(k) {
    const notes = [84, 86, 88, 91, 93, 96];
    const n = 3 + Math.floor(Math.random() * 4);
    let t = k.t;
    for (let i = 0; i < n; i++) {
      bell(k, mtof(pick(notes)), 0.035, rand(1.6, 2.4), t, [[2.76, 0.1], [5.4, 0.04]], k.echo);
      bell(k, mtof(pick(notes)), 0.02, rand(1.4, 2), t + 0.01, [[2.76, 0.08]]);
      t += rand(0.08, 0.35);
    }
    return t - k.t + 2.4;
  },
  bell(k) {
    const strike = (f: number, at: number) => {
      bell(k, f, 0.06, 3, at, [[2, 0.35], [2.4, 0.2], [3, 0.12], [4.2, 0.06]], k.echo);
    };
    strike(523.25, k.t);
    strike(440, k.t + 1);
    return 4.2;
  },
  murmur(k) {
    // Wordless, far-off chatter: two "voices" of vowel-ish syllables.
    let end = k.t;
    for (let v = 0; v < 2; v++) {
      let t = k.t + v * rand(0.15, 0.5);
      const pitch = v ? rand(170, 210) : rand(220, 270);
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const len = rand(0.08, 0.16);
        tone(k, {
          type: "triangle",
          from: pitch * rand(0.9, 1.15),
          to: pitch * rand(0.85, 1.1),
          glide: len,
          peak: 0.03,
          attack: 0.02,
          hold: len * 0.4,
          decay: len,
          at: t,
          filter: { type: "bandpass", freq: rand(500, 950), q: 2 },
        });
        t += len + rand(0.04, 0.12);
      }
      end = Math.max(end, t);
    }
    return end - k.t + 0.2;
  },
  moo: (k) => synthCall("moo", k),
  baa: (k) => synthCall("baa", k),
  cluck: (k) => synthCall("cluck", k),
  creak(k) {
    tone(k, {
      type: "sawtooth",
      from: 70,
      curve: [
        [0.25, 92],
        [0.6, 78],
      ],
      peak: 0.04,
      attack: 0.08,
      hold: 0.25,
      decay: 0.25,
      am: { rate: 22, depth: 0.6 },
      filter: { type: "bandpass", freq: 900, q: 5 },
    });
    return 0.7;
  },
  kite(k) {
    noise(k, { type: "bandpass", freq: rand(800, 1100), q: 2, peak: 0.06, attack: 0.08, hold: rand(0.2, 0.5), decay: 0.25, am: { rate: rand(14, 20), depth: 0.9, type: "square" } });
    return 0.9;
  },
  loon(k) {
    tone(k, {
      from: 620,
      curve: [
        [0.5, 930],
        [1.4, 870],
        [1.9, 700],
      ],
      peak: 0.045,
      attack: 0.25,
      hold: 1,
      decay: 0.8,
      vibrato: { rate: 5, depth: 15 },
      filter: { type: "lowpass", freq: 1800 },
      dest: k.echo,
    });
    tone(k, { from: 620, curve: [[0.5, 930], [1.4, 870], [1.9, 700]], peak: 0.035, attack: 0.25, hold: 1, decay: 0.8, vibrato: { rate: 5, depth: 15 } });
    return 2.3;
  },
  gull(k) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      tone(k, {
        type: "triangle",
        from: 1450,
        curve: [
          [0.08, 1900],
          [0.3, 1150],
        ],
        peak: 0.045,
        attack: 0.02,
        hold: 0.1,
        decay: 0.18,
        at: k.t + i * 0.36,
        vibrato: { rate: 10, depth: 30 },
        filter: { type: "bandpass", freq: 1800, q: 1 },
      });
    }
    return n * 0.36 + 0.2;
  },
  foghorn(k) {
    for (const f of [98, 147]) {
      tone(k, { type: "triangle", from: f, peak: 0.05, attack: 0.6, hold: 1.4, decay: 1.2, filter: { type: "lowpass", freq: 380 }, dest: k.echo });
      tone(k, { type: "triangle", from: f, peak: 0.04, attack: 0.6, hold: 1.4, decay: 1.2, filter: { type: "lowpass", freq: 380 } });
    }
    return 3.4;
  },
  cricket(k) {
    const f = rand(4200, 4800);
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) tone(k, { from: f, peak: 0.018, attack: 0.01, hold: 0.07, decay: 0.03, at: k.t + i * 0.17, am: { rate: 30, depth: 1, type: "square" } });
    return n * 0.17 + 0.1;
  },
  owl(k) {
    [
      [0, 0.3],
      [0.55, 0.16],
      [0.78, 0.3],
    ].forEach(([d, len]) =>
      tone(k, { from: 390, to: 365, glide: len, peak: 0.07, attack: 0.05, hold: len * 0.5, decay: len, at: k.t + d, filter: { type: "lowpass", freq: 800 }, dest: k.echo }),
    );
    [
      [0, 0.3],
      [0.55, 0.16],
      [0.78, 0.3],
    ].forEach(([d, len]) => tone(k, { from: 390, to: 365, glide: len, peak: 0.05, attack: 0.05, hold: len * 0.5, decay: len, at: k.t + d, filter: { type: "lowpass", freq: 800 } }));
    return 1.6;
  },
  droplet(k) {
    if (Math.random() < 0.5) {
      const f = rand(1800, 3600);
      tone(k, { from: f, to: f * 1.5, glide: 0.02, peak: rand(0.015, 0.035), attack: 0.002, decay: 0.04 });
    } else {
      noise(k, { type: "bandpass", freq: rand(2500, 6000), q: 2, peak: rand(0.03, 0.06), attack: 0.001, decay: 0.015 });
    }
    return 0.06;
  },
  crunch(k) {
    for (let i = 0; i < 3; i++) {
      noise(k, { type: "bandpass", freq: rand(1800, 3200), q: 3, peak: rand(0.025, 0.04), attack: 0.004, decay: rand(0.02, 0.04), at: k.t + i * rand(0.015, 0.03) });
    }
    return 0.2;
  },
};

/** Calls that sound far away get more echo and a wider pan. */
const DISTANT: Partial<Record<AmbientEventId, boolean>> = { bell: true, loon: true, owl: true, foghorn: true, murmur: true };
/** Recipes that send to the echo. */
const ECHOED: Partial<Record<AmbientEventId, boolean>> = { bell: true, loon: true, owl: true, foghorn: true, chime: true };

function playEvent(g: Graph, id: AmbientEventId, weight: number): void {
  const { ctx } = g;
  const distant = DISTANT[id] ?? false;
  const vol = EVENT_LEVEL * Math.min(1, weight) * rand(distant ? 0.5 : 0.45, distant ? 0.8 : 1);
  const pan = id === "foghorn" ? rand(-0.3, 0.3) : rand(-0.75, 0.75);
  const out = makeOut(ctx, g.input, vol, pan, 6);
  const echo = ECHOED[id] ? makeOut(ctx, g.echoIn, vol, pan, 6) : out;
  try {
    const len = EVENTS[id]({ ctx, out, echo, t: ctx.currentTime + rand(0.01, 0.09), pitch: rand(0.96, 1.04) });
    if (id !== "droplet") eventEnds.push(ctx.currentTime + len);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- tick

function tick(): void {
  const t = now();
  const g = graph;
  if (!g) return;
  const { ctx } = g;
  const dt = Math.min(0.3, Math.max(0, (t - lastTickMs) / 1000));
  lastTickMs = t;
  if (ctx.state !== "running") return;

  const stale = !input || t - lastUpdateMs > STALE_MS;
  const target = stale || !input ? silentTargets() : computeAmbienceTargets(input, environment);
  lastTarget = target;

  // Weather cues (only while actually exploring).
  if (!stale && input && !input.inPlanetView) {
    const w = environment.weather;
    if (lastWeather !== null && w !== lastWeather) {
      if (w === "rain") playSfx("rain-start", { volume: 0.6 });
      else if (w === "rainbow") playSfx("rainbow", { volume: 0.45 });
    }
    lastWeather = w;
  }

  const prevGust = current.beds.gust;
  smoothTargets(current, target, dt, 0.8);
  current.beds.gust = smoothToward(prevGust, target.beds.gust, dt, 0.35);

  const at = ctx.currentTime;
  g.muffle.frequency.setTargetAtTime(current.muffle, at, 0.2);
  g.level.gain.setTargetAtTime(current.level * AMBIENCE_LEVEL, at, 0.2);

  // Beds: keep the loudest few running, fade and stop the rest.
  const ranking = {} as Record<BedId, number>;
  for (const id of BED_IDS) ranking[id] = Math.max(current.beds[id], target.beds[id]);
  const allowed = topN(ranking, MAX_AMBIENT_BEDS, BED_ON);
  for (const id of BED_IDS) {
    const level = current.beds[id];
    let bed = beds.get(id);
    if (allowed.has(id) && (level > BED_ON || target.beds[id] > BED_ON)) {
      if (!bed) {
        bed = createBed(g, id);
        beds.set(id, bed);
      }
      bed.quietSince = null;
      bed.gain.gain.setTargetAtTime(level * BED_GAIN[id], at, 0.12);
      bed.update?.();
    } else if (bed) {
      bed.gain.gain.setTargetAtTime(0, at, 0.25);
      if (bed.quietSince === null) bed.quietSince = t;
      else if (t - bed.quietSince > 1500) {
        stopBed(bed);
        beds.delete(id);
      }
    }
  }

  // One-shot calls.
  if (dt > 0) {
    for (const id of EVENT_IDS) {
      const w = current.events[id];
      if (w < 0.01) continue;
      if (Math.random() >= eventProbability(EVENT_RATES[id], w, dt)) continue;
      if (id !== "droplet" && activeVoices(eventEnds, ctx.currentTime) >= MAX_AMBIENT_EVENTS) continue;
      playEvent(g, id, w);
    }
  }

  // Fully faded after updates stopped: release everything.
  if (stale && current.level < 0.002 && [...beds.values()].every((b) => current.beds[b.id] < 0.002)) teardown();
}

// ---------------------------------------------------------------- API

/**
 * Tell the ambience where the player is. Call ~10×/s while exploring. Safe
 * before audio is unlocked (no-op). Time of day, weather and wind are read
 * from `environment` internally.
 */
export function updateAmbience(state: AmbienceInput): void {
  input = { ...state };
  lastUpdateMs = now();
  if (graph) return;
  const ctx = getAudioContext();
  const bus = getSfxBus();
  if (!ctx || !bus) return;
  graph = buildGraph(ctx, bus);
  current = silentTargets();
  lastWeather = environment.weather;
  lastTickMs = now();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
}

/** Fade the ambience out now (e.g. leaving to the title screen). It restarts on the next updateAmbience. */
export function stopAmbience(): void {
  input = null;
  lastUpdateMs = -Infinity;
}

/** Current smoothed layer levels (for debugging / tests in the browser). */
export function getAmbienceLevels(): { running: boolean; beds: Partial<Record<BedId, number>>; target: AmbienceTargets } {
  const active: Partial<Record<BedId, number>> = {};
  for (const id of beds.keys()) active[id] = Math.round(current.beds[id] * 1000) / 1000;
  return { running: graph !== null, beds: active, target: lastTarget };
}
