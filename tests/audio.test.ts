// Sound system: pure decision logic (region soundscapes, crossfade weights,
// music palettes, creature families, throttling) plus a smoke test that drives
// every synth recipe against a strict fake AudioContext.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { KINDS } from "@/core/kinds";
import { REGIONS } from "@/world/planet";
import type { GroundType } from "@/core/types";
import {
  ALL_REGIONS,
  BED_IDS,
  CATEGORY_FAMILY,
  computeAmbienceTargets,
  creatureFamily,
  EVENT_IDS,
  eventProbability,
  activeVoices,
  footstepVolume,
  KIND_FAMILY,
  MUSIC_PALETTES,
  moodFromEnv,
  NEUTRAL_ENV,
  paletteForRegion,
  REGION_INSTRUMENT,
  REGION_SOUNDSCAPES,
  regionMix,
  shapeMusic,
  silentTargets,
  smoothTargets,
  smoothToward,
  Throttle,
  topN,
  transitionMix,
  type AmbienceEnv,
  type AmbienceInput,
} from "@/audio/logic";

const at = (region: AmbienceInput["region"], extra: Partial<AmbienceInput> = {}): AmbienceInput => ({
  region,
  secondRegion: region,
  blend: 0,
  moving: false,
  nearWater: 0,
  inPlanetView: false,
  ...extra,
});
const env = (e: Partial<AmbienceEnv>): AmbienceEnv => ({ ...NEUTRAL_ENV, ...e });

describe("region soundscapes", () => {
  it("covers every planet region", () => {
    expect(new Set(ALL_REGIONS)).toEqual(new Set(REGIONS.map((r) => r.id)));
    for (const r of ALL_REGIONS) {
      expect(REGION_SOUNDSCAPES[r]).toBeDefined();
      expect(REGION_INSTRUMENT[r]).toBeDefined();
    }
  });

  it("gives each region its signature sounds", () => {
    const t = (r: AmbienceInput["region"]) => computeAmbienceTargets(at(r));
    expect(t("lily").events.frog).toBeGreaterThan(0.5);
    expect(t("lily").beds.lap).toBeGreaterThan(0.5);
    expect(t("duckpond").events.quack).toBeGreaterThan(0.5);
    expect(t("forest").events.bird).toBeGreaterThan(t("garden").events.bird);
    expect(t("forest").beds.leaves).toBeGreaterThan(0.3);
    expect(t("meadow").beds.bees).toBeGreaterThan(0.3);
    expect(t("cherry").events.chime).toBeGreaterThan(0.3);
    expect(t("village").events.bell).toBeGreaterThan(0);
    expect(t("village").events.murmur).toBeGreaterThan(0);
    expect(t("village").beds.hum).toBeGreaterThan(0.3);
    for (const id of ["moo", "baa", "cluck", "creak"] as const) expect(t("farm").events[id]).toBeGreaterThan(0);
    expect(t("picnic").events.kite).toBeGreaterThan(0);
    expect(t("mountain").beds.whistle).toBeGreaterThan(0.2);
    expect(t("mountain").beds.gust).toBeGreaterThan(t("meadow").beds.gust);
    expect(t("lake").events.loon).toBeGreaterThan(0);
    expect(t("coast").beds.waves).toBeGreaterThan(0.8);
    expect(t("coast").events.gull).toBeGreaterThan(0);
    // The foghorn is very rare.
    expect(t("coast").events.foghorn * 0.012).toBeLessThan(0.02);
    // No frogs on the mountain, no waves in the forest.
    expect(t("mountain").events.frog).toBe(0);
    expect(t("forest").beds.waves).toBe(0);
  });

  it("all targets stay within range", () => {
    const envs: AmbienceEnv[] = [
      NEUTRAL_ENV,
      env({ daylight: 0, isNight: true }),
      env({ weather: "rain", weatherAmount: 1, wind: 1 }),
      env({ weather: "snow", weatherAmount: 1, season: "winter" }),
      env({ dusk: 1, daylight: 0.5 }),
    ];
    for (const r of ALL_REGIONS) {
      for (const e of envs) {
        const t = computeAmbienceTargets(at(r, { moving: true, nearWater: 1, altitude: 1, secondRegion: "coast", blend: 0.5 }), e);
        for (const id of BED_IDS) expect(t.beds[id]).toBeGreaterThanOrEqual(0), expect(t.beds[id]).toBeLessThanOrEqual(1);
        for (const id of EVENT_IDS) expect(Number.isFinite(t.events[id]) && t.events[id] >= 0).toBe(true);
        expect(t.muffle).toBeGreaterThan(1000);
        expect(t.level).toBeGreaterThan(0);
      }
    }
  });
});

