// Pure (Web-Audio-free) decision logic for the sound system, so it can be unit
// tested in Node: region soundscapes and crossfade weights, music palettes,
// creature-sound families, throttling and voice limiting.

import type { RegionKind } from "@/world/planet";
import type { EnvironmentState } from "@/world/environment";
import type { GroundType, KindCategory } from "@/core/types";
import { KIND_BY_ID } from "@/core/kinds";

export const ALL_REGIONS: RegionKind[] = [
  "garden",
  "lily",
  "village",
  "picnic",
  "meadow",
  "cherry",
  "forest",
  "farm",
  "duckpond",
  "coast",
  "mountain",
  "lake",
];

// ---------------------------------------------------------------- generic helpers

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Exponential smoothing toward `target` with time constant `tau` seconds (≈ 3·tau to settle). */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0)) return current;
  if (!(tau > 0)) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Per-key minimum-interval throttle with an injectable clock (milliseconds). */
export class Throttle {
  private last = new Map<string, number>();
  constructor(private intervalMs: number) {}
  /** True (and records the time) if `key` may fire now. */
  tryAcquire(key: string, nowMs: number, intervalMs = this.intervalMs): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && nowMs - prev < intervalMs) return false;
    this.last.set(key, nowMs);
    if (this.last.size > 200) {
      const oldest = this.last.keys().next().value;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    return true;
  }
  reset(): void {
    this.last.clear();
  }
}

/** Prune finished voices (end times ≤ now) in place and return how many are still sounding. */
export function activeVoices(endTimes: number[], now: number): number {
  for (let i = endTimes.length - 1; i >= 0; i--) if (endTimes[i] <= now) endTimes.splice(i, 1);
  return endTimes.length;
}

/** Keys of the `n` largest weights that are above `threshold`. */
export function topN<K extends string>(weights: Record<K, number>, n: number, threshold: number): Set<K> {
  const keys = (Object.keys(weights) as K[]).filter((k) => weights[k] > threshold);
  keys.sort((a, b) => weights[b] - weights[a]);
  return new Set(keys.slice(0, Math.max(0, n)));
}

/** Probability that a Poisson event with `rate`/s (scaled by weight) fires in `dt` seconds. */
export function eventProbability(rate: number, weight: number, dt: number): number {
  const lambda = Math.max(0, rate) * Math.max(0, weight) * Math.max(0, dt);
  return 1 - Math.exp(-lambda);
}

// ---------------------------------------------------------------- ambience

/** Continuous looping layers. */
export type BedId = "breeze" | "gust" | "leaves" | "lap" | "waves" | "hum" | "bees" | "rain" | "whistle" | "space";
/** Randomly scheduled one-shots. */
export type AmbientEventId =
  | "bird"
  | "eveningBird"
  | "frog"
  | "quack"
  | "chime"
  | "bell"
  | "murmur"
  | "moo"
  | "baa"
  | "cluck"
  | "creak"
  | "kite"
  | "loon"
  | "gull"
  | "foghorn"
  | "cricket"
  | "owl"
  | "droplet"
  | "crunch";

export const BED_IDS: BedId[] = ["breeze", "gust", "leaves", "lap", "waves", "hum", "bees", "rain", "whistle", "space"];
export const EVENT_IDS: AmbientEventId[] = [
  "bird",
  "eveningBird",
  "frog",
  "quack",
  "chime",
  "bell",
  "murmur",
  "moo",
  "baa",
  "cluck",
  "creak",
  "kite",
  "loon",
  "gull",
  "foghorn",
  "cricket",
  "owl",
  "droplet",
  "crunch",
];

/** Maximum looping beds running at once, and one-shot ambient calls sounding at once. */
export const MAX_AMBIENT_BEDS = 6;
export const MAX_AMBIENT_EVENTS = 5;

export interface RegionSoundscape {
  beds: Partial<Record<BedId, number>>;
  events: Partial<Record<AmbientEventId, number>>;
  /** How much night insects (crickets) live here, 0..1. */
  insects: number;
  /** How likely owls are here, 0..1. */
  owls: number;
}

