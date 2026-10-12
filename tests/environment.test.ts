// Environment: time-of-day curves, the weather state machine, URL overrides
// and seasons from the calendar.

import { describe, expect, it } from "vitest";
import {
  environment,
  initEnvironment,
  stepEnvironment,
  setTimeMode,
  setWeather,
  daylightAt,
  duskAt,
  sunElevationAt,
  isNightAt,
  cycleTimeFromPhase,
  cyclePhaseForTime,
  CYCLE_SECONDS,
  START_TIME,
  NAMED_TIMES,
  nextWeather,
  weatherDuration,
  WEATHER_DURATIONS,
  parseEnvironmentOverrides,
  seasonFromDate,
  realTimeOfDay,
  skyPalette,
  getSkyColor,
  type Weather,
  type Season,
} from "@/world/environment";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("time of day", () => {
  it("daylight is 1 at noon, 0 at midnight and smooth in between", () => {
    expect(daylightAt(0.5)).toBeCloseTo(1, 5);
    expect(daylightAt(0)).toBeCloseTo(0, 5);
    let prev = daylightAt(0);
    for (let t = 0.001; t <= 0.5; t += 0.001) {
      const d = daylightAt(t);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9); // rises all morning
      expect(d - prev).toBeLessThan(0.04); // never jumps
      prev = d;
    }
  });

  it("is symmetric around noon and in range", () => {
    for (let t = 0; t < 0.5; t += 0.013) {
      expect(daylightAt(t)).toBeCloseTo(daylightAt(1 - t), 6);
      expect(duskAt(t)).toBeGreaterThanOrEqual(0);
      expect(duskAt(t)).toBeLessThanOrEqual(1);
    }
  });

  it("dusk glow peaks near sunrise/sunset and vanishes at noon and midnight", () => {
    expect(duskAt(0.25)).toBeGreaterThan(0.9);
    expect(duskAt(0.75)).toBeGreaterThan(0.9);
    expect(duskAt(0.5)).toBeLessThan(0.01);
    expect(duskAt(0)).toBeLessThan(0.01);
    expect(sunElevationAt(0.5)).toBeCloseTo(1, 6);
  });

  it("named times land in the right part of the day", () => {
    expect(isNightAt(NAMED_TIMES.night)).toBe(true);
    expect(isNightAt(NAMED_TIMES.day)).toBe(false);
    expect(duskAt(NAMED_TIMES.dusk)).toBeGreaterThan(0.6);
    expect(duskAt(NAMED_TIMES.dawn)).toBeGreaterThan(0.6);
    expect(daylightAt(NAMED_TIMES.dusk)).toBeGreaterThan(0.4);
  });

  it("the 12-minute cycle starts mid-morning, spends most of it in daylight and wraps", () => {
    expect(cycleTimeFromPhase(cyclePhaseForTime(START_TIME))).toBeCloseTo(START_TIME, 6);
    for (let t = 0; t < 1; t += 0.05) {
      const back = cycleTimeFromPhase(cyclePhaseForTime(t));
      const diff = Math.abs(back - t);
      expect(Math.min(diff, 1 - diff)).toBeLessThan(1e-6);
    }
    let nightSamples = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (isNightAt(cycleTimeFromPhase(i / N))) nightSamples++;
    expect(nightSamples / N).toBeGreaterThan(0.12);
    expect(nightSamples / N).toBeLessThan(0.35);

    initEnvironment({ search: "", random: seeded(1), now: new Date(2026, 5, 1, 12) });
    expect(environment.time).toBeCloseTo(START_TIME, 5);
    expect(environment.isNight).toBe(false);
    for (let i = 0; i < CYCLE_SECONDS * 4; i++) stepEnvironment(0.25);
    // One full cycle later we're back at the start.
    expect(environment.time).toBeCloseTo(START_TIME, 3);
  });

  it("time modes: day stays bright, real follows the clock", () => {
    initEnvironment({ search: "", random: seeded(2), timeMode: "day" });
    for (let i = 0; i < 200; i++) stepEnvironment(0.1);
    expect(environment.daylight).toBeGreaterThan(0.95);
    setTimeMode("real");
    const at = new Date(2026, 0, 1, 18, 0, 0);
    stepEnvironment(0.016, at.getTime());
    expect(environment.time).toBeCloseTo(0.75, 3);
    expect(realTimeOfDay(new Date(2026, 0, 1, 6, 0, 0))).toBeCloseTo(0.25, 6);
    setTimeMode("cycle");
  });
});

