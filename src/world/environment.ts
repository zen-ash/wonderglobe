// Shared environment state: time of day, weather, season and wind.
// A single mutable object read by rendering, audio and simulation every frame.
// Everything in this module is pure TypeScript (no three.js, no DOM), so it
// can be unit tested and stepped from anywhere.
//
// Driving: <SkyAndLights/> (src/render/Sky.tsx) calls `initEnvironment()` on
// mount and `stepEnvironment(dt)` once per frame. Nothing else should step it.

export type Weather = "clear" | "cloudy" | "rain" | "rainbow" | "snow";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type TimeMode = "real" | "cycle" | "day";

export interface EnvironmentState {
  /** Fraction of the day, 0 = midnight, 0.5 = noon. */
  time: number;
  /** 0 at night … 1 in full day (smooth). */
  daylight: number;
  /** 0..1 strength of sunrise/sunset glow. */
  dusk: number;
  isNight: boolean;
  weather: Weather;
  /** 0..1 how strongly the current weather is showing (fades in/out). */
  weatherAmount: number;
  season: Season;
  /** 0..1 gust strength right now. */
  wind: number;
  timeMode: TimeMode;

  // ---- additions (read-only for consumers) ----
  /** Sine of the sun's altitude: 1 at noon, 0 on the horizon, -1 at midnight. */
  sunElevation: number;
  /** True during the morning half of the day (sun rising). */
  morning: boolean;
  /** Smoothed 0..1 channels, handy for rendering and audio. */
  clouds: number;
  rain: number;
  snow: number;
  rainbow: number;
  /** Ground snow cover 0..1 (winter, deepened by snowfall). */
  snowCover: number;
  /** Global wind direction, radians (slowly drifting). */
  windAngle: number;
  /** Seconds since `initEnvironment` (simulation clock, paused with the game). */
  elapsed: number;
  /** Seconds left in the current weather state. */
  weatherTimeLeft: number;
  /** URL / debug overrides (null = free). */
  fixedTime: number | null;
  fixedWeather: Weather | null;
  fixedSeason: Season | null;
  /** Flags from the settings. */
  reducedMotion: boolean;
  lightGraphics: boolean;
}

export const environment: EnvironmentState = {
  time: 0.38,
  daylight: 1,
  dusk: 0,
  isNight: false,
  weather: "clear",
  weatherAmount: 0,
  season: "summer",
  wind: 0.2,
  timeMode: "cycle",
  sunElevation: 0.7,
  morning: true,
  clouds: 0.15,
  rain: 0,
  snow: 0,
  rainbow: 0,
  snowCover: 0,
  windAngle: 0.6,
  elapsed: 0,
  weatherTimeLeft: 120,
  fixedTime: null,
  fixedWeather: null,
  fixedSeason: null,
  reducedMotion: false,
  lightGraphics: false,
};

// ------------------------------------------------------------------ constants

/** A full "cycle" day lasts 12 minutes of play. */
export const CYCLE_SECONDS = 720;
/** Part of the cycle spent between dawn and dusk (days are long, nights cosy and short). */
const DAY_SHARE = 0.76;
const DAY_START = 0.21;
const DAY_END = 0.79;
/** The cycle starts at mid-morning. */
export const START_TIME = 0.38;
/** Time shown in "day" mode. */
export const DAY_MODE_TIME = 0.45;

/** Named times for the `?time=` override. */
export const NAMED_TIMES = {
  dawn: 0.262,
  day: 0.42,
  noon: 0.5,
  dusk: 0.738,
  night: 0.94,
  midnight: 0.0,
} as const;

const WEATHERS: Weather[] = ["clear", "cloudy", "rain", "rainbow", "snow"];
const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const TIME_MODES: TimeMode[] = ["real", "cycle", "day"];

// ------------------------------------------------------------- pure helpers

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const wrap01 = (x: number) => ((x % 1) + 1) % 1;

/** Sine of the sun's altitude for a time of day (sunrise 0.25, sunset 0.75). */
export function sunElevationAt(time: number): number {
  return Math.sin((wrap01(time) - 0.25) * Math.PI * 2);
}

