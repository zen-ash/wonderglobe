"use client";
// Game-level React state (screens, panels, saved records) and the actions that
// connect UI, simulation runtime and persistence. Per-frame data lives in the
// WorldRuntime, never here.

import { create } from "zustand";
import type {
  ArtworkSource,
  CreationRecord,
  CutoutMeta,
  EaselRecord,
  Preferences,
  ServiceStatus,
  WorldMode,
  WorldSave,
} from "@/core/types";
import { NO_SERVICES, DEFAULT_PREFERENCES } from "@/core/types";
import { WorldRuntime } from "@/world/runtime";
import {
  createAutosaver,
  createEmptyWorld,
  loadWorld,
  saveWorld,
  loadPreferences,
  savePreferences,
  type Autosaver,
} from "@/persistence";
import { resetCamera } from "@/render/cameraControl";
import { getKind } from "@/core/kinds";
import { speech } from "@/audio/speech";
import { playCreatureSound } from "@/audio/creatures";
import { reportEvent } from "@/game/guide";

export type Panel =
  | "draw"
  | "upload"
  | "samples"
  | "life"
  | "creation"
  | "easel"
  | "easelForm"
  | "collection"
  | "settings"
  | "help";

export interface PendingArtwork {
  artworkId: string;
  originalUrl: string;
  cutoutUrl: string;
  meta: CutoutMeta;
  source: ArtworkSource;
  suggestedKind?: string;
  sampleLabel?: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "happy" | "warn";
}

interface GameState {
  screen: "title" | "loading" | "playing";
  loadingText: string;
  mode: WorldMode | null;
  world: WorldSave | null;
  runtime: WorldRuntime | null;
  prefs: Preferences;
  services: ServiceStatus;
  panel: Panel | null;
  selectedId: string | null;
  pending: PendingArtwork | null;
  toasts: Toast[];
  region: { name: string; emoji: string; key: number } | null;
  carrying: { id: string; ok: boolean } | null;
  saveError: string | null;
  /** Gallery: the easel whose opening ribbon is waiting to be cut. */
  ribbon: string | null;
  /** Id of the creation the player is riding, if any. */
  riding: string | null;
  /** Bumped when a ribbon is cut (drives the ceremony animation). */
  ribbonCutAt: number;
  setRibbon(id: string | null): void;
  cutRibbon(): void;

  init(): void;
  setServices(s: ServiceStatus): void;
  setPrefs(patch: Partial<Preferences>): void;
  startWorld(mode: WorldMode): Promise<void>;
  leaveWorld(): Promise<void>;
  replaceWorld(world: WorldSave): Promise<void>;
  openPanel(panel: Panel | null, selectedId?: string | null): void;
  setPending(p: PendingArtwork | null): void;
  addCreation(rec: CreationRecord): void;
  updateCreation(id: string, patch: Partial<CreationRecord>): void;
  removeCreation(id: string): void;
  addEasel(rec: EaselRecord): void;
  updateEasel(id: string, patch: Partial<EaselRecord>): void;
  removeEasel(id: string): void;
  /** Merge top-level fields into the saved world (stickers, quests, player art…). */
  patchWorld(patch: Partial<WorldSave>): void;
  markDirty(): void;
  flushSave(): Promise<void>;
  toast(text: string, tone?: Toast["tone"]): void;
  dismissToast(id: number): void;
  setRegion(name: string, emoji: string): void;
  setCarrying(c: { id: string; ok: boolean } | null): void;
}

let autosaver: Autosaver | null = null;
let periodic: ReturnType<typeof setInterval> | null = null;
let unsubRuntime: Array<() => void> = [];
let toastId = 1;
let lastNoticeSound = 0;