describe("crossfade weights", () => {
  it("splits weight between the region and its neighbour", () => {
    expect(regionMix("forest", "forest", 0.3)).toEqual([{ region: "forest", weight: 1 }]);
    expect(regionMix("forest", "meadow", 0)).toEqual([{ region: "forest", weight: 1 }]);
    const mix = regionMix("forest", "meadow", 0.3);
    expect(mix[0].weight).toBeCloseTo(0.7);
    expect(mix[1].weight).toBeCloseTo(0.3);
    // Blend is capped at an even split.
    expect(regionMix("forest", "meadow", 0.9)[1].weight).toBeCloseTo(0.5);
  });

  it("blends layers linearly at a border", () => {
    const forest = computeAmbienceTargets(at("forest"));
    const coast = computeAmbienceTargets(at("coast"));
    const border = computeAmbienceTargets(at("forest", { secondRegion: "coast", blend: 0.5 }));
    expect(border.beds.waves).toBeCloseTo((forest.beds.waves + coast.beds.waves) / 2, 5);
    expect(border.events.bird).toBeCloseTo((forest.events.bird + coast.events.bird) / 2, 5);
  });

  it("smooths over ~2–3 seconds", () => {
    expect(smoothToward(0, 1, 0, 0.8)).toBe(0);
    let v = 0;
    for (let i = 0; i < 10; i++) v = smoothToward(v, 1, 0.1, 0.8); // 1 s
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.85);
    for (let i = 0; i < 15; i++) v = smoothToward(v, 1, 0.1, 0.8); // 2.5 s total
    expect(v).toBeGreaterThan(0.9);

    const cur = silentTargets();
    const target = computeAmbienceTargets(at("coast"));
    smoothTargets(cur, target, 0.1);
    expect(cur.beds.waves).toBeGreaterThan(0);
    expect(cur.beds.waves).toBeLessThan(target.beds.waves * 0.2);
  });

  it("planet view fades everything to the space bed", () => {
    const t = computeAmbienceTargets(at("coast", { inPlanetView: true }));
    expect(t.beds.space).toBe(1);
    for (const id of BED_IDS) if (id !== "space") expect(t.beds[id]).toBe(0);
    for (const id of EVENT_IDS) expect(t.events[id]).toBe(0);
  });
});

describe("time of day and weather", () => {
  it("night brings crickets, owls and louder frogs; birds and bees stop", () => {
    const day = computeAmbienceTargets(at("lily"), NEUTRAL_ENV);
    const night = computeAmbienceTargets(at("lily"), env({ daylight: 0, isNight: true }));
    expect(night.events.cricket).toBeGreaterThan(0.3);
    expect(day.events.cricket).toBe(0);
    expect(night.events.owl).toBeGreaterThan(0);
    expect(night.events.frog).toBeGreaterThan(day.events.frog);
    expect(night.events.bird).toBe(0);
    const meadowNight = computeAmbienceTargets(at("meadow"), env({ daylight: 0 }));
    expect(meadowNight.beds.bees).toBe(0);
    const forestNight = computeAmbienceTargets(at("forest"), env({ daylight: 0 }));
    expect(forestNight.events.owl).toBeGreaterThan(night.events.owl);
  });

  it("dusk adds evening birds", () => {
    const t = computeAmbienceTargets(at("forest"), env({ dusk: 1, daylight: 0.5 }));
    expect(t.events.eveningBird).toBeGreaterThan(0.5);
    expect(computeAmbienceTargets(at("forest")).events.eveningBird).toBe(0);
  });

  it("rain patters, muffles and quiets the birds", () => {
    const clear = computeAmbienceTargets(at("garden"));
    const rain = computeAmbienceTargets(at("garden"), env({ weather: "rain", weatherAmount: 1 }));
    expect(rain.beds.rain).toBe(1);
    expect(rain.events.droplet).toBe(1);
    expect(rain.muffle).toBeLessThan(clear.muffle / 2);
    expect(rain.events.bird).toBeLessThan(clear.events.bird * 0.3);
    expect(clear.beds.rain).toBe(0);
  });

  it("snow hushes", () => {
    const snow = computeAmbienceTargets(at("meadow"), env({ weather: "snow", weatherAmount: 1 }));
    expect(snow.level).toBeLessThan(0.7);
    expect(snow.beds.bees).toBe(0);
  });

  it("wind gusts follow environment.wind", () => {
    const calm = computeAmbienceTargets(at("meadow"), env({ wind: 0 }));
    const gusty = computeAmbienceTargets(at("meadow"), env({ wind: 1 }));
    expect(gusty.beds.gust).toBeGreaterThan(calm.beds.gust + 0.3);
  });

  it("water nearby laps in any region", () => {
    expect(computeAmbienceTargets(at("meadow", { nearWater: 1 })).beds.lap).toBeGreaterThan(0.5);
  });
});