export const REGION_SOUNDSCAPES: Record<RegionKind, RegionSoundscape> = {
  garden: { beds: { breeze: 0.5, bees: 0.55, leaves: 0.15 }, events: { bird: 0.55 }, insects: 0.8, owls: 0.3 },
  lily: { beds: { lap: 0.7, breeze: 0.3 }, events: { frog: 1, bird: 0.2 }, insects: 0.6, owls: 0.3 },
  village: { beds: { hum: 0.65, breeze: 0.3 }, events: { bell: 1, murmur: 1, bird: 0.25 }, insects: 0.5, owls: 0.3 },
  picnic: { beds: { breeze: 0.7, leaves: 0.2, bees: 0.2 }, events: { kite: 1, bird: 0.5 }, insects: 0.8, owls: 0.3 },
  meadow: { beds: { breeze: 0.6, bees: 0.75, leaves: 0.1 }, events: { bird: 0.5 }, insects: 1, owls: 0.3 },
  cherry: { beds: { breeze: 0.55, bees: 0.3, leaves: 0.2 }, events: { chime: 1, bird: 0.4 }, insects: 0.7, owls: 0.4 },
  forest: { beds: { leaves: 0.8, breeze: 0.3 }, events: { bird: 1 }, insects: 0.7, owls: 1 },
  farm: { beds: { breeze: 0.5, bees: 0.2 }, events: { moo: 1, baa: 1, cluck: 1, creak: 1, bird: 0.2 }, insects: 0.9, owls: 0.4 },
  duckpond: { beds: { lap: 0.7, breeze: 0.3 }, events: { frog: 0.6, quack: 1, bird: 0.2 }, insects: 0.6, owls: 0.3 },
  coast: { beds: { waves: 1, breeze: 0.4 }, events: { gull: 1, foghorn: 1 }, insects: 0.1, owls: 0.05 },
  mountain: { beds: { gust: 0.55, whistle: 0.6, breeze: 0.2 }, events: { crunch: 0.25 }, insects: 0.1, owls: 0.2 },
  lake: { beds: { lap: 0.8, breeze: 0.3 }, events: { loon: 1, bird: 0.2, frog: 0.2 }, insects: 0.4, owls: 0.4 },
};

/** Average events per second at weight 1. */
export const EVENT_RATES: Record<AmbientEventId, number> = {
  bird: 0.38,
  eveningBird: 0.16,
  frog: 0.5,
  quack: 0.09,
  chime: 0.12,
  bell: 0.035,
  murmur: 0.14,
  moo: 0.035,
  baa: 0.045,
  cluck: 0.08,
  creak: 0.1,
  kite: 0.1,
  loon: 0.04,
  gull: 0.1,
  foghorn: 0.012,
  cricket: 1.3,
  owl: 0.05,
  droplet: 6,
  crunch: 0.6,
};

export interface AmbienceInput {
  region: RegionKind;
  secondRegion: RegionKind;
  /** 0 = fully in `region`, up to 0.5 at a border. */
  blend: number;
  moving: boolean;
  /** 0..1 closeness to water. */
  nearWater: number;
  /** 0..1 height above the ground/sea (optional). */
  altitude?: number;
  inPlanetView: boolean;
}

export type AmbienceEnv = Pick<EnvironmentState, "daylight" | "dusk" | "isNight" | "weather" | "weatherAmount" | "season" | "wind">;

export interface AmbienceTargets {
  beds: Record<BedId, number>;
  events: Record<AmbientEventId, number>;
  /** Low-pass cutoff (Hz) applied to the whole ambience (rain/snow muffle it). */
  muffle: number;
  /** Overall ambience level 0..1 (snow hushes). */
  level: number;
}

