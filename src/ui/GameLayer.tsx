"use client";
// Everything that gives children reasons to explore and come back, mounted
// once while a world is being played: progress tracking, Shelly the guide,
// the first-time intro, sticker celebrations, and the sticker book /
// storybook / photo mode overlays.

import { useEffect } from "react";
import { startProgressTracking } from "@/game/progress";
import { useGameUi } from "@/game/state";
import { Guide } from "./Guide";
import { Onboarding } from "./Onboarding";
import { StickerAward } from "./StickerAward";
import { StickerBook } from "./StickerBook";
import { Storybook } from "./Storybook";
import { PhotoMode } from "./PhotoMode";

export function GameLayer() {
  const overlay = useGameUi((s) => s.overlay);

  useEffect(() => startProgressTracking(), []);

  // Photo mode: tuck the HUD away (see .wg-photo-mode in globals.css).
  useEffect(() => {
    document.body.classList.toggle("wg-photo-mode", overlay === "photo");
    return () => document.body.classList.remove("wg-photo-mode");
  }, [overlay]);

  return (
    <>
      <Guide />
      <Onboarding />
      <StickerAward />
      {overlay === "stickers" && <StickerBook />}
      {overlay === "storybook" && <Storybook />}
      {overlay === "photo" && <PhotoMode />}
    </>
  );
}

export default GameLayer;
