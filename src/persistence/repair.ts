// Gentle repair / migration of saved (or imported) world data.
// Never throws on minor corruption: malformed creations/easels are dropped,
// vectors renormalised, headings re-orthogonalised, unknown kinds become
// "sculpture" and strings are clamped. Only a record that isn't world-shaped
// at all is rejected (returns null).

import { FALLBACK_KIND, KIND_BY_ID, getKind } from "@/core/kinds";
import {
  NOTE_COLORS,
  type Behavior,
  type ChatLine,
  type CreationRecord,
  type EaselRecord,
  type Facing,
  type PlayerSave,
  type QuestProgress,
  type StickyNote,
  type Vec3,
  type WorldMode,
  type WorldSave,
} from "@/core/types";
import {
  BehaviorSchema,
  CreationRecordSchema,
  EaselRecordSchema,
  FacingSchema,
  LIMITS,
  WorldSaveSchema,
} from "./schema";

// ---------------------------------------------------------------------------
// Small helpers

type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Clamp a string to at most `max` UTF-16 units without splitting emoji / surrogate pairs. */
export function clampString(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  // Strip control characters except tab/newline.
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function idOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > LIMITS.idLength) return null;
  return s;
}

/** Random 31-bit non-negative integer. */
export function randomSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 0x7fffffff);
}

// ---------------------------------------------------------------------------
// Vector helpers

export function normalizeVec(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const len = Math.hypot(x as number, y as number, z as number);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  // Already unit length: keep the exact values (no ULP drift on every load).
  if (Math.abs(len - 1) < 1e-12) return [x as number, y as number, z as number];
  return [(x as number) / len, (y as number) / len, (z as number) / len];
}

/** Any unit vector perpendicular to the unit vector `p`. */
export function anyTangent(p: Vec3): Vec3 {
  // Cross with the axis least aligned with p.
  const ax = Math.abs(p[0]);
  const ay = Math.abs(p[1]);
  const az = Math.abs(p[2]);
  const a: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const c: Vec3 = [p[1] * a[2] - p[2] * a[1], p[2] * a[0] - p[0] * a[2], p[0] * a[1] - p[1] * a[0]];
  return normalizeVec(c) ?? [1, 0, 0];
}

/** Project `h` onto the tangent plane at unit `p` and normalise; falls back to any tangent. */
export function orthogonalHeading(p: Vec3, h: unknown): Vec3 {
  const hv = normalizeVec(h);
  if (hv) {
    const d = hv[0] * p[0] + hv[1] * p[1] + hv[2] * p[2];
    if (Math.abs(d) < 1e-12) return hv; // already a tangent: keep exact values
    const t = normalizeVec([hv[0] - d * p[0], hv[1] - d * p[1], hv[2] - d * p[2]]);
    if (t && Math.abs(d) < 0.999) return t;
  }
  return anyTangent(p);
}

function vecChanged(a: unknown, b: Vec3): boolean {
  if (!Array.isArray(a) || a.length !== 3) return true;
  return Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6 || Math.abs(a[2] - b[2]) > 1e-6;
}

// ---------------------------------------------------------------------------
// Record repair

export interface RepairLog {
  /** Human-readable descriptions of what was fixed (for console logging / import warnings). */
  fixes: string[];
  droppedCreations: number;
  droppedEasels: number;
}

function newLog(): RepairLog {
  return { fixes: [], droppedCreations: 0, droppedEasels: 0 };
}

export const DEFAULT_PLAYER_POSITION: Vec3 = (() => normalizeVec([0, 0.35, 0.94])!)();

export function defaultPlayer(): PlayerSave {
  const position: Vec3 = [...DEFAULT_PLAYER_POSITION];
  // Heading: towards +y along the surface (perpendicular to position).
  return { position, heading: orthogonalHeading(position, [0, 1, 0]) };
}

function repairChat(raw: unknown): ChatLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatLine[] = [];
  for (const line of raw) {
    if (!isPlainObject(line)) continue;
    if (line.role !== "player" && line.role !== "character") continue;
    if (typeof line.text !== "string") continue;
    const c: ChatLine = {
      role: line.role,
      text: clampString(line.text, LIMITS.chatLineLength),
      at: finiteOr(line.at, 0),
    };
    if (line.via === "ai" || line.via === "local") c.via = line.via;
    out.push(c);
  }
  return out.slice(-LIMITS.chatLines);
}

function repairNotes(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) return [];
  const out: StickyNote[] = [];
  const seen = new Set<string>();
  for (const n of raw) {
    if (!isPlainObject(n)) continue;
    const id = idOrNull(n.id);
    if (!id || seen.has(id)) continue;
    if (typeof n.text !== "string") continue;
    seen.add(id);
    const color =
      typeof n.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(n.color) ? n.color : NOTE_COLORS[0];
    out.push({ id, color, text: clampString(n.text, LIMITS.noteTextLength), createdAt: finiteOr(n.createdAt, 0) });
  }
  return out.slice(0, LIMITS.notesPerEasel);
}