/** Smooth 0..1 daylight. Twilight lasts a while so the change is gentle. */
export function daylightAt(time: number): number {
  return smoothstep(-0.16, 0.2, sunElevationAt(time));
}

/** 0..1 sunrise/sunset glow, peaking when the sun touches the horizon. */
export function duskAt(time: number): number {
  const e = sunElevationAt(time) - 0.03;
  return Math.exp(-((e / 0.2) ** 2));
}

export function isNightAt(time: number): boolean {
  return daylightAt(time) < 0.3;
}

/** Cycle phase (0..1 over CYCLE_SECONDS) → time of day. Day takes DAY_SHARE of the cycle. */
export function cycleTimeFromPhase(phase: number): number {
  const p = wrap01(phase);
  if (p < DAY_SHARE) return DAY_START + (p / DAY_SHARE) * (DAY_END - DAY_START);
  return wrap01(DAY_END + ((p - DAY_SHARE) / (1 - DAY_SHARE)) * (1 - (DAY_END - DAY_START)));
}

/** Inverse of cycleTimeFromPhase. */
export function cyclePhaseForTime(time: number): number {
  const t = wrap01(time);
  if (t >= DAY_START && t < DAY_END) return ((t - DAY_START) / (DAY_END - DAY_START)) * DAY_SHARE;
  const nightLen = 1 - (DAY_END - DAY_START);
  const into = wrap01(t - DAY_END);
  return DAY_SHARE + (into / nightLen) * (1 - DAY_SHARE);
}

/** Time of day from a wall clock (local time). */
export function realTimeOfDay(date: Date): number {
  return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400;
}