/** Region weights for the player's position: primary gets 1 − blend, the neighbour gets blend. */
export function regionMix(region: RegionKind, second: RegionKind, blend: number): Array<{ region: RegionKind; weight: number }> {
  const b = Math.min(0.5, clamp01(blend));
  if (region === second || b <= 0) return [{ region, weight: 1 }];
  return [
    { region, weight: 1 - b },
    { region: second, weight: b },
  ];
}

function zeroBeds(): Record<BedId, number> {
  return Object.fromEntries(BED_IDS.map((id) => [id, 0])) as Record<BedId, number>;
}
function zeroEvents(): Record<AmbientEventId, number> {
  return Object.fromEntries(EVENT_IDS.map((id) => [id, 0])) as Record<AmbientEventId, number>;
}

/** Environment with nothing special going on (bright, calm day). */
export const NEUTRAL_ENV: AmbienceEnv = {
  daylight: 1,
  dusk: 0,
  isNight: false,
  weather: "clear",
  weatherAmount: 0,
  season: "summer",
  wind: 0.2,
};

/**
 * Target levels (0..~1) for every ambient layer given where the player is and
 * the current time of day / weather. The runtime smooths toward these.
 */
export function computeAmbienceTargets(input: AmbienceInput, envIn: AmbienceEnv = NEUTRAL_ENV): AmbienceTargets {
  const beds = zeroBeds();
  const events = zeroEvents();
  if (input.inPlanetView) {
    beds.space = 1;
    return { beds, events, muffle: 9000, level: 0.8 };
  }
  const env = envIn ?? NEUTRAL_ENV;
  const day = clamp01(env.daylight);
  const night = 1 - day;
  const dusk = clamp01(env.dusk);
  const amount = clamp01(env.weatherAmount);
  const rain = env.weather === "rain" ? amount : 0;
  const snow = env.weather === "snow" ? amount : 0;
  const cloudy = env.weather === "cloudy" ? amount : 0;
  const wind = clamp01(env.wind);
  const winter = env.season === "winter" ? 1 : 0;

  let insects = 0;
  let owls = 0;
  let birdBase = 0;
  let mountain = 0;
  let forest = 0;
  for (const { region, weight } of regionMix(input.region, input.secondRegion, input.blend)) {
    const s = REGION_SOUNDSCAPES[region];
    for (const id of Object.keys(s.beds) as BedId[]) beds[id] += (s.beds[id] ?? 0) * weight;
    for (const id of Object.keys(s.events) as AmbientEventId[]) events[id] += (s.events[id] ?? 0) * weight;
    insects += s.insects * weight;
    owls += s.owls * weight;
    if (region === "mountain") mountain += weight;
    if (region === "forest") forest += weight;
  }
  birdBase = events.bird;

  // Water nearby always laps a little, whatever the region.
  beds.lap = Math.max(beds.lap, clamp01(input.nearWater) * 0.7);

  // Wind: gusts follow environment.wind, stronger up high and on the mountain.
  const alt = clamp01(input.altitude ?? 0);
  beds.gust = clamp01(beds.gust + wind * (0.35 + 0.45 * mountain) + alt * 0.3);
  beds.whistle = clamp01(beds.whistle * (0.6 + 0.6 * wind) + alt * 0.2 * mountain);
  beds.leaves *= 0.6 + 0.8 * wind;
  beds.breeze *= 0.75 + 0.5 * wind;
  if (input.moving) beds.leaves += 0.15 * forest;

  // Day creatures sleep at night, hide in rain and snow.
  const birdy = day * (1 - 0.85 * rain) * (1 - 0.7 * snow) * (1 - 0.25 * cloudy);
  events.bird *= birdy * (1 - 0.4 * dusk);
  events.eveningBird = birdBase * dusk * (1 - 0.8 * rain) * (1 - 0.6 * snow);
  beds.bees *= day * day * (1 - rain) * (1 - snow) * (1 - 0.85 * winter) * (1 - 0.3 * cloudy);
  events.kite *= (0.3 + 0.7 * day) * (1 - rain) * (0.6 + 0.6 * wind);
  events.murmur *= (0.35 + 0.65 * day) * (1 - 0.5 * rain);
  events.bell *= 0.5 + 0.5 * day;
  for (const id of ["moo", "baa", "cluck"] as const) events[id] *= (0.25 + 0.75 * day) * (1 - 0.6 * rain);
  events.creak *= 0.5 + 0.8 * wind;
  events.gull *= (0.2 + 0.8 * day) * (1 - 0.6 * rain);
  events.chime *= 0.6 + 0.8 * wind;

  // Night: frogs louder, crickets and owls appear.
  events.frog *= (1 + 0.8 * night) * (1 - 0.8 * snow) * (1 - 0.6 * winter);
  events.cricket = insects * night * (1 - 0.7 * rain) * (1 - snow) * (1 - 0.8 * winter);
  events.owl = owls * night * (1 - 0.6 * rain);
  events.loon *= 0.7 + 0.6 * night;

  // Mountain snow crunches when moving.
  events.crunch = input.moving ? events.crunch * 4 : events.crunch;

  // Rain bed + droplets.
  beds.rain = rain;
  events.droplet = rain;

  // Muffle and hush.
  const muffleAmount = Math.max(rain * 0.75, snow * 0.85);
  const muffle = 16000 * Math.pow(2200 / 16000, muffleAmount);
  const level = 1 - 0.4 * snow - 0.1 * rain;

  for (const id of BED_IDS) beds[id] = clamp01(beds[id]);
  for (const id of EVENT_IDS) events[id] = Math.max(0, Math.min(2, events[id]));
  return { beds, events, muffle, level };
}

