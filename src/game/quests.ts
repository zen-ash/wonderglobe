// Shelly's little quests: a data-driven list with a prompt, a completion
// check over the saved world (event quests check the sticker the event
// earned), an optional helper action and a reward sticker. All pure.

import type { QuestProgress, WorldMode, WorldSave } from "@/core/types";
import type { RegionKind } from "@/world/planet";
import { familiesOf } from "./stickers";
import { treasureIdsFor } from "./collectibles";

export type QuestAction =
  | { kind: "draw"; label: string; prompt: string }
  | { kind: "go"; label: string; region: RegionKind }
  | { kind: "camera"; label: string };

export interface QuestDef {
  id: string;
  modes: WorldMode[];
  /** What Shelly asks (short!). */
  prompt: string;
  /** What Shelly says when it's done. */
  done: string;
  /** Sticker given on completion. */
  reward?: string;
  /** Only offered once this is true. */
  requires?: (w: WorldSave) => boolean;
  check: (w: WorldSave) => boolean;
  action?: QuestAction | ((w: WorldSave) => QuestAction | null);
}

const has = (w: WorldSave, sticker: string) => (w.stickers ?? []).includes(sticker);
const found = (w: WorldSave, id: string) => (w.found ?? []).includes(id);
const hasFamily = (w: WorldSave, fam: string) => w.creations.some((c) => familiesOf(c.kind, c.behavior).includes(fam));
const treasuresFound = (w: WorldSave) => {
  const f = new Set(w.found ?? []);
  return treasureIdsFor(w.mode).filter((id) => f.has(id)).length;
};
const notes = (w: WorldSave) => w.easels.reduce((s, e) => s + e.notes.length, 0);

const PAPER: WorldMode[] = ["paper"];
const GALLERY: WorldMode[] = ["gallery"];
const BOTH: WorldMode[] = ["paper", "gallery"];