/** Season from a date (northern-hemisphere months unless `southern`). */
export function seasonFromDate(date: Date, southern = false): Season {
  const m = date.getMonth(); // 0 = January
  let s: Season;
  if (m >= 2 && m <= 4) s = "spring";
  else if (m >= 5 && m <= 7) s = "summer";
  else if (m >= 8 && m <= 10) s = "autumn";
  else s = "winter";
  if (!southern) return s;
  return ({ spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" } as const)[s];
}

export interface EnvironmentOverrides {
  time?: number;
  weather?: Weather;
  season?: Season;
  timeMode?: TimeMode;
}

/**
 * Parse `?time=night|dusk|dawn|day|noon|midnight|<hours 0-24>`,
 * `?weather=rain|snow|rainbow|cloudy|clear`, `?season=spring|summer|autumn|winter`
 * and `?timeMode=real|cycle|day`. Unknown values are ignored.
 */
export function parseEnvironmentOverrides(search: string): EnvironmentOverrides {
  const out: EnvironmentOverrides = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  const time = params.get("time")?.trim().toLowerCase();
  if (time) {
    if (time in NAMED_TIMES) out.time = NAMED_TIMES[time as keyof typeof NAMED_TIMES];
    else {
      const h = Number(time);
      if (Number.isFinite(h) && h >= 0 && h <= 24) out.time = wrap01(h / 24);
    }
  }
  const weather = params.get("weather")?.trim().toLowerCase();
  if (weather && (WEATHERS as string[]).includes(weather)) out.weather = weather as Weather;
  const season = params.get("season")?.trim().toLowerCase();
  if (season && (SEASONS as string[]).includes(season)) out.season = season as Season;
  else if (season === "fall") out.season = "autumn";
  const mode = (params.get("timeMode") ?? params.get("timemode"))?.trim().toLowerCase();
  if (mode && (TIME_MODES as string[]).includes(mode)) out.timeMode = mode as TimeMode;
  return out;
}

// ------------------------------------------------------------ weather logic

/** How long a weather state lasts (seconds), before reduced-motion scaling. */
export const WEATHER_DURATIONS: Record<Weather, [number, number]> = {
  clear: [100, 200],
  cloudy: [40, 75],
  rain: [35, 60],
  rainbow: [30, 45],
  snow: [50, 90],
};

export function weatherDuration(w: Weather, rand: () => number): number {
  const [a, b] = WEATHER_DURATIONS[w];
  return a + (b - a) * clamp01(rand());
}

/**
 * The weather state machine: mostly clear, sometimes cloudy → rain → a
 * rainbow afterwards (only in daylight). In winter the clouds bring snow
 * instead of rain.
 */
export function nextWeather(current: Weather, season: Season, rand: () => number, daylight = 1): Weather {
  const r = rand();
  switch (current) {
    case "clear":
      return r < 0.6 ? "cloudy" : "clear";
    case "cloudy":
      if (r < 0.55) return season === "winter" ? "snow" : "rain";
      return "clear";
    case "rain":
      return daylight > 0.45 ? "rainbow" : "cloudy";
    case "snow":
      return r < 0.3 ? "cloudy" : "clear";
    case "rainbow":
    default:
      return "clear";
  }
}

/** Overcast amount each weather aims for. */
const CLOUD_TARGET: Record<Weather, number> = { clear: 0.12, cloudy: 0.6, rain: 1, rainbow: 0.35, snow: 0.8 };
/** Base wind for each weather. */
const WIND_BASE: Record<Weather, number> = { clear: 0.22, cloudy: 0.35, rain: 0.55, rainbow: 0.25, snow: 0.32 };
/** Seconds to fade a weather in or out. */
const WEATHER_FADE = 8;

// ------------------------------------------------------------- random source

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand: () => number = mulberry32(Date.now() & 0xffffffff);
let phase = cyclePhaseForTime(START_TIME);
let weatherAge = 0;
let weatherTotal = WEATHER_DURATIONS.clear[0];

// ------------------------------------------------------------------ the API

export interface InitOptions {
  /** URL query string (e.g. window.location.search) for overrides. */
  search?: string;
  /** Current date (season + "real" mode). Defaults to now. */
  now?: Date;
  timeMode?: TimeMode;
  reducedMotion?: boolean;
  lightGraphics?: boolean;
  /** Random source for the weather (tests). */
  random?: () => number;
}

/** Reset the environment for a freshly loaded world. */
export function initEnvironment(opts: InitOptions = {}): EnvironmentState {
  const now = opts.now ?? new Date();
  const ov = parseEnvironmentOverrides(opts.search ?? "");
  rand = opts.random ?? mulberry32((now.getTime() ^ 0x9e3779b9) >>> 0);
  const e = environment;
  e.timeMode = ov.timeMode ?? opts.timeMode ?? e.timeMode ?? "cycle";
  e.fixedTime = ov.time ?? null;
  e.fixedWeather = ov.weather ?? null;
  e.fixedSeason = ov.season ?? null;
  e.season = e.fixedSeason ?? seasonFromDate(now);
  if (opts.reducedMotion !== undefined) e.reducedMotion = opts.reducedMotion;
  if (opts.lightGraphics !== undefined) e.lightGraphics = opts.lightGraphics;
  e.elapsed = 0;
  phase = cyclePhaseForTime(START_TIME);
  e.time = e.fixedTime ?? (e.timeMode === "real" ? realTimeOfDay(now) : e.timeMode === "day" ? DAY_MODE_TIME : START_TIME);
  e.weather = e.fixedWeather ?? "clear";
  weatherAge = e.fixedWeather ? WEATHER_FADE : 0;
  weatherTotal = weatherDuration(e.weather, rand);
  e.weatherTimeLeft = weatherTotal;
  // Start channels at their targets so a fixed weather shows at once.
  e.clouds = CLOUD_TARGET[e.weather];
  e.rain = e.weather === "rain" ? 1 : 0;
  e.snow = e.weather === "snow" ? 1 : 0;
  e.rainbow = e.weather === "rainbow" ? 1 : 0;
  e.snowCover = snowCoverTarget(e);
  deriveTime(e);
  e.weatherAmount = e.fixedWeather ? 1 : 0;
  e.wind = WIND_BASE[e.weather];
  return e;
}

/** Switch how time passes. "cycle" resumes from the current time of day. */
export function setTimeMode(mode: TimeMode): void {
  if (!(TIME_MODES as string[]).includes(mode)) return;
  environment.timeMode = mode;
  if (mode === "cycle") phase = cyclePhaseForTime(environment.time);
}

/** Force a weather now (debug / story moments). Transitions continue afterwards unless `hold`. */
export function setWeather(w: Weather, hold = false): void {
  if (!(WEATHERS as string[]).includes(w)) return;
  environment.weather = w;
  weatherAge = 0;
  weatherTotal = weatherDuration(w, rand);
  environment.weatherTimeLeft = weatherTotal;
  environment.fixedWeather = hold ? w : null;
}

export function setSeason(s: Season | null): void {
  environment.fixedSeason = s;
  environment.season = s ?? seasonFromDate(new Date());
}

/** Fix the time of day (0..1), or pass null to let it run again. */
export function setFixedTime(t: number | null): void {
  environment.fixedTime = t === null ? null : wrap01(t);
  if (t === null) phase = cyclePhaseForTime(environment.time);
}

export function setEnvironmentFlags(flags: { reducedMotion?: boolean; lightGraphics?: boolean }): void {
  if (flags.reducedMotion !== undefined) environment.reducedMotion = flags.reducedMotion;
  if (flags.lightGraphics !== undefined) environment.lightGraphics = flags.lightGraphics;
}

function snowCoverTarget(e: EnvironmentState): number {
  if (e.season !== "winter") return e.snow * 0.35;
  return 0.7 + 0.3 * e.snow;
}

function deriveTime(e: EnvironmentState): void {
  const t = wrap01(e.time);
  e.time = t;
  e.sunElevation = sunElevationAt(t);
  e.daylight = daylightAt(t);
  e.dusk = duskAt(t);
  e.isNight = e.daylight < 0.3;
  e.morning = t < 0.5;
}

/** Advance time and weather. Called once per frame with a clamped dt. */
export function stepEnvironment(dt: number, nowMs?: number): void {
  const e = environment;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, 0.25);
  e.elapsed += dt;

  // ---- time
  if (e.fixedTime !== null) e.time = e.fixedTime;
  else if (e.timeMode === "real") e.time = realTimeOfDay(new Date(nowMs ?? Date.now()));
  else if (e.timeMode === "day") e.time += (DAY_MODE_TIME - e.time) * Math.min(1, dt * 0.5);
  else {
    phase = wrap01(phase + dt / CYCLE_SECONDS);
    e.time = cycleTimeFromPhase(phase);
  }
  deriveTime(e);

  // ---- weather state machine
  weatherAge += dt;
  if (e.fixedWeather) {
    e.weather = e.fixedWeather;
    e.weatherTimeLeft = Infinity;
  } else {
    e.weatherTimeLeft = Math.max(0, weatherTotal - weatherAge);
    if (e.weatherTimeLeft <= 0) {
      e.weather = nextWeather(e.weather, e.season, rand, e.daylight);
      if (e.weather === "snow" && e.season !== "winter") e.weather = "rain";
      weatherAge = 0;
      weatherTotal = weatherDuration(e.weather, rand);
      e.weatherTimeLeft = weatherTotal;
    }
  }
  const remaining = e.fixedWeather ? Infinity : e.weatherTimeLeft;
  e.weatherAmount = clamp01(Math.min(weatherAge / WEATHER_FADE, remaining / WEATHER_FADE));

  // ---- smoothed channels (ease toward the current weather)
  const k = 1 - Math.exp(-dt / 5);
  const w = e.weather;
  const amt = e.weatherAmount;
  const ease = (cur: number, target: number) => cur + (target - cur) * k;
  e.clouds = ease(e.clouds, CLOUD_TARGET.clear + (CLOUD_TARGET[w] - CLOUD_TARGET.clear) * amt);
  e.rain = ease(e.rain, w === "rain" ? amt : 0);
  e.snow = ease(e.snow, w === "snow" ? amt : 0);
  // A rainbow needs some sun.
  e.rainbow = ease(e.rainbow, w === "rainbow" ? amt * smoothstep(0.35, 0.7, e.daylight) : 0);
  e.snowCover += (snowCoverTarget(e) - e.snowCover) * (1 - Math.exp(-dt / 20));

  // ---- wind: smooth gusts, calmer with reduced motion
  const t = e.elapsed;
  const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.3) + 0.15 * Math.sin(t * 1.1 + 0.4);
  const target = clamp01(WIND_BASE[w] * (0.55 + 0.9 * gust) * (e.reducedMotion ? 0.5 : 1));
  e.wind += (target - e.wind) * Math.min(1, dt * 1.5);
  e.windAngle = 0.6 + 0.5 * Math.sin(t * 0.011);
}