export function repairCreation(raw: unknown, now: number, log: RepairLog): CreationRecord | null {
  if (!isPlainObject(raw)) return null;
  const id = idOrNull(raw.id);
  const artworkId = idOrNull(raw.artworkId);
  if (!id || !artworkId) return null;
  const position = normalizeVec(raw.position);
  if (!position) return null;
  if (vecChanged(raw.position, position)) log.fixes.push(`creation ${id}: renormalised position`);
  const heading = orthogonalHeading(position, raw.heading);
  if (vecChanged(raw.heading, heading)) log.fixes.push(`creation ${id}: repaired heading`);

  let kind = typeof raw.kind === "string" ? raw.kind : "";
  if (!KIND_BY_ID[kind]) {
    log.fixes.push(`creation ${id}: unknown kind "${clampString(kind, 30)}" → ${FALLBACK_KIND}`);
    kind = FALLBACK_KIND;
  }
  const info = getKind(kind);
  const behaviorParsed = BehaviorSchema.safeParse(raw.behavior);
  const behavior: Behavior = behaviorParsed.success ? behaviorParsed.data : info.behavior;
  const facingParsed = FacingSchema.safeParse(raw.facing);
  const facing: Facing = facingParsed.success ? facingParsed.data : info.hasFacing ? "right" : "none";
  let name = clampString(raw.name, LIMITS.nameLength).trim();
  if (!name) name = info.label;
  if (typeof raw.name === "string" && raw.name.length > LIMITS.nameLength) log.fixes.push(`creation ${id}: name shortened`);

  const rec: CreationRecord = {
    id,
    artworkId,
    kind,
    name,
    behavior,
    facing,
    classifiedBy: raw.classifiedBy === "ai" ? "ai" : "player",
    position,
    heading,
    createdAt: finiteOr(raw.createdAt, now),
    chat: repairChat(raw.chat),
  };
  return CreationRecordSchema.safeParse(rec).success ? rec : null;
}

export function repairEasel(raw: unknown, now: number, log: RepairLog): EaselRecord | null {
  if (!isPlainObject(raw)) return null;
  const id = idOrNull(raw.id);
  const artworkId = idOrNull(raw.artworkId);
  if (!id || !artworkId) return null;
  const position = normalizeVec(raw.position);
  if (!position) return null;
  if (vecChanged(raw.position, position)) log.fixes.push(`easel ${id}: renormalised position`);
  const heading = orthogonalHeading(position, raw.heading);
  if (vecChanged(raw.heading, heading)) log.fixes.push(`easel ${id}: repaired heading`);
  for (const [field, max] of [
    ["title", LIMITS.titleLength],
    ["artist", LIMITS.artistLength],
    ["story", LIMITS.storyLength],
  ] as const) {
    const v = raw[field];
    if (typeof v === "string" && v.length > max) log.fixes.push(`easel ${id}: ${field} shortened`);
  }
  const rec: EaselRecord = {
    id,
    artworkId,
    title: clampString(raw.title, LIMITS.titleLength),
    artist: clampString(raw.artist, LIMITS.artistLength),
    story: clampString(raw.story, LIMITS.storyLength),
    notes: repairNotes(raw.notes),
    position,
    heading,
    createdAt: finiteOr(raw.createdAt, now),
  };
  return EaselRecordSchema.safeParse(rec).success ? rec : null;
}

function repairPlayer(raw: unknown, log: RepairLog): PlayerSave {
  if (isPlainObject(raw)) {
    const position = normalizeVec(raw.position);
    if (position) {
      const heading = orthogonalHeading(position, raw.heading);
      if (vecChanged(raw.position, position) || vecChanged(raw.heading, heading)) log.fixes.push("player: repaired vectors");
      return { position, heading };
    }
  }
  log.fixes.push("player: reset to start position");
  return defaultPlayer();
}

export interface RepairResult {
  world: WorldSave;
  log: RepairLog;
}

/**
 * Repair a raw world record into a valid WorldSave for `mode`.
 * Returns null only if the record isn't recognisably a world.
 */