/** Targets when ambience should be silent (e.g. updates stopped). */
export function silentTargets(): AmbienceTargets {
  return { beds: zeroBeds(), events: zeroEvents(), muffle: 16000, level: 0 };
}

/** Smooth every layer of `current` toward `target` in place. */
export function smoothTargets(current: AmbienceTargets, target: AmbienceTargets, dt: number, tau = 0.8): void {
  for (const id of BED_IDS) current.beds[id] = smoothToward(current.beds[id], target.beds[id], dt, tau);
  for (const id of EVENT_IDS) current.events[id] = smoothToward(current.events[id], target.events[id], dt, tau);
  current.muffle = smoothToward(current.muffle, target.muffle, dt, tau * 1.5);
  current.level = smoothToward(current.level, target.level, dt, tau);
}

// ---------------------------------------------------------------- music

export type MusicInstrument = "soft" | "musicbox" | "marimba" | "flute" | "harp" | "pad";

export const REGION_INSTRUMENT: Record<RegionKind, MusicInstrument> = {
  garden: "musicbox",
  cherry: "musicbox",
  meadow: "marimba",
  farm: "marimba",
  picnic: "marimba",
  village: "marimba",
  duckpond: "marimba",
  forest: "flute",
  lake: "harp",
  coast: "harp",
  lily: "harp",
  mountain: "pad",
};

export interface MusicPalette {
  instrument: MusicInstrument;
  /** Seconds per eighth-note step. */
  stepSeconds: number;
  /** Multiplier on the chance of a melody note per step. */
  density: number;
  /** Melody scale (MIDI notes, C major pentatonic family). */
  scale: number[];
  padLevel: number;
  padTypes: OscillatorType[];
  melodyLevel: number;
  /** Dry low-pass cutoff in Hz. */
  brightness: number;
  /** Chance a whole chord has no melody. */
  restChance: number;
  /** Harp-style rolled chord at the start of chords. */
  arpeggio: boolean;
}

const PENTA_MID = [72, 74, 76, 79, 81, 84, 86, 88];

