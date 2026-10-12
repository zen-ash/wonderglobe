"use client";
// The progress tracker: watches the game store, runtime events and the
// environment, keeps `visited`, `stickers`, `found` and `quests` in the save
// up to date (via patchWorld) and queues sticker celebrations. No edits to the
// main store are needed — everything is observed from the outside.

import type { WorldRuntime } from "@/world/runtime";
import type { WorldSave } from "@/core/types";
import { REGIONS } from "@/world/planet";
import { environment } from "@/world/environment";
import { useGame } from "@/state/store";
import { useGameUi, safeSfx } from "./state";
import { newStickers, stickersEarnedByWorld, withStickers } from "./stickers";
import { syncQuests } from "./quests";
import { placeTreasures, TREASURE_LABELS, GOLDEN_BUTTERFLY_IDS, type TreasureDef } from "./collectibles";
import { guideSay, offerQuest, onGameEvent, reportEvent } from "./guide";

const treasureCache = new WeakMap<WorldRuntime, TreasureDef[]>();

/** The treasures hidden in a running world (cached per runtime). */
export function treasuresFor(runtime: WorldRuntime): TreasureDef[] {
  let t = treasureCache.get(runtime);
  if (!t) {
    t = placeTreasures(runtime.terrain, runtime.seed, runtime.mode, runtime.layout);
    treasureCache.set(runtime, t);
  }
  return t;
}

const EVENT_STICKERS: Record<string, string> = {
  pat: "pat",
  ride: "rider",
  photo: "postcard",
};

let questTimer: ReturnType<typeof setTimeout> | null = null;
let evaluating = false;
/** True while quietly catching up on a freshly loaded world (no celebrations). */
let catchingUp = false;

/** Award stickers now. Celebrated with the big overlay unless `silent`. */
export function awardStickers(ids: string[], opts: { silent?: boolean } = {}): string[] {
  const { world, patchWorld } = useGame.getState();
  if (!world) return [];
  const fresh = newStickers(world, ids);
  if (!fresh.length) return [];
  patchWorld({ stickers: withStickers(world, fresh) });
  if (!opts.silent) useGameUi.getState().queueAward(fresh);
  return fresh;
}

/**
 * Show earned stickers — but let a brand-new creation finish its paper-plane
 * arrival first, so the celebration doesn't cover the moment it comes alive.
 */
function queueAfterArrival(ids: string[]) {
  if (!ids.length) return;
  const world = useGame.getState().world;
  const newest = Math.max(0, ...(world?.creations ?? []).map((c) => c.createdAt), ...(world?.easels ?? []).map((e) => e.createdAt));
  const wait = 3200 - (Date.now() - newest);
  if (wait > 0) setTimeout(() => useGameUi.getState().queueAward(ids), wait);
  else useGameUi.getState().queueAward(ids);
}

/** Remember a region as visited. */
export function markVisited(regionId: string): void {
  const { world, patchWorld } = useGame.getState();
  if (!world || world.visited.includes(regionId)) return;
  patchWorld({ visited: [...world.visited, regionId] });
}

/** Pick up a treasure or golden butterfly by id (idempotent). */
export function collectFound(id: string): boolean {
  const { world, patchWorld } = useGame.getState();
  if (!world) return false;
  const found = world.found ?? [];
  if (found.includes(id)) return false;
  safeSfx("found");
  // Say it first: a quest finished by this find may cheer right after.
  if ((GOLDEN_BUTTERFLY_IDS as readonly string[]).includes(id)) guideSay("You caught a golden butterfly!", { mood: "wow" });
  else if (id === "summit-star") guideSay("The summit star! You flew so high!", { mood: "wow" });
  else guideSay(`You found ${TREASURE_LABELS[id] ?? "a treasure"}!`, { mood: "wow" });
  patchWorld({ found: [...found, id] });
  return true;
}