export const useGame = create<GameState>((set, get) => ({
  screen: "title",
  loadingText: "",
  mode: null,
  world: null,
  runtime: null,
  prefs: DEFAULT_PREFERENCES,
  services: NO_SERVICES,
  panel: null,
  selectedId: null,
  pending: null,
  toasts: [],
  region: null,
  carrying: null,
  saveError: null,
  ribbon: null,
  ribbonCutAt: 0,
  riding: null,

  setRibbon(id) {
    set({ ribbon: id });
  },

  cutRibbon() {
    const { ribbon, runtime } = get();
    if (!ribbon) return;
    const e = runtime?.easels.get(ribbon);
    if (e && runtime) runtime.celebrate(e.n, "heart");
    set({ ribbon: null, ribbonCutAt: Date.now() });
  },

  init() {
    set({ prefs: loadPreferences() });
  },

  setServices(s) {
    set({ services: s });
  },

  setPrefs(patch) {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    savePreferences(prefs);
  },

  async startWorld(mode) {
    set({ screen: "loading", loadingText: "Unfolding your planet…", mode });
    let world: WorldSave | null = null;
    try {
      world = await loadWorld(mode);
    } catch (err) {
      console.warn("Could not load saved world", err);
      get().toast("We couldn't open your saved planet, so here's a fresh one. Your old one is kept safe.", "warn");
    }
    let fresh = false;
    if (!world) {
      world = createEmptyWorld(mode);
      fresh = true;
    }
    // Let the loading screen paint before building the world.
    await new Promise((r) => setTimeout(r, 30));
    const runtime = new WorldRuntime(world);
    resetCamera();
    unsubRuntime.forEach((u) => u());
    unsubRuntime = [
      runtime.events.on("region", (e) => get().setRegion(e.name, e.emoji)),
      runtime.events.on("rejected", (e) => get().toast(e.reason, "warn")),
      runtime.events.on("moved", () => get().markDirty()),
      // A creation touching down says hello in its own voice.
      runtime.events.on("arrived", (e) => {
        const k = getKind(e.kind);
        if (k.soundPrompt || k.category === "animal") void speech.playAnimalSound(e.kind);
      }),
      // Creatures that notice the player make a little sound (gently throttled).
      runtime.events.on("notice", (e) => {
        const now = performance.now();
        if (now - lastNoticeSound < 1500) return;
        lastNoticeSound = now;
        const a = runtime.creations.get(e.id);
        const dist = a ? a.pos.distanceTo(runtime.player.pos) : 4;
        playCreatureSound(e.kind, { volume: Math.max(0.25, 1 - dist / 8) * (e.mood === "shy" ? 0.6 : 1) });
      }),
      runtime.events.on("ride", (e) => {
        set({ riding: e.phase === "start" ? e.id : null });
        if (e.phase === "start") reportEvent("ride");
      }),
    ];
    autosaver?.dispose();
    autosaver = createAutosaver(
      () => {
        const s = get();
        return s.runtime && s.world ? s.runtime.snapshot(s.world) : s.world!;
      },
      {
        delayMs: 800,
        onError: (e) => set({ saveError: e.message || "Saving isn't working right now." }),
        onSaved: () => get().saveError && set({ saveError: null }),
      },
    );
    if (periodic) clearInterval(periodic);
    // Moving creatures drift; save their spots every so often.
    periodic = setInterval(() => autosaver?.schedule(), 15000);
    if (fresh) {
      try {
        await saveWorld(world);
      } catch (e) {
        set({ saveError: (e as Error).message });
      }
    }
    const def = runtime.regionNameAt(runtime.player.n);
    set({ world, runtime, screen: "playing", panel: null, selectedId: null, region: { name: def, emoji: "", key: Date.now() } });
    get().setPrefs({ lastMode: mode });
  },

  async leaveWorld() {
    await get().flushSave();
    autosaver?.dispose();
    autosaver = null;
    if (periodic) clearInterval(periodic);
    periodic = null;
    unsubRuntime.forEach((u) => u());
    unsubRuntime = [];
    get().runtime?.dispose();
    set({ screen: "title", world: null, runtime: null, mode: null, panel: null, selectedId: null, pending: null, carrying: null, ribbon: null, riding: null });
  },

  async replaceWorld(world) {
    const mode = world.mode;
    if (get().mode) {
      autosaver?.dispose();
      autosaver = null;
      get().runtime?.dispose();
      set({ runtime: null, world: null });
    }
    await get().startWorld(mode);
  },

  openPanel(panel, selectedId) {
    set({ panel, selectedId: selectedId === undefined ? get().selectedId : selectedId });
  },

  setPending(p) {
    set({ pending: p });
  },

  addCreation(rec) {
    const { world, runtime } = get();
    if (!world || !runtime) return;
    runtime.addCreation(rec, true);
    set({ world: { ...world, creations: [...world.creations, rec] } });
    get().markDirty();
  },

  updateCreation(id, patch) {
    const { world } = get();
    if (!world) return;
    set({ world: { ...world, creations: world.creations.map((c) => (c.id === id ? { ...c, ...patch } : c)) } });
    get().markDirty();
  },

  removeCreation(id) {
    const { world, runtime } = get();
    if (!world) return;
    runtime?.removeCreation(id);
    set({ world: { ...world, creations: world.creations.filter((c) => c.id !== id) }, panel: null, selectedId: null });
    get().markDirty();
    // Tidy up pictures nothing uses any more (after the save lands).
    void get()
      .flushSave()
      .then(() => import("@/ui/artworkFlow"))
      .then((m) => m.collectGarbage())
      .catch(() => {});
  },

  addEasel(rec) {
    const { world, runtime } = get();
    if (!world || !runtime) return;
    runtime.addEasel(rec, true);
    set({ world: { ...world, easels: [...world.easels, rec] } });
    get().markDirty();
  },

  updateEasel(id, patch) {
    const { world } = get();
    if (!world) return;
    set({ world: { ...world, easels: world.easels.map((e) => (e.id === id ? { ...e, ...patch } : e)) } });
    get().markDirty();
  },

  removeEasel(id) {
    const { world, runtime } = get();
    if (!world) return;
    runtime?.removeEasel(id);
    set({ world: { ...world, easels: world.easels.filter((e) => e.id !== id) }, panel: null, selectedId: null });
    get().markDirty();
    void get()
      .flushSave()
      .then(() => import("@/ui/artworkFlow"))
      .then((m) => m.collectGarbage())
      .catch(() => {});
  },

  patchWorld(patch) {
    const { world } = get();
    if (!world) return;
    set({ world: { ...world, ...patch } });
    get().markDirty();
  },

  markDirty() {
    autosaver?.schedule();
  },

  async flushSave() {
    await autosaver?.flush();
  },

  toast(text, tone = "info") {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone }] });
    setTimeout(() => get().dismissToast(id), tone === "warn" ? 5200 : 3600);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setRegion(name, emoji) {
    set({ region: { name, emoji, key: Date.now() } });
  },

  setCarrying(c) {
    set({ carrying: c });
  },
}));

export function newId(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}