describe("weather", () => {
  const ALL: Weather[] = ["clear", "cloudy", "rain", "rainbow", "snow"];
  const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

  it("transitions are always valid", () => {
    const r = seeded(7);
    for (const s of SEASONS)
      for (const w of ALL)
        for (let i = 0; i < 50; i++) {
          const n = nextWeather(w, s, r, r());
          expect(ALL).toContain(n);
          if (s !== "winter") expect(n).not.toBe("snow");
          if (w === "clear") expect(["clear", "cloudy"]).toContain(n);
          if (w === "rainbow") expect(n).toBe("clear");
        }
    // Rain ends in a rainbow in daylight, but never at night.
    expect(nextWeather("rain", "summer", () => 0.5, 1)).toBe("rainbow");
    expect(nextWeather("rain", "summer", () => 0.5, 0.1)).toBe("cloudy");
  });

  it("durations are bounded", () => {
    const r = seeded(9);
    for (const w of ALL)
      for (let i = 0; i < 100; i++) {
        const d = weatherDuration(w, r);
        expect(d).toBeGreaterThanOrEqual(WEATHER_DURATIONS[w][0]);
        expect(d).toBeLessThanOrEqual(WEATHER_DURATIONS[w][1]);
      }
  });

  it("a long simulation stays in range and visits rain and rainbows", () => {
    initEnvironment({ search: "?season=summer", random: seeded(11), timeMode: "day" });
    const seen = new Set<Weather>();
    for (let i = 0; i < 60 * 60 * 4; i++) {
      stepEnvironment(0.25);
      seen.add(environment.weather);
      for (const v of [environment.daylight, environment.dusk, environment.weatherAmount, environment.clouds, environment.rain, environment.snow, environment.rainbow, environment.wind, environment.snowCover]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(seen.has("clear")).toBe(true);
    expect(seen.has("rain")).toBe(true);
    expect(seen.has("rainbow")).toBe(true);
    expect(seen.has("snow")).toBe(false);
  });

  it("winter brings snow and snow cover", () => {
    initEnvironment({ search: "?season=winter", random: seeded(5) });
    const seen = new Set<Weather>();
    for (let i = 0; i < 60 * 60 * 4; i++) {
      stepEnvironment(0.25);
      seen.add(environment.weather);
    }
    expect(seen.has("snow")).toBe(true);
    expect(seen.has("rain")).toBe(false);
    expect(environment.snowCover).toBeGreaterThan(0.6);
  });

  it("setWeather and fixed weather", () => {
    initEnvironment({ search: "?weather=rain", random: seeded(3) });
    expect(environment.weather).toBe("rain");
    expect(environment.rain).toBe(1);
    for (let i = 0; i < 2000; i++) stepEnvironment(0.25);
    expect(environment.weather).toBe("rain");
    setWeather("cloudy");
    expect(environment.weather).toBe("cloudy");
    expect(environment.fixedWeather).toBe(null);
  });

  it("reduced motion calms the wind", () => {
    initEnvironment({ search: "?weather=rain", random: seeded(4), reducedMotion: false });
    let maxWind = 0;
    for (let i = 0; i < 2000; i++) {
      stepEnvironment(0.1);
      maxWind = Math.max(maxWind, environment.wind);
    }
    initEnvironment({ search: "?weather=rain", random: seeded(4), reducedMotion: true });
    let maxCalm = 0;
    for (let i = 0; i < 2000; i++) {
      stepEnvironment(0.1);
      maxCalm = Math.max(maxCalm, environment.wind);
    }
    expect(maxCalm).toBeLessThan(maxWind * 0.7);
  });
});

describe("URL overrides", () => {
  it("parses known values and ignores the rest", () => {
    expect(parseEnvironmentOverrides("?time=night")).toEqual({ time: NAMED_TIMES.night });
    expect(parseEnvironmentOverrides("?time=dusk&weather=rainbow&season=winter")).toEqual({ time: NAMED_TIMES.dusk, weather: "rainbow", season: "winter" });
    expect(parseEnvironmentOverrides("?time=6").time).toBeCloseTo(0.25, 6);
    expect(parseEnvironmentOverrides("?time=banana&weather=hail&season=monsoon")).toEqual({});
    expect(parseEnvironmentOverrides("?season=fall").season).toBe("autumn");
    expect(parseEnvironmentOverrides("?timeMode=real").timeMode).toBe("real");
    expect(parseEnvironmentOverrides("")).toEqual({});
  });

  it("initEnvironment applies them and holds the time", () => {
    initEnvironment({ search: "?time=night&season=spring&weather=snow", random: seeded(1) });
    expect(environment.isNight).toBe(true);
    expect(environment.season).toBe("spring");
    expect(environment.weather).toBe("snow");
    for (let i = 0; i < 1000; i++) stepEnvironment(0.25);
    expect(environment.time).toBeCloseTo(NAMED_TIMES.night, 6);
    initEnvironment({ search: "", random: seeded(1) });
  });
});

describe("seasons and sky", () => {
  it("season from date", () => {
    expect(seasonFromDate(new Date(2026, 3, 10))).toBe("spring");
    expect(seasonFromDate(new Date(2026, 6, 10))).toBe("summer");
    expect(seasonFromDate(new Date(2026, 9, 12))).toBe("autumn");
    expect(seasonFromDate(new Date(2026, 11, 25))).toBe("winter");
    expect(seasonFromDate(new Date(2026, 1, 1))).toBe("winter");
    expect(seasonFromDate(new Date(2026, 11, 25), true)).toBe("summer");
  });

  it("sky palette: night is darker but never black, and colours are valid hex", () => {
    const day = skyPalette({ daylight: 1, dusk: 0, clouds: 0.1, rain: 0, snow: 0 });
    const night = skyPalette({ daylight: 0, dusk: 0, clouds: 0.1, rain: 0, snow: 0 });
    const lum = (c: number[]) => c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;
    expect(lum(night.zenith)).toBeLessThan(lum(day.zenith));
    expect(lum(night.tint)).toBeGreaterThan(0.4);
    expect(day.tint.every((x) => x > 0.99)).toBe(true);
    expect(getSkyColor()).toMatch(/^#[0-9a-f]{6}$/);
  });
});