/** Bring derived stickers and quests up to date with the world. */
function evaluate(silent: boolean) {
  if (evaluating) return;
  evaluating = true;
  try {
    for (let i = 0; i < 4; i++) {
      const { world, patchWorld } = useGame.getState();
      if (!world) return;
      const patch: Partial<WorldSave> = {};
      const fresh = newStickers(world, stickersEarnedByWorld(world));
      let next: WorldSave = world;
      if (fresh.length) {
        patch.stickers = withStickers(world, fresh);
        next = { ...world, ...patch };
      }
      const sync = syncQuests(next);
      let rewards: string[] = [];
      if (sync.changed) {
        patch.quests = sync.progress;
        if (sync.finished?.reward) {
          rewards = newStickers({ ...next, quests: sync.progress }, [sync.finished.reward]);
          if (rewards.length) patch.stickers = withStickers(next, rewards);
        }
      }
      if (!Object.keys(patch).length) return;
      patchWorld(patch);
      if (!silent) queueAfterArrival([...fresh, ...rewards]);
      const onboarding = useGame.getState().world?.onboarded === false;
      if (!silent && sync.finished && !onboarding) celebrateQuest(sync.finished.done);
      else if (!silent && sync.changed && sync.progress.active && !useGameUi.getState().bubble) {
        useGameUi.getState().setGuideNews(true);
      }
    }
  } finally {
    evaluating = false;
  }
}

function celebrateQuest(text: string) {
  guideSay(text, { mood: "wow", autoHideMs: 4500 });
  if (questTimer) clearTimeout(questTimer);
  // Offer the next little adventure after a moment (only if nothing else is going on).
  questTimer = setTimeout(() => {
    questTimer = null;
    const g = useGame.getState();
    const ui = useGameUi.getState();
    if (!g.world?.quests?.active || g.world.onboarded === false) return;
    if (g.panel || ui.overlay || ui.awardQueue.length || ui.bubble) ui.setGuideNews(true);
    else offerQuest();
  }, 9000);
}

/** First look at a loaded world: catch up quietly on what was already done. */
function catchUp(runtime: WorldRuntime) {
  const { world, patchWorld } = useGame.getState();
  if (!world) return;
  catchingUp = true;
  try {
    const patch: Partial<WorldSave> = {};
    const here = REGIONS[runtime.terrain.regionAt(runtime.player.n).index]?.id;
    if (here && !world.visited.includes(here)) patch.visited = [...world.visited, here];
    // Worlds made before the guide existed don't need the first-time intro.
    if (world.onboarded === undefined) patch.onboarded = world.creations.length > 0 || world.easels.length > 0;
    if (Object.keys(patch).length) patchWorld(patch);
    evaluate(true);
  } finally {
    catchingUp = false;
  }
  if (useGame.getState().world?.quests?.active) useGameUi.getState().setGuideNews(true);
}

/**
 * Start tracking progress for whatever world is loaded. Returns a stop
 * function. Safe to call once from a component that lives while playing.
 */
export function startProgressTracking(): () => void {
  let runtimeOff: Array<() => void> = [];
  let currentRuntime: WorldRuntime | null = null;

  const attach = (runtime: WorldRuntime | null) => {
    runtimeOff.forEach((f) => f());
    runtimeOff = [];
    currentRuntime = runtime;
    useGameUi.getState().reset();
    if (!runtime) return;
    runtimeOff.push(
      runtime.events.on("region", (e) => {
        const id = REGIONS[e.index]?.id;
        if (id) markVisited(id);
      }),
    );
    catchUp(runtime);
  };

  const unsubStore = useGame.subscribe((s, prev) => {
    if (s.runtime !== currentRuntime) attach(s.runtime);
    else if (s.world && s.world !== prev.world) evaluate(catchingUp);
    // Opening a creation by tapping it is a friendly pat.
    if (s.panel === "creation" && prev.panel !== "creation" && s.selectedId) reportEvent("pat");
  });

  const onEvent = (name: string) => {
    const sticker = EVENT_STICKERS[name];
    if (sticker) awardStickers([sticker]);
  };
  const unsubEvents = onGameEvent(onEvent);

  // Night and rainbows come and go: peek every few seconds.
  const envTimer = setInterval(() => {
    const g = useGame.getState();
    if (!g.world || g.screen !== "playing") return;
    const ids: string[] = [];
    if (environment.isNight) ids.push("night-owl");
    if (environment.weather === "rainbow" && environment.weatherAmount > 0.4) ids.push("rainbow");
    if (ids.length) awardStickers(ids);
  }, 3000);

  attach(useGame.getState().runtime);

  return () => {
    unsubStore();
    unsubEvents();
    clearInterval(envTimer);
    runtimeOff.forEach((f) => f());
    runtimeOff = [];
    if (questTimer) clearTimeout(questTimer);
    questTimer = null;
  };
}