describe("music palettes", () => {
  it("maps region families to instruments", () => {
    expect(paletteForRegion("garden").instrument).toBe("musicbox");
    expect(paletteForRegion("cherry").instrument).toBe("musicbox");
    expect(paletteForRegion("meadow").instrument).toBe("marimba");
    expect(paletteForRegion("farm").instrument).toBe("marimba");
    expect(paletteForRegion("forest").instrument).toBe("flute");
    expect(paletteForRegion("lake").instrument).toBe("harp");
    expect(paletteForRegion("coast").instrument).toBe("harp");
    expect(paletteForRegion("mountain").instrument).toBe("pad");
    expect(paletteForRegion(null).instrument).toBe("soft");
    for (const p of Object.values(MUSIC_PALETTES)) {
      expect(p.scale.length).toBeGreaterThanOrEqual(5);
      // All melody notes stay in C major pentatonic (C D E G A) so blends never clash.
      for (const m of p.scale) expect([0, 2, 4, 7, 9]).toContain(m % 12);
    }
  });

  it("night is slower, softer and lower; rain is sparser", () => {
    const p = paletteForRegion("meadow");
    const day = shapeMusic(p, { night: 0, rain: 0, snow: 0 });
    const night = shapeMusic(p, { night: 1, rain: 0, snow: 0 });
    const rain = shapeMusic(p, { night: 0, rain: 1, snow: 0 });
    expect(night.stepSeconds).toBeGreaterThan(day.stepSeconds);
    expect(night.melodyLevel).toBeLessThan(day.melodyLevel);
    expect(night.transpose).toBeLessThan(0);
    expect(night.brightness).toBeLessThan(day.brightness);
    expect(rain.density).toBeLessThan(day.density * 0.6);
    expect(rain.restChance).toBeGreaterThan(day.restChance);
    expect(moodFromEnv({ daylight: 0.25, weather: "rain", weatherAmount: 0.5 })).toEqual({ night: 0.75, rain: 0.5, snow: 0 });
  });

  it("transitions blend gradually", () => {
    expect(transitionMix(0, 8)).toBe(0);
    expect(transitionMix(4, 8)).toBeCloseTo(0.5);
    expect(transitionMix(20, 8)).toBe(1);
  });
});

describe("creature sound families", () => {
  it("maps kinds to cute calls", () => {
    expect(creatureFamily("cat")).toBe("meow");
    expect(creatureFamily("dog")).toBe("woof");
    expect(creatureFamily("bird")).toBe("tweet");
    expect(creatureFamily("frog")).toBe("ribbit");
    expect(creatureFamily("duck")).toBe("quack");
    expect(creatureFamily("cow")).toBe("moo");
    expect(creatureFamily("sheep")).toBe("baa");
    expect(creatureFamily("pig")).toBe("oink");
    expect(creatureFamily("bee")).toBe("buzz");
    expect(creatureFamily("lion")).toBe("roar");
    expect(creatureFamily("robot")).toBe("robot");
    expect(creatureFamily("car")).toBe("engine");
  });

  it("covers every kind and falls back sensibly", () => {
    for (const k of KINDS) expect(KIND_FAMILY[k.id] ?? CATEGORY_FAMILY[k.category]).toBeDefined();
    expect(creatureFamily("sculpture")).toBe("boing");
    expect(creatureFamily("definitely-not-a-kind")).toBe("boing");
    expect(CATEGORY_FAMILY.vehicle).toBe("engine");
    expect(CATEGORY_FAMILY.imaginary).toBe("boing");
  });
});

