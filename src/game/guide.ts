"use client";
// Shelly the paper snail: what she says and the small public API the rest of
// the game uses (guideSay, reportEvent, openGuide). She never blocks play:
// every bubble can be put away with "Later" and brought back by tapping her.

import * as THREE from "three";
import { useGame } from "@/state/store";
import { speech } from "@/audio/speech";
import { REGION_BY_ID } from "@/world/planet";
import { useGameUi, safeSfx, openPhotoMode, type GuideButton, type GuideBubble, type DrawPurpose } from "./state";
import { QUEST_BY_ID, questAction, type QuestAction } from "./quests";

let bubbleId = 1;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** The last bubble that asked something (so tapping Shelly can bring it back). */
let lastAsk: GuideBubble | null = null;

export interface GuideSayOptions {
  buttons?: GuideButton[];
  mood?: GuideBubble["mood"];
  /** Hide by itself after this many ms (default: 0 when there are buttons, else 5500). */
  autoHideMs?: number;
  /** Read the line aloud (default true; respects the voice setting). */
  speak?: boolean;
}

/** Shelly says something (short!) in her speech bubble. */
export function guideSay(text: string, opts: GuideSayOptions = {}): void {
  const buttons = opts.buttons ?? [];
  const autoHideMs = opts.autoHideMs ?? (buttons.length ? 0 : 5500);
  const b: GuideBubble = { id: bubbleId++, text, buttons, mood: opts.mood ?? "happy", autoHideMs };
  useGameUi.getState().setBubble(b);
  if (buttons.length) lastAsk = b;
  safeSfx("guide", { volume: 0.6 });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (autoHideMs > 0) {
    hideTimer = setTimeout(() => {
      if (useGameUi.getState().bubble?.id === b.id) useGameUi.getState().setBubble(null);
    }, autoHideMs);
  }
  if (opts.speak !== false) speakLine(text);
}

/** Read a line aloud in Shelly's voice (optionally only if nothing else is being said). */
export function speakLine(text: string, opts: { ifQuiet?: boolean } = {}): void {
  if (opts.ifQuiet && speech.isSpeaking()) return;
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
  if (!clean) return;
  void speech.say({ text: clean, characterId: "guide-shelly", voiceType: "bright" }).catch(() => {});
}

export function guideHide(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  useGameUi.getState().setBubble(null);
}

/** Open the drawing board for a purpose, optionally with a prompt in its header. */
export function openDrawingBoard(opts: { purpose?: DrawPurpose; prompt?: string | null } = {}): void {
  useGameUi.getState().setDraw(opts.purpose ?? "creation", opts.prompt ?? null);
  useGame.getState().openPanel("draw");
}

/** Hop near a region (used by "Let's go!" quest buttons). */
export async function goToRegion(region: keyof typeof REGION_BY_ID): Promise<void> {
  const def = REGION_BY_ID[region];
  const rt = useGame.getState().runtime;
  if (!def || !rt) return;
  const { travelNear } = await import("@/ui/travel");
  // Land a little way out so there's still something to find.
  const n = def.center.clone();
  const toward = rt.player.n.clone().sub(n.clone().multiplyScalar(rt.player.n.dot(n)));
  if (toward.lengthSq() < 1e-6) toward.set(1, 0, 0);
  toward.normalize();
  const target = n.clone().multiplyScalar(Math.cos(0.14)).addScaledVector(toward, Math.sin(0.14)).normalize();
  travelNear(new THREE.Vector3().copy(target), { standOff: 1.5 });
  safeSfx("whoosh");
}

function runAction(a: QuestAction) {
  guideHide();
  if (a.kind === "draw") openDrawingBoard({ purpose: "creation", prompt: a.prompt });
  else if (a.kind === "go") void goToRegion(a.region);
  else if (a.kind === "camera") openPhotoMode();
}

/** Show the active quest (or a friendly line when there's nothing to do). */
export function offerQuest(): void {
  const world = useGame.getState().world;
  if (!world) return;
  const q = world.quests?.active ? QUEST_BY_ID[world.quests.active] : null;
  useGameUi.getState().setGuideNews(false);
  if (!q) {
    const lines = ["You're doing great!", "What will you draw next?", "Let's explore!", "I love your planet!"];
    guideSay(lines[Math.floor(Math.random() * lines.length)], { mood: "happy" });
    return;
  }
  const a = questAction(q, world);
  const buttons: GuideButton[] = [];
  if (a) buttons.push({ label: a.label, tone: "green", onClick: () => runAction(a) });
  buttons.push({ label: a ? "Later" : "OK!", tone: "paper", onClick: () => guideHide() });
  guideSay(q.prompt, { buttons, mood: "think" });
}

/** Tapping Shelly (portrait or the 3D snail). */
export function openGuide(): void {
  if (useGameUi.getState().bubble) {
    guideHide();
    return;
  }
  // During the first-time intro, bring back Shelly's last question.
  if (useGame.getState().world?.onboarded === false && lastAsk) {
    useGameUi.getState().setBubble({ ...lastAsk, id: bubbleId++ });
    speakLine(lastAsk.text);
    return;
  }
  offerQuest();
}

export type GameEventName = "pat" | "ride" | "photo" | "storybook" | "note" | "draw" | (string & {});

type EventListener = (name: string, data?: unknown) => void;
const eventListeners = new Set<EventListener>();

/** Tell the game layer something happened (a pat, a ride, a photo…). */
export function reportEvent(name: GameEventName, data?: unknown): void {
  eventListeners.forEach((fn) => {
    try {
      fn(name, data);
    } catch (e) {
      console.warn("[wonderglobe] game event handler failed", e);
    }
  });
}

export function onGameEvent(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
