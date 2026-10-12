// Player preferences in localStorage. Every access is guarded: localStorage may be
// missing (SSR), blocked (privacy settings) or full – we then fall back to defaults.

import { DEFAULT_PREFERENCES, type Preferences } from "@/core/types";
import { PreferencesSchema } from "./schema";
import { clampString, isPlainObject } from "./repair";
import { LIMITS } from "./schema";

export const PREFS_KEY = "wonderglobe:prefs:v1";

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Merge a raw (possibly partial / corrupt) object with the defaults, field by field. */
export function sanitizePreferences(raw: unknown): Preferences {
  const out: Preferences = { ...DEFAULT_PREFERENCES };
  if (!isPlainObject(raw)) return out;
  const shape = PreferencesSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof Preferences>) {
    if (!(key in raw)) continue;
    let value: unknown = raw[key];
    if (key === "playerName") value = clampString(value, LIMITS.playerNameLength, DEFAULT_PREFERENCES.playerName);
    if ((key === "musicVolume" || key === "soundVolume") && typeof value === "number" && Number.isFinite(value)) {
      value = Math.min(1, Math.max(0, value));
    }
    const parsed = shape[key].safeParse(value);
    if (parsed.success) (out as unknown as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

export function loadPreferences(): Preferences {
  const ls = storage();
  if (!ls) return { ...DEFAULT_PREFERENCES };
  try {
    const text = ls.getItem(PREFS_KEY);
    if (!text) return { ...DEFAULT_PREFERENCES };
    return sanitizePreferences(JSON.parse(text));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Save preferences. Returns false if they couldn't be stored (never throws). */
export function savePreferences(p: Preferences): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(PREFS_KEY, JSON.stringify(sanitizePreferences(p)));
    return true;
  } catch {
    return false;
  }
}