describe("throttling and voice limits", () => {
  it("throttles per key", () => {
    const th = new Throttle(100);
    expect(th.tryAcquire("cat", 0)).toBe(true);
    expect(th.tryAcquire("cat", 50)).toBe(false);
    expect(th.tryAcquire("dog", 50)).toBe(true);
    expect(th.tryAcquire("cat", 100)).toBe(true);
    expect(th.tryAcquire("cat", 150, 20)).toBe(true);
  });

  it("counts and prunes active voices", () => {
    const ends = [1, 2, 3];
    expect(activeVoices(ends, 1.5)).toBe(2);
    expect(ends).toEqual([2, 3]);
    expect(activeVoices(ends, 10)).toBe(0);
  });

  it("keeps only the loudest beds", () => {
    const keep = topN({ a: 0.5, b: 0.1, c: 0.9, d: 0.0001 }, 2, 0.001);
    expect([...keep].sort()).toEqual(["a", "c"]);
  });

  it("event probability scales with rate, weight and time", () => {
    expect(eventProbability(1, 0, 0.1)).toBe(0);
    expect(eventProbability(1, 1, 0.1)).toBeCloseTo(1 - Math.exp(-0.1));
    expect(eventProbability(1, 1, 0.1)).toBeLessThan(eventProbability(1, 2, 0.1));
  });

  it("footsteps get softer with lower intensity", () => {
    const grounds: GroundType[] = ["grass", "sand", "rock", "water", "snow", "path"];
    for (const g of grounds) {
      expect(footstepVolume(g, 0)).toBeLessThan(footstepVolume(g, 1));
      expect(footstepVolume(g, 1)).toBeLessThanOrEqual(0.7);
    }
  });
});

// ---------------------------------------------------------------- strict fake Web Audio

class FakeParam {
  value: number;
  constructor(v = 0) {
    this.value = v;
  }
  private check(v: number, t: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new Error(`non-finite param value ${v} @ ${t}`);
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t);
    if (v <= 0) throw new Error(`exponential ramp to ${v}`);
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    this.check(v, t);
    if (!(c > 0)) throw new Error("bad time constant");
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

let liveSources = 0;
class FakeNode {
  connect<T>(n: T): T {
    if (!n) throw new Error("connect to nothing");
    return n;
  }
  disconnect() {}
}
class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = false;
  start(t = 0) {
    if (this.started) throw new Error("started twice");
    if (!Number.isFinite(t)) throw new Error("bad start");
    this.started = true;
    liveSources++;
  }
  stop() {
    if (!this.started) throw new Error("stop before start");
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  destination = new FakeNode();
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam(1) });
  }
  createOscillator() {
    return Object.assign(new FakeSource(), { type: "sine", frequency: new FakeParam(440), detune: new FakeParam(0) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0) });
  }
  createBufferSource() {
    return Object.assign(new FakeSource(), { buffer: null as unknown, loop: false, playbackRate: new FakeParam(1) });
  }
  createBuffer(ch: number, len: number, rate: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (i: number) => data[i] };
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) });
  }
  createConvolver() {
    return Object.assign(new FakeNode(), { buffer: null as unknown });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
}