export function repairWorld(raw: unknown, mode: WorldMode, now = Date.now()): RepairResult | null {
  if (!isPlainObject(raw)) return null;
  const log = newLog();
  const looksLikeWorld =
    Array.isArray(raw.creations) ||
    Array.isArray(raw.easels) ||
    isPlainObject(raw.player) ||
    (typeof raw.seed === "number" && Number.isFinite(raw.seed));
  if (!looksLikeWorld) return null;

  if (raw.version !== 1) log.fixes.push(`version ${String(raw.version)} → 1`);
  if (raw.mode !== mode) log.fixes.push(`mode ${String(raw.mode)} → ${mode}`);

  let seed: number;
  if (typeof raw.seed === "number" && Number.isFinite(raw.seed)) {
    seed = Math.abs(Math.trunc(raw.seed)) % 0x80000000;
    if (seed !== raw.seed) log.fixes.push("seed normalised");
  } else {
    seed = randomSeed();
    log.fixes.push("seed missing → new seed");
  }

  const creations: CreationRecord[] = [];
  const creationIds = new Set<string>();
  const rawCreations = Array.isArray(raw.creations) ? raw.creations : [];
  for (const c of rawCreations) {
    const rec = repairCreation(c, now, log);
    if (!rec || creationIds.has(rec.id) || creations.length >= LIMITS.creations) {
      log.droppedCreations++;
      continue;
    }
    creationIds.add(rec.id);
    creations.push(rec);
  }

  const easels: EaselRecord[] = [];
  const easelIds = new Set<string>();
  const rawEasels = Array.isArray(raw.easels) ? raw.easels : [];
  for (const e of rawEasels) {
    const rec = repairEasel(e, now, log);
    if (!rec || easelIds.has(rec.id) || easels.length >= LIMITS.easels) {
      log.droppedEasels++;
      continue;
    }
    easelIds.add(rec.id);
    easels.push(rec);
  }
  if (log.droppedCreations) log.fixes.push(`dropped ${log.droppedCreations} broken creation(s)`);
  if (log.droppedEasels) log.fixes.push(`dropped ${log.droppedEasels} broken easel(s)`);

  const visited: string[] = [];
  if (Array.isArray(raw.visited)) {
    const seen = new Set<string>();
    for (const v of raw.visited) {
      if (typeof v !== "string" || !v || v.length > LIMITS.visitedIdLength || seen.has(v)) continue;
      seen.add(v);
      visited.push(v);
      if (visited.length >= LIMITS.visited) break;
    }
  }

  const createdAt = finiteOr(raw.createdAt, now);
  const world: WorldSave = {
    version: 1,
    mode,
    seed,
    createdAt,
    updatedAt: finiteOr(raw.updatedAt, createdAt),
    player: repairPlayer(raw.player, log),
    creations,
    easels,
    visited,
  };
  repairProgress(raw, world, log);

  const check = WorldSaveSchema.safeParse(world);
  if (!check.success) return null; // should be unreachable
  return { world, log };
}

// ---------------------------------------------------------------------------
// Game progress (stickers, quests, treasures, player drawing, onboarding).
// Old saves simply don't have these fields: they stay absent (not invented),
// so a repaired old save is identical to the original.

/** Unique, non-empty, short id strings (first wins), capped at `max`. */
export function repairIdList(raw: unknown, max: number, maxLen: number = LIMITS.progressIdLength): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || s.length > maxLen || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function repairQuestProgress(raw: unknown): QuestProgress {
  if (!isPlainObject(raw)) return { completed: [], active: null };
  const completed = repairIdList(raw.completed, LIMITS.quests);
  let active: string | null = null;
  if (typeof raw.active === "string") {
    const s = raw.active.trim();
    if (s && s.length <= LIMITS.progressIdLength && !completed.includes(s)) active = s;
  }
  return { completed, active };
}

function repairProgress(raw: Obj, world: WorldSave, log: RepairLog): void {
  if (raw.stickers !== undefined) {
    world.stickers = repairIdList(raw.stickers, LIMITS.stickers);
    if (!Array.isArray(raw.stickers) || world.stickers.length !== raw.stickers.length) log.fixes.push("stickers tidied");
  }
  if (raw.found !== undefined) {
    world.found = repairIdList(raw.found, LIMITS.found);
    if (!Array.isArray(raw.found) || world.found.length !== raw.found.length) log.fixes.push("found treasures tidied");
  }
  if (raw.quests !== undefined) {
    world.quests = repairQuestProgress(raw.quests);
  }
  if (raw.playerArtworkId !== undefined) {
    if (raw.playerArtworkId === null) world.playerArtworkId = null;
    else {
      const id = idOrNull(raw.playerArtworkId);
      world.playerArtworkId = id;
      if (!id) log.fixes.push("player drawing reference dropped");
    }
  }
  if (raw.onboarded !== undefined) world.onboarded = raw.onboarded === true;
}

/** All artwork ids a world references (creations, easels and the player's own drawing). */
export function referencedArtworkIds(world: WorldSave): Set<string> {
  const ids = new Set<string>();
  for (const c of world.creations) ids.add(c.artworkId);
  for (const e of world.easels) ids.add(e.artworkId);
  if (world.playerArtworkId) ids.add(world.playerArtworkId);
  return ids;
}
