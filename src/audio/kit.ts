// Shared tiny synth toolkit used by sfx, creature calls, footsteps and the
// ambience. Everything is plain Web Audio: oscillators, filtered noise and
// short envelopes. Noise buffers are generated once per AudioContext and cached.

export interface Kit {
  ctx: AudioContext;
  /** Where voices connect (a per-sound gain/panner chain on one of the engine buses). */
  out: AudioNode;
  /** Start time (AudioContext seconds). */
  t: number;
  /** Frequency multiplier (detune / voice size). */
  pitch: number;
}

// ---------------------------------------------------------------- noise buffers

export type NoiseColor = "white" | "pink" | "brown";

const noiseCache = new WeakMap<BaseAudioContext, Partial<Record<NoiseColor, AudioBuffer>>>();

/** A cached 2-second looping noise buffer of the given colour. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor = "white"): AudioBuffer {
  let entry = noiseCache.get(ctx);
  if (!entry) {
    entry = {};
    noiseCache.set(ctx, entry);
  }
  const hit = entry[color];
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  if (color === "white") {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (color === "pink") {
    // Paul Kellet's economical pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // Smooth the loop seam.
  const fade = Math.min(256, len >> 4);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - a) + d[i] * a;
  }
  entry[color] = buffer;
  return buffer;
}

// ---------------------------------------------------------------- envelopes & voices

export function envGain(k: Kit, peak: number, attack: number, decay: number, at = k.t, hold = 0, dest: AudioNode = k.out): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay);
  g.connect(dest);
  return g;
}

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  freqTo?: number;
  q?: number;
}

export interface ModSpec {
  /** LFO rate in Hz. */
  rate: number;
  /** 0..1 amplitude modulation depth (AM) or cents (vibrato). */
  depth: number;
  type?: OscillatorType;
}

export interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  glide?: number;
  /** Frequency points [secondsAfterStart, hz] (before pitch scaling); overrides `to`. */
  curve?: Array<[number, number]>;
  peak: number;
  attack?: number;
  hold?: number;
  decay: number;
  at?: number;
  detune?: number;
  vibrato?: ModSpec;
  am?: ModSpec;
  filter?: FilterSpec;
  dest?: AudioNode;
}

/** Wire an amplitude-modulation stage; returns the node to feed into. */
function amStage(k: Kit, am: ModSpec, at: number, end: number, into: AudioNode, cleanup: AudioNode[]): AudioNode {
  const g = k.ctx.createGain();
  const depth = Math.min(1, Math.max(0, am.depth));
  g.gain.value = 1 - depth / 2;
  const lfo = k.ctx.createOscillator();
  lfo.type = am.type ?? "sine";
  lfo.frequency.value = am.rate;
  const lg = k.ctx.createGain();
  lg.gain.value = depth / 2;
  lfo.connect(lg).connect(g.gain);
  lfo.start(at);
  lfo.stop(end);
  g.connect(into);
  cleanup.push(g, lfo, lg);
  return g;
}

export function tone(k: Kit, opts: ToneOpts): OscillatorNode {
  const { ctx } = k;
  const at = opts.at ?? k.t;
  const attack = opts.attack ?? 0.005;
  const hold = opts.hold ?? 0;
  const end = at + attack + hold + opts.decay + 0.05;
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.from * k.pitch, at);
  if (opts.curve) {
    for (const [dt, f] of opts.curve) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f * k.pitch), at + dt);
  } else if (opts.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to * k.pitch), at + (opts.glide ?? opts.decay));
  }
  if (opts.detune) osc.detune.value = opts.detune;
  const cleanup: AudioNode[] = [];
  const g = envGain(k, opts.peak, attack, opts.decay, at, hold, opts.dest ?? k.out);
  cleanup.push(g);
  let head: AudioNode = g;
  if (opts.filter) {
    const f = ctx.createBiquadFilter();
    f.type = opts.filter.type;
    f.frequency.setValueAtTime(opts.filter.freq, at);
    if (opts.filter.freqTo !== undefined) f.frequency.exponentialRampToValueAtTime(opts.filter.freqTo, end - 0.05);
    f.Q.value = opts.filter.q ?? 0.8;
    f.connect(head);
    head = f;
    cleanup.push(f);
  }
  if (opts.am) head = amStage(k, opts.am, at, end, head, cleanup);
  if (opts.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.type = opts.vibrato.type ?? "sine";
    lfo.frequency.value = opts.vibrato.rate;
    const lg = ctx.createGain();
    lg.gain.value = opts.vibrato.depth;
    lfo.connect(lg).connect(osc.detune);
    lfo.start(at);
    lfo.stop(end);
    cleanup.push(lfo, lg);
  }
  osc.connect(head);
  osc.start(at);
  osc.stop(end);
  osc.onended = () => {
    osc.disconnect();
    for (const n of cleanup) n.disconnect();
  };
  return osc;
}

export interface NoiseOpts {
  type: BiquadFilterType;
  freq: number;
  freqTo?: number;
  q?: number;
  peak: number;
  attack?: number;
  hold?: number;
  decay: number;
  at?: number;
  color?: NoiseColor;
  am?: ModSpec;
  dest?: AudioNode;
}

export function noise(k: Kit, opts: NoiseOpts): void {
  const { ctx } = k;
  const at = opts.at ?? k.t;
  const attack = opts.attack ?? 0.005;
  const hold = opts.hold ?? 0;
  const end = at + attack + hold + opts.decay + 0.05;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, opts.color ?? "white");
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.freq, at);
  if (opts.freqTo !== undefined) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, at + attack + hold + opts.decay);
  filter.Q.value = opts.q ?? 0.8;
  const cleanup: AudioNode[] = [filter];
  const g = envGain(k, opts.peak, attack, opts.decay, at, hold, opts.dest ?? k.out);
  cleanup.push(g);
  let head: AudioNode = g;
  if (opts.am) head = amStage(k, opts.am, at, end, head, cleanup);
  filter.connect(head);
  src.connect(filter);
  src.start(at, Math.random() * 1.5);
  src.stop(end);
  src.onended = () => {
    src.disconnect();
    for (const n of cleanup) n.disconnect();
  };
}

/** Bell-like strike: a sine plus a few inharmonic partials with faster decays. */
export function bell(
  k: Kit,
  freq: number,
  peak: number,
  decay: number,
  at = k.t,
  partials: Array<[number, number]> = [
    [2.76, 0.12],
    [5.4, 0.05],
  ],
  dest?: AudioNode,
): void {
  tone(k, { from: freq, peak, attack: 0.003, decay, at, dest });
  for (const [mult, g] of partials) tone(k, { from: freq * mult, peak: peak * g, attack: 0.002, decay: decay * 0.35, at, dest });
}

/**
 * Make a per-sound output stage (gain → optional stereo pan) on `bus` and
 * disconnect it automatically after `lifeSeconds`.
 */
export function makeOut(ctx: AudioContext, bus: AudioNode, volume: number, pan = 0, lifeSeconds = 3): AudioNode {
  const g = ctx.createGain();
  g.gain.value = Math.min(1.5, Math.max(0, volume));
  let tail: AudioNode = g;
  if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.min(1, Math.max(-1, pan));
    g.connect(p);
    tail = p;
  }
  tail.connect(bus);
  setTimeout(() => {
    try {
      g.disconnect();
      if (tail !== g) tail.disconnect();
    } catch {
      /* ignore */
    }
  }, lifeSeconds * 1000 + 300);
  return g;
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