describe("synth smoke test (fake AudioContext)", () => {
  let ctx: FakeContext;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeContext };
  });
  afterAll(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("everything is a safe no-op before unlock", async () => {
    const { playSfx } = await import("@/audio/sfx");
    const { playCreatureSound, playFootstep } = await import("@/audio/creatures");
    const { updateAmbience } = await import("@/audio/ambience");
    const { setMusicRegion } = await import("@/audio/music");
    expect(() => playSfx("sticker")).not.toThrow();
    expect(playCreatureSound("cat")).toBe(false);
    expect(() => playFootstep("grass")).not.toThrow();
    expect(() => updateAmbience(at("forest"))).not.toThrow();
    expect(() => setMusicRegion("lake")).not.toThrow();
  });

  it("plays every effect, call, footstep, ambience layer and music palette without errors", async () => {
    const engine = await import("@/audio/engine");
    const { playSfx, isSfxName } = await import("@/audio/sfx");
    const { playCreatureSound, playFootstep } = await import("@/audio/creatures");
    const { updateAmbience, getAmbienceLevels, stopAmbience } = await import("@/audio/ambience");
    const music = await import("@/audio/music");
    const { environment } = await import("@/world/environment");

    ctx = engine.unlockAudio() as unknown as FakeContext;
    expect(ctx).toBeTruthy();

    // Sound effects: every name, plus unknown names are ignored.
    const names = [
      "pop", "chime", "rustle", "boing", "sparkle", "whoosh", "splash", "click", "error", "stamp", "note", "step",
      "sticker", "camera", "ribbon", "cheer", "plane", "unfold", "rain-start", "rainbow", "pat", "jump", "found", "guide",
    ] as const;
    for (const n of names) {
      expect(isSfxName(n)).toBe(true);
      expect(() => playSfx(n, { pan: 0.3 })).not.toThrow();
    }
    expect(isSfxName("nope")).toBe(false);
    expect(() => (playSfx as (n: string) => void)("nope")).not.toThrow();
    expect(() => (playSfx as (n: string) => void)("toString")).not.toThrow();

    // Creature calls for every kind (advance time past throttles and voice caps).
    const before = liveSources;
    for (const k of KINDS) {
      ctx.currentTime += 3;
      vi.advanceTimersByTime(1000);
      expect(playCreatureSound(k.id, { pan: -0.5, volume: 0.8 })).toBe(true);
    }
    ctx.currentTime += 3;
    vi.advanceTimersByTime(1000);
    expect(playCreatureSound("mystery-thing")).toBe(true);
    expect(playCreatureSound("mystery-thing")).toBe(false); // throttled
    expect(liveSources).toBeGreaterThan(before);

    // Footsteps on every ground; throttled when too quick.
    const grounds: GroundType[] = ["grass", "sand", "rock", "water", "snow", "path"];
    for (const g of grounds) {
      vi.advanceTimersByTime(200);
      expect(() => playFootstep(g, 0.7)).not.toThrow();
    }
    const s0 = liveSources;
    playFootstep("grass");
    expect(liveSources).toBe(s0);

    // Ambience across every region, at night, in rain and snow, and in planet view.
    const states: Array<[Partial<typeof environment>, Partial<AmbienceInput>]> = [
      [{ daylight: 1, weather: "clear", weatherAmount: 0 }, {}],
      [{ daylight: 0, isNight: true }, { moving: true }],
      [{ daylight: 0.6, dusk: 1, weather: "rain", weatherAmount: 1, wind: 1 }, { nearWater: 1 }],
      [{ daylight: 1, dusk: 0, weather: "snow", weatherAmount: 1 }, { altitude: 1 }],
      [{ weather: "rainbow" }, { inPlanetView: true }],
    ];
    let maxBeds = 0;
    const ambBefore = liveSources;
    for (const [e, extra] of states) {
      Object.assign(environment, e);
      for (const r of ALL_REGIONS) {
        for (let i = 0; i < 30; i++) {
          updateAmbience(at(r, { secondRegion: "coast", blend: 0.3, ...extra }));
          ctx.currentTime += 0.1;
          vi.advanceTimersByTime(100);
        }
        const lv = getAmbienceLevels();
        expect(lv.running).toBe(true);
        expect(Object.keys(lv.beds).length).toBeLessThanOrEqual(6);
        maxBeds = Math.max(maxBeds, Object.keys(lv.beds).length);
      }
    }
    expect(maxBeds).toBeGreaterThan(1);
    expect(liveSources - ambBefore).toBeGreaterThan(200); // beds + plenty of one-shot calls
    Object.assign(environment, { daylight: 1, dusk: 0, isNight: false, weather: "clear", weatherAmount: 0, wind: 0.2 });

    // Updates stop → fades out and tears down.
    stopAmbience();
    for (let i = 0; i < 100; i++) {
      ctx.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    expect(getAmbienceLevels().running).toBe(false);

    // Music: every region palette, both flavours, night.
    music.startMusic();
    expect(music.isMusicPlaying()).toBe(true);
    for (const r of [...ALL_REGIONS, null]) {
      music.setMusicRegion(r);
      expect(music.getMusicRegion()).toBe(r);
      for (let i = 0; i < 200; i++) {
        ctx.currentTime += 0.1;
        vi.advanceTimersByTime(100);
      }
    }
    environment.daylight = 0;
    music.setMusicFlavor("gallery");
    music.setMusicRegion("lake");
    for (let i = 0; i < 300; i++) {
      ctx.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    expect(music.getMusicInstrument()).toBe("harp");
    environment.daylight = 1;
    music.stopMusic();
    expect(music.isMusicPlaying()).toBe(false);
    vi.advanceTimersByTime(10_000);
  });
});