// --------------------------------------------------------------- sky colour

export type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Hand-picked crayon sky colours (sRGB 0..1). */
export const SKY_COLORS = {
  dayZenith: hex("#62b9c0"),
  dayHorizon: hex("#d8efdc"),
  duskZenith: hex("#7f86c2"),
  duskHorizon: hex("#ffb27c"),
  duskGlow: hex("#ff8f8a"),
  nightZenith: hex("#1c2850"),
  nightHorizon: hex("#3d4c80"),
  overcastZenith: hex("#8399a6"),
  overcastHorizon: hex("#c4cdcb"),
};

export interface SkyPalette {
  zenith: RGB;
  horizon: RGB;
  /** Warm glow around the sun near the horizon. */
  glow: RGB;
  glowAmount: number;
  /** Multiplier applied to lit scenery colours (sRGB). */
  tint: RGB;
}

/** Sky and scene tint for an environment state (pure; used by shaders and UI). */
export function skyPalette(e: Pick<EnvironmentState, "daylight" | "dusk" | "clouds" | "rain" | "snow">): SkyPalette {
  const day = e.daylight;
  // Dusk is strongest where day meets night.
  const dusk = e.dusk * (1 - Math.abs(day - 0.5) * 0.8);
  let zenith = mixRGB(SKY_COLORS.nightZenith, SKY_COLORS.dayZenith, day);
  let horizon = mixRGB(SKY_COLORS.nightHorizon, SKY_COLORS.dayHorizon, day);
  zenith = mixRGB(zenith, SKY_COLORS.duskZenith, dusk * 0.55);
  horizon = mixRGB(horizon, SKY_COLORS.duskHorizon, dusk * 0.85);
  const grey = clamp01((e.clouds - 0.2) * 1.1) * 0.6 + e.rain * 0.35;
  const gz = mixRGB(SKY_COLORS.overcastZenith, SKY_COLORS.nightZenith, 1 - day);
  const gh = mixRGB(SKY_COLORS.overcastHorizon, SKY_COLORS.nightHorizon, 1 - day);
  zenith = mixRGB(zenith, gz, clamp01(grey));
  horizon = mixRGB(horizon, gh, clamp01(grey * 0.85));

  // Scene tint: white by day, warm at dusk, cool cosy blue at night (never black).
  const nightTint: RGB = [0.5, 0.56, 0.86];
  const duskTint: RGB = [1.0, 0.84, 0.74];
  let tint = mixRGB(nightTint, [1, 1, 1], day);
  tint = mixRGB(tint, duskTint, dusk * 0.7);
  tint = mixRGB(tint, [tint[0] * 0.84, tint[1] * 0.88, tint[2] * 0.93], clamp01(grey));
  return { zenith, horizon, glow: SKY_COLORS.duskGlow, glowAmount: dusk, tint };
}

const toHex2 = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");

/**
 * Current sky colour (a mid-sky blend) as a CSS hex string, for tinting UI
 * chrome to match the world. Pass `"horizon"` or `"zenith"` for those bands.
 */
export function getSkyColor(band: "mid" | "horizon" | "zenith" = "mid", e: EnvironmentState = environment): string {
  const p = skyPalette(e);
  const c = band === "zenith" ? p.zenith : band === "horizon" ? p.horizon : mixRGB(p.horizon, p.zenith, 0.5);
  return `#${toHex2(c[0])}${toHex2(c[1])}${toHex2(c[2])}`;
}