export const QUESTS: QuestDef[] = [
  // ------------------------------------------------------------ paper world
  {
    id: "swim",
    modes: PAPER,
    prompt: "The pond looks lonely. Can you draw something that swims?",
    done: "Splish splash! The pond has a friend!",
    reward: "family-swimmer",
    check: (w) => w.creations.some((c) => c.behavior === "swim" || c.behavior === "float"),
    action: { kind: "draw", label: "Draw!", prompt: "Draw something that swims!" },
  },
  {
    id: "pat",
    modes: PAPER,
    prompt: "Give a creature a pat! Tap one to say hi.",
    done: "Aww! They love you!",
    reward: "pat",
    requires: (w) => w.creations.some((c) => c.behavior !== "build"),
    check: (w) => has(w, "pat"),
  },
  {
    id: "farm",
    modes: PAPER,
    prompt: "Let's visit Happy Farm!",
    done: "Moo! We made it to the farm!",
    reward: "place-farm",
    check: (w) => w.visited.includes("farm"),
    action: { kind: "go", label: "Let's go!", region: "farm" },
  },
  {
    id: "key",
    modes: PAPER,
    prompt: "Find the key hidden in the forest!",
    done: "You found the key! So shiny!",
    reward: "treasure-1",
    check: (w) => found(w, "key"),
    action: { kind: "go", label: "To the forest!", region: "forest" },
  },
  {
    id: "bridge",
    modes: PAPER,
    prompt: "Draw a bridge to cross Big Blue Lake!",
    done: "What a strong bridge!",
    reward: "bridge",
    check: (w) => w.creations.some((c) => c.kind === "bridge"),
    action: { kind: "draw", label: "Draw!", prompt: "Draw a bridge!" },
  },
  {
    id: "plant",
    modes: PAPER,
    prompt: "Let's grow something! Draw a flower or a tree.",
    done: "Look at it grow!",
    reward: "family-plant",
    check: (w) => hasFamily(w, "plant"),
    action: { kind: "draw", label: "Draw!", prompt: "Draw a flower or a tree!" },
  },
  {
    id: "summit",
    modes: PAPER,
    prompt: "Draw something that flies, then ride it to the mountain top!",
    done: "Wow! You got the summit star!",
    reward: "summit-star",
    check: (w) => found(w, "summit-star"),
    action: (w) =>
      hasFamily(w, "flyer")
        ? { kind: "go", label: "To the mountain!", region: "mountain" }
        : { kind: "draw", label: "Draw!", prompt: "Draw something that flies!" },
  },
  {
    id: "photo",
    modes: BOTH,
    prompt: "Smile! Take a postcard picture.",
    done: "What a lovely postcard!",
    reward: "postcard",
    check: (w) => has(w, "postcard"),
    action: { kind: "camera", label: "Camera!" },
  },
  {
    id: "house",
    modes: PAPER,
    prompt: "Can you draw a little house?",
    done: "A new home! Hooray!",
    reward: "family-building",
    check: (w) => hasFamily(w, "building"),
    action: { kind: "draw", label: "Draw!", prompt: "Draw a house!" },
  },
  {
    id: "treasures-5",
    modes: BOTH,
    prompt: "Treasures are hiding all over! Can you find 5?",
    done: "Five treasures! You're a real explorer!",
    reward: "treasure-1",
    check: (w) => treasuresFound(w) >= 5,
  },
  {
    id: "visit-8",
    modes: PAPER,
    prompt: "Let's explore! Visit 8 places.",
    done: "You've been everywhere!",
    check: (w) => w.visited.length >= 8,
  },
  {
    id: "butterfly",
    modes: BOTH,
    prompt: "A golden butterfly is flying about! Can you catch it?",
    done: "You caught the golden butterfly!",
    reward: "golden-butterfly",
    check: (w) => has(w, "golden-butterfly"),
  },
  // ---------------------------------------------------------- gallery world
  {
    id: "hang-1",
    modes: GALLERY,
    prompt: "Hang a picture in the gallery!",
    done: "Beautiful! Visitors will come to look.",
    reward: "picture-1",
    check: (w) => w.easels.length >= 1,
    action: { kind: "draw", label: "Draw!", prompt: "Draw a picture to hang!" },
  },
  {
    id: "note",
    modes: GALLERY,
    prompt: "Leave a sticky note on a picture!",
    done: "A happy little note!",
    reward: "note-1",
    requires: (w) => w.easels.length >= 1,
    check: (w) => notes(w) >= 1,
  },
  {
    id: "visit-4",
    modes: GALLERY,
    prompt: "Let's go for a walk! Visit 4 places.",
    done: "What a lovely walk!",
    check: (w) => w.visited.length >= 4,
  },
  {
    id: "hang-3",
    modes: GALLERY,
    prompt: "Can you hang 3 pictures?",
    done: "Your gallery is growing!",
    reward: "picture-3",
    check: (w) => w.easels.length >= 3,
    action: { kind: "draw", label: "Draw!", prompt: "Draw another picture!" },
  },
  {
    id: "treasure-g",
    modes: GALLERY,
    prompt: "Something shiny is hiding! Find a treasure.",
    done: "Ooh, a treasure!",
    reward: "treasure-1",
    check: (w) => treasuresFound(w) >= 1,
  },
];

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** The order Shelly offers quests in, per world. */
const ORDER: Record<WorldMode, string[]> = {
  paper: ["swim", "pat", "farm", "key", "bridge", "plant", "summit", "photo", "house", "treasures-5", "visit-8", "butterfly"],
  gallery: ["hang-1", "note", "visit-4", "hang-3", "treasure-g", "photo", "treasures-5", "butterfly"],
};

export function questsForMode(mode: WorldMode): QuestDef[] {
  return ORDER[mode].map((id) => QUEST_BY_ID[id]).filter((q) => q && q.modes.includes(mode));
}

export function questAction(q: QuestDef, w: WorldSave): QuestAction | null {
  if (!q.action) return null;
  return typeof q.action === "function" ? q.action(w) : q.action;
}

export interface QuestSync {
  progress: QuestProgress;
  /** The active quest just finished (celebrate it). */
  finished: QuestDef | null;
  /** Whether `progress` differs from the world's saved progress. */
  changed: boolean;
}

/**
 * Bring quest progress up to date with the world (pure). The active quest is
 * finished when its check passes; quests already satisfied by what the child
 * did on their own are ticked off quietly; the next open quest becomes active.
 */
export function syncQuests(w: WorldSave): QuestSync {
  const prev = w.quests ?? { completed: [], active: null };
  const completed = [...prev.completed];
  let finished: QuestDef | null = null;
  const active = prev.active ? QUEST_BY_ID[prev.active] : null;
  if (active && active.modes.includes(w.mode) && !completed.includes(active.id) && active.check(w)) {
    completed.push(active.id);
    finished = active;
  }
  let next: string | null = null;
  const stillActive = active && active.modes.includes(w.mode) && !completed.includes(active.id) ? active : null;
  if (stillActive) next = stillActive.id;
  else {
    for (const q of questsForMode(w.mode)) {
      if (completed.includes(q.id)) continue;
      if (q.check(w)) {
        completed.push(q.id);
        continue;
      }
      if (q.requires && !q.requires(w)) continue;
      next = q.id;
      break;
    }
  }
  const progress: QuestProgress = { completed, active: next };
  const changed = progress.active !== prev.active || completed.length !== prev.completed.length;
  return { progress, finished, changed };
}
