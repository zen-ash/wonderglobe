// The sticker book: every sticker a child can earn, and the pure rules that
// work out which ones a world has earned. Event stickers (a ride, a postcard,
// a pat, night time, a rainbow) are awarded directly by the progress tracker.

import type { WorldMode, WorldSave } from "@/core/types";
import { getKind } from "@/core/kinds";
import { REGIONS, type RegionKind } from "@/world/planet";
import { GOLDEN_BUTTERFLY_IDS, treasureIdsFor } from "./collectibles";

/** Which picture a sticker shows (drawn procedurally in src/art/stickerIcons.ts). */
export type StickerIcon =
  | "sunflower" | "lily" | "house" | "basket" | "tulip" | "blossom" | "pine" | "barn" | "duck" | "boat" | "mountain" | "wave"
  | "pencil" | "paw" | "sprout" | "car" | "wand" | "bird" | "fish" | "bridge" | "frame" | "note"
  | "chest" | "crown" | "star" | "butterfly" | "horseshoe" | "camera" | "heart" | "owl" | "rainbow"
  | "key" | "bottle" | "kite" | "shell" | "acorn" | "carrot" | "pinecone" | "pearl" | "bell";

export interface StickerDef {
  id: string;
  /** Short name shown under the sticker. */
  title: string;
  /** One-line hint for children who haven't earned it yet. */
  hint: string;
  icon: StickerIcon;
  /** Background colour of the round sticker. */
  bg: string;
  /** Small number drawn on the sticker (5, 10, 20…). */
  badge?: string;
  /** Which worlds it belongs to. */
  modes: WorldMode[];
}

const BOTH: WorldMode[] = ["paper", "gallery"];
const PAPER: WorldMode[] = ["paper"];
const GALLERY: WorldMode[] = ["gallery"];

const REGION_ICON: Record<RegionKind, [StickerIcon, string]> = {
  garden: ["sunflower", "#fff1a8"],
  lily: ["lily", "#c9f0e4"],
  village: ["house", "#ffd9c2"],
  picnic: ["basket", "#ffe0e8"],
  meadow: ["tulip", "#e6f7c6"],
  cherry: ["blossom", "#ffe3ef"],
  forest: ["pine", "#cfeac2"],
  farm: ["barn", "#fbe6b0"],
  duckpond: ["duck", "#cdeeff"],
  coast: ["boat", "#cfe6ff"],
  mountain: ["mountain", "#e3e8ff"],
  lake: ["wave", "#bfe7f5"],
};

export const regionStickerId = (region: string) => `place-${region}`;

export const STICKERS: StickerDef[] = [
  // One for every place on the planet.
  ...REGIONS.map<StickerDef>((r) => ({
    id: regionStickerId(r.id),
    title: r.name,
    hint: `Visit ${r.name}`,
    icon: REGION_ICON[r.id][0],
    bg: REGION_ICON[r.id][1],
    modes: BOTH,
  })),
  // Making things (paper world).
  { id: "make-1", title: "First drawing", hint: "Draw something", icon: "pencil", bg: "#fff1a8", modes: PAPER },
  { id: "make-5", title: "5 drawings", hint: "Make 5 drawings", icon: "pencil", bg: "#ffd9c2", badge: "5", modes: PAPER },
  { id: "make-10", title: "10 drawings", hint: "Make 10 drawings", icon: "pencil", bg: "#e6f7c6", badge: "10", modes: PAPER },
  { id: "make-20", title: "20 drawings", hint: "Make 20 drawings", icon: "pencil", bg: "#e3e8ff", badge: "20", modes: PAPER },
  { id: "family-animal", title: "Animal friend", hint: "Draw an animal", icon: "paw", bg: "#ffe0c2", modes: PAPER },
  { id: "family-plant", title: "Green thumb", hint: "Draw a plant", icon: "sprout", bg: "#d9f5c4", modes: PAPER },
  { id: "family-building", title: "Builder", hint: "Draw a building", icon: "house", bg: "#e8e0ff", modes: PAPER },
  { id: "family-vehicle", title: "Beep beep", hint: "Draw something that goes", icon: "car", bg: "#ffe8a8", modes: PAPER },
  { id: "family-imaginary", title: "Dreamer", hint: "Draw something magic", icon: "wand", bg: "#f2dcff", modes: PAPER },
  { id: "family-flyer", title: "Up high", hint: "Draw something that flies", icon: "bird", bg: "#d4efff", modes: PAPER },
  { id: "family-swimmer", title: "Splash", hint: "Draw something that swims", icon: "fish", bg: "#c6ecf2", modes: PAPER },
  { id: "bridge", title: "Bridge builder", hint: "Draw a bridge", icon: "bridge", bg: "#ffe3c9", modes: PAPER },
  { id: "rider", title: "Big ride", hint: "Ride a creature", icon: "horseshoe", bg: "#ffdcd0", modes: PAPER },
  { id: "pat", title: "Best friends", hint: "Tap a creature to say hi", icon: "heart", bg: "#ffd6e4", modes: PAPER },
  // The gallery world.
  { id: "picture-1", title: "First picture", hint: "Hang a picture", icon: "frame", bg: "#fff1a8", modes: GALLERY },
  { id: "picture-3", title: "3 pictures", hint: "Hang 3 pictures", icon: "frame", bg: "#ffd9c2", badge: "3", modes: GALLERY },
  { id: "picture-10", title: "10 pictures", hint: "Hang 10 pictures", icon: "frame", bg: "#e6f7c6", badge: "10", modes: GALLERY },
  { id: "note-1", title: "Sticky note", hint: "Leave a sticky note", icon: "note", bg: "#ffe0e8", modes: GALLERY },
  { id: "note-5", title: "5 notes", hint: "Leave 5 sticky notes", icon: "note", bg: "#d9f5c4", badge: "5", modes: GALLERY },
  // Exploring (both worlds).
  { id: "treasure-1", title: "Treasure!", hint: "Find a hidden treasure", icon: "chest", bg: "#ffe8a8", modes: BOTH },
  { id: "treasure-all", title: "Treasure king", hint: "Find every treasure", icon: "crown", bg: "#fff1a8", modes: BOTH },
  { id: "summit-star", title: "Summit star", hint: "Fly to the mountain top", icon: "star", bg: "#d8e4ff", modes: PAPER },
  { id: "golden-butterfly", title: "Golden butterfly", hint: "Catch a golden butterfly", icon: "butterfly", bg: "#fff4c4", modes: BOTH },
  { id: "postcard", title: "Postcard", hint: "Take a picture", icon: "camera", bg: "#d6f1ee", modes: BOTH },
  { id: "night-owl", title: "Night owl", hint: "Play at night", icon: "owl", bg: "#c9cdf0", modes: BOTH },
  { id: "rainbow", title: "Rainbow", hint: "See a rainbow", icon: "rainbow", bg: "#e2f4ff", modes: BOTH },
];

