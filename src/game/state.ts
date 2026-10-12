"use client";
// UI state for the exploring/collecting layer (sticker book, storybook, photo
// mode, the guide's speech bubble, sticker celebrations, the drawing board's
// purpose). Kept apart from the main game store so neither needs the other's
// internals.

import { create } from "zustand";
import { playSfx, type SfxOptions } from "@/audio/sfx";

export type GameOverlay = "stickers" | "storybook" | "photo" | null;
export type DrawPurpose = "creation" | "player";

export interface GuideButton {
  label: string;
  /** Visual style of the button. */
  tone?: "green" | "paper" | "pink" | "blue";
  onClick: () => void;
}

export interface GuideBubble {
  id: number;
  text: string;
  buttons: GuideButton[];
  mood: "happy" | "wow" | "think";
  /** Hide by itself after this many ms (0 = stays until dismissed). */
  autoHideMs: number;
}

export interface Postcard {
  id: number;
  url: string;
  region: string;
  at: number;
}

interface GameUiState {
  overlay: GameOverlay;
  /** Stickers waiting for their big celebration (shown one by one). */
  awardQueue: string[];
  bubble: GuideBubble | null;
  /** Whether a quest/hint is waiting behind Shelly's portrait. */
  guideHasNews: boolean;
  drawPurpose: DrawPurpose;
  drawPrompt: string | null;
  /** The last few postcards of this session (newest first). */
  postcards: Postcard[];
  setOverlay(o: GameOverlay): void;
  queueAward(ids: string[]): void;
  shiftAward(): void;
  setBubble(b: GuideBubble | null): void;
  setGuideNews(v: boolean): void;
  setDraw(purpose: DrawPurpose, prompt: string | null): void;
  addPostcard(p: Omit<Postcard, "id">): void;
  reset(): void;
}

let pid = 1;

export const useGameUi = create<GameUiState>((set, get) => ({
  overlay: null,
  awardQueue: [],
  bubble: null,
  guideHasNews: false,
  drawPurpose: "creation",
  drawPrompt: null,
  postcards: [],
  setOverlay(o) {
    set({ overlay: o });
  },
  queueAward(ids) {
    if (!ids.length) return;
    const q = get().awardQueue;
    set({ awardQueue: [...q, ...ids.filter((id) => !q.includes(id))] });
  },
  shiftAward() {
    set({ awardQueue: get().awardQueue.slice(1) });
  },
  setBubble(b) {
    set({ bubble: b });
  },
  setGuideNews(v) {
    set({ guideHasNews: v });
  },
  setDraw(purpose, prompt) {
    set({ drawPurpose: purpose, drawPrompt: prompt });
  },
  addPostcard(p) {
    set({ postcards: [{ ...p, id: pid++ }, ...get().postcards].slice(0, 6) });
  },
  reset() {
    set({ overlay: null, awardQueue: [], bubble: null, guideHasNews: false, drawPurpose: "creation", drawPrompt: null });
  },
}));

const FALLBACK: Record<string, string> = {
  sticker: "sparkle",
  found: "chime",
  camera: "click",
  guide: "pop",
  page: "rustle",
  butterfly: "sparkle",
};

/**
 * Play a sound by name even if this build's sound list doesn't have it yet
 * (new names like "sticker" are being added separately); falls back to a
 * similar existing sound.
 */
export function safeSfx(name: string, opts?: SfxOptions): void {
  const play = playSfx as unknown as (n: string, o?: SfxOptions) => void;
  try {
    play(name, opts);
  } catch {
    const fb = FALLBACK[name];
    if (fb) {
      try {
        play(fb, opts);
      } catch {
        /* sound is a nicety */
      }
    }
  }
}

/** Open one of the game overlays (sticker book, storybook, photo mode). */
export function openStickerBook() {
  safeSfx("click");
  useGameUi.getState().setOverlay("stickers");
}
export function openStorybook() {
  safeSfx("click");
  useGameUi.getState().setOverlay("storybook");
}
export function openPhotoMode() {
  safeSfx("click");
  useGameUi.getState().setOverlay("photo");
}
export function closeGameOverlay() {
  useGameUi.getState().setOverlay(null);
}

/** Hook for the HUD: true while photo mode is up (hide buttons then). */
export function usePhotoModeActive(): boolean {
  return useGameUi((s) => s.overlay === "photo");
}