export const MUSIC_PALETTES: Record<MusicInstrument, MusicPalette> = {
  soft: { instrument: "soft", stepSeconds: 0.5, density: 1, scale: PENTA_MID, padLevel: 0.022, padTypes: ["sine", "triangle"], melodyLevel: 0.055, brightness: 2600, restChance: 0.4, arpeggio: false },
  musicbox: { instrument: "musicbox", stepSeconds: 0.48, density: 1.15, scale: PENTA_MID, padLevel: 0.016, padTypes: ["sine"], melodyLevel: 0.05, brightness: 4200, restChance: 0.35, arpeggio: false },
  marimba: { instrument: "marimba", stepSeconds: 0.42, density: 1.25, scale: [67, 69, 72, 74, 76, 79, 81, 84], padLevel: 0.017, padTypes: ["sine", "triangle"], melodyLevel: 0.07, brightness: 3400, restChance: 0.35, arpeggio: false },
  flute: { instrument: "flute", stepSeconds: 0.55, density: 0.8, scale: [69, 72, 74, 76, 79, 81, 84, 86], padLevel: 0.02, padTypes: ["sine"], melodyLevel: 0.05, brightness: 2400, restChance: 0.4, arpeggio: false },
  harp: { instrument: "harp", stepSeconds: 0.5, density: 0.95, scale: [67, 69, 72, 74, 76, 79, 81, 84], padLevel: 0.018, padTypes: ["sine", "triangle"], melodyLevel: 0.06, brightness: 3000, restChance: 0.35, arpeggio: true },
  pad: { instrument: "pad", stepSeconds: 0.6, density: 0.5, scale: [76, 79, 81, 84, 86, 88, 91], padLevel: 0.028, padTypes: ["sine", "sine"], melodyLevel: 0.04, brightness: 2200, restChance: 0.5, arpeggio: false },
};

export function paletteForRegion(region: RegionKind | null | undefined): MusicPalette {
  return MUSIC_PALETTES[region ? (REGION_INSTRUMENT[region] ?? "soft") : "soft"];
}

export interface MusicMood {
  night: number;
  rain: number;
  snow: number;
}

export function moodFromEnv(env: Pick<EnvironmentState, "daylight" | "weather" | "weatherAmount"> | null | undefined): MusicMood {
  if (!env) return { night: 0, rain: 0, snow: 0 };
  const amount = clamp01(env.weatherAmount);
  return {
    night: 1 - clamp01(env.daylight),
    rain: env.weather === "rain" ? amount : 0,
    snow: env.weather === "snow" ? amount : 0,
  };
}

export interface MusicShape {
  stepSeconds: number;
  density: number;
  melodyLevel: number;
  padLevel: number;
  brightness: number;
  restChance: number;
  /** Semitones to move the melody (lower lullaby voicing at night). */
  transpose: number;
}

/** Combine a region palette with the time-of-day / weather mood. */
export function shapeMusic(p: MusicPalette, mood: MusicMood): MusicShape {
  const night = clamp01(mood.night);
  const rain = clamp01(mood.rain);
  const snow = clamp01(mood.snow);
  return {
    stepSeconds: p.stepSeconds * (1 + 0.3 * night),
    density: p.density * (1 - 0.45 * night) * (1 - 0.5 * rain) * (1 - 0.25 * snow),
    melodyLevel: p.melodyLevel * (1 - 0.3 * night),
    padLevel: p.padLevel * (1 - 0.2 * night),
    brightness: p.brightness * (1 - 0.45 * night) * (1 - 0.25 * rain),
    restChance: Math.min(0.8, p.restChance + 0.2 * rain + 0.1 * night),
    transpose: night > 0.6 ? -12 : 0,
  };
}

/** Probability (0..1) that a note in a transition uses the new instrument. */
export function transitionMix(elapsed: number, duration: number): number {
  if (!(duration > 0)) return 1;
  return clamp01(elapsed / duration);
}

// ---------------------------------------------------------------- creatures