export const STICKER_BY_ID: Record<string, StickerDef> = Object.fromEntries(STICKERS.map((s) => [s.id, s]));

export function stickersForMode(mode: WorldMode): StickerDef[] {
  return STICKERS.filter((s) => s.modes.includes(mode));
}

/** Families a creation belongs to (for the "first of each family" stickers). */
export function familiesOf(kind: string, behavior: string): string[] {
  const k = getKind(kind);
  const out: string[] = [];
  if (k.category === "animal") out.push("animal");
  if (k.category === "plant") out.push("plant");
  if (k.category === "building") out.push("building");
  if (k.category === "vehicle") out.push("vehicle");
  if (k.category === "imaginary") out.push("imaginary");
  if (behavior === "fly" || behavior === "flutter" || behavior === "hover") out.push("flyer");
  if (behavior === "swim" || behavior === "float") out.push("swimmer");
  return out;
}

/** Stickers a saved world has earned from its contents alone (pure). */
export function stickersEarnedByWorld(world: WorldSave): string[] {
  const out: string[] = [];
  const mode = world.mode;
  for (const r of REGIONS) if (world.visited.includes(r.id)) out.push(regionStickerId(r.id));

  if (mode === "paper") {
    const n = world.creations.length;
    if (n >= 1) out.push("make-1");
    if (n >= 5) out.push("make-5");
    if (n >= 10) out.push("make-10");
    if (n >= 20) out.push("make-20");
    const fams = new Set<string>();
    for (const c of world.creations) familiesOf(c.kind, c.behavior).forEach((f) => fams.add(f));
    for (const f of ["animal", "plant", "building", "vehicle", "imaginary", "flyer", "swimmer"]) if (fams.has(f)) out.push(`family-${f}`);
    if (world.creations.some((c) => c.kind === "bridge")) out.push("bridge");
  } else {
    const n = world.easels.length;
    if (n >= 1) out.push("picture-1");
    if (n >= 3) out.push("picture-3");
    if (n >= 10) out.push("picture-10");
    const notes = world.easels.reduce((s, e) => s + e.notes.length, 0);
    if (notes >= 1) out.push("note-1");
    if (notes >= 5) out.push("note-5");
  }

  const found = new Set(world.found ?? []);
  const treasures = treasureIdsFor(mode);
  const foundTreasures = treasures.filter((id) => found.has(id)).length;
  if (foundTreasures >= 1) out.push("treasure-1");
  if (foundTreasures >= treasures.length) out.push("treasure-all");
  if (found.has("summit-star") && mode === "paper") out.push("summit-star");
  if (GOLDEN_BUTTERFLY_IDS.some((id) => found.has(id))) out.push("golden-butterfly");
  return out;
}

/** Ids in `candidates` that are real stickers for this mode and not yet in the world (pure, ordered, unique). */
export function newStickers(world: WorldSave, candidates: string[]): string[] {
  const have = new Set(world.stickers ?? []);
  const out: string[] = [];
  for (const id of candidates) {
    const def = STICKER_BY_ID[id];
    if (!def || !def.modes.includes(world.mode) || have.has(id)) continue;
    have.add(id);
    out.push(id);
  }
  return out;
}

/** The world's sticker list with `ids` added (pure; keeps order; no duplicates). */
export function withStickers(world: WorldSave, ids: string[]): string[] {
  const list = [...(world.stickers ?? [])];
  for (const id of ids) if (!list.includes(id)) list.push(id);
  return list;
}

export function stickerCount(world: WorldSave): { earned: number; total: number } {
  const all = stickersForMode(world.mode);
  const have = new Set(world.stickers ?? []);
  return { earned: all.filter((s) => have.has(s.id)).length, total: all.length };
}