export type CreatureFamily =
  | "meow"
  | "woof"
  | "yip"
  | "tweet"
  | "hoot"
  | "ribbit"
  | "quack"
  | "honk"
  | "moo"
  | "baa"
  | "oink"
  | "cluck"
  | "neigh"
  | "buzz"
  | "roar"
  | "trumpet"
  | "squeak"
  | "robot"
  | "engine"
  | "toot"
  | "ring"
  | "zoom"
  | "blub"
  | "whale"
  | "twinkle"
  | "boo"
  | "chatter"
  | "hum"
  | "rustle"
  | "pop"
  | "chime"
  | "hello"
  | "boing";

export const KIND_FAMILY: Record<string, CreatureFamily> = {
  cat: "meow",
  dog: "woof",
  fox: "yip",
  rabbit: "squeak",
  mouse: "squeak",
  horse: "neigh",
  unicorn: "neigh",
  cow: "moo",
  pig: "oink",
  sheep: "baa",
  bear: "roar",
  lion: "roar",
  dinosaur: "roar",
  dragon: "roar",
  monster: "roar",
  elephant: "trumpet",
  giraffe: "hum",
  turtle: "hum",
  snail: "hum",
  frog: "ribbit",
  chicken: "cluck",
  monkey: "chatter",
  bird: "tweet",
  owl: "hoot",
  butterfly: "twinkle",
  ladybug: "twinkle",
  bee: "buzz",
  dragonfly: "buzz",
  fish: "blub",
  octopus: "blub",
  shark: "blub",
  whale: "whale",
  duck: "quack",
  swan: "honk",
  person: "hello",
  family: "hello",
  robot: "robot",
  alien: "robot",
  flower: "chime",
  sunflower: "chime",
  tree: "rustle",
  bush: "rustle",
  mushroom: "pop",
  cactus: "boing",
  house: "chime",
  castle: "toot",
  tower: "chime",
  shop: "ring",
  tent: "rustle",
  bridge: "pop",
  car: "engine",
  bus: "engine",
  truck: "engine",
  tractor: "engine",
  train: "toot",
  boat: "toot",
  bicycle: "ring",
  airplane: "zoom",
  rocket: "zoom",
  helicopter: "zoom",
  balloon: "boing",
  ghost: "boo",
  fairy: "twinkle",
  cloud: "hum",
  star: "twinkle",
  heart: "twinkle",
  rainbow: "twinkle",
  sculpture: "boing",
};

export const CATEGORY_FAMILY: Record<KindCategory, CreatureFamily> = {
  animal: "tweet",
  plant: "rustle",
  building: "chime",
  person: "hello",
  vehicle: "engine",
  imaginary: "boing",
  thing: "boing",
};

/** Sound family for a kind id; unknown kinds fall back by category, then "boing". */
export function creatureFamily(kindId: string): CreatureFamily {
  const direct = KIND_FAMILY[kindId];
  if (direct) return direct;
  const kind = KIND_BY_ID[kindId];
  if (kind) return CATEGORY_FAMILY[kind.category] ?? "boing";
  return "boing";
}

/** Pitch multiplier from a kind's voice size. */
export function voicePitch(voice: "small" | "big" | "bright" | "calm" | "silly" | undefined): number {
  switch (voice) {
    case "small":
      return 1.25;
    case "big":
      return 0.8;
    case "bright":
      return 1.1;
    case "silly":
      return 1.05;
    default:
      return 1;
  }
}

export const CREATURE_MIN_INTERVAL_MS = 650;
export const MAX_CREATURE_VOICES = 4;

// ---------------------------------------------------------------- footsteps

export const FOOTSTEP_MIN_INTERVAL_MS = 120;

/** Base loudness per ground (the sfx bus volume applies on top). */
export const FOOTSTEP_LEVEL: Record<GroundType, number> = {
  grass: 0.55,
  sand: 0.6,
  path: 0.5,
  rock: 0.45,
  snow: 0.6,
  water: 0.55,
};

export function footstepVolume(ground: GroundType, intensity = 1): number {
  return (FOOTSTEP_LEVEL[ground] ?? 0.5) * (0.4 + 0.6 * clamp01(intensity));
}
