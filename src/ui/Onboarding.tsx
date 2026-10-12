"use client";
// The first five minutes: Shelly says hello, asks the child to draw
// themselves (paper world), then walks them through a first creation in a few
// short bubbles. Every step offers "Skip"; finishing or skipping sets
// `onboarded` so it never comes back.

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/state/store";
import type { WorldMode } from "@/core/types";
import { guideHide, guideSay, offerQuest, onGameEvent, openDrawingBoard } from "@/game/guide";
import { useGameUi, type GuideButton } from "@/game/state";

type Step = "hello" | "drawme" | "waitme" | "draw" | "waitdraw" | "alive" | "tap" | "walk";

export function Onboarding() {
  const onboarded = useGame((s) => s.world?.onboarded);
  const mode = useGame((s) => s.mode);
  const runtime = useGame((s) => s.runtime);
  if (onboarded !== false || !mode || !runtime) return null;
  return <OnboardingFlow key={`${mode}-${runtime.seed}`} mode={mode} />;
}

function isCoarse(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function finish(withBye = true) {
  const g = useGame.getState();
  g.patchWorld({ onboarded: true });
  if (withBye) guideSay("Have fun! Tap me if you need me.", { autoHideMs: 4500 });
  else guideHide();
  // Offer the first little quest a bit later, if the child isn't busy.
  setTimeout(() => {
    const s = useGame.getState();
    const ui = useGameUi.getState();
    if (!s.world || s.panel || ui.overlay || ui.bubble || ui.awardQueue.length) {
      ui.setGuideNews(true);
      return;
    }
    offerQuest();
  }, 14000);
}

function OnboardingFlow({ mode }: { mode: WorldMode }) {
  const [step, setStep] = useState<Step>(() => {
    const w = useGame.getState().world!;
    if (mode === "gallery") return w.easels.length ? "walk" : "hello";
    if (w.creations.length) return "tap";
    return w.playerArtworkId ? "draw" : "hello";
  });
  const baseline = useRef<number>(0);
  const drewMe = useRef(false);

  const skip: GuideButton = { label: "Skip", tone: "paper", onClick: () => finish(false) };

  // What Shelly says at each step.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const say = () => {
      switch (step) {
        case "hello":
          guideSay(mode === "gallery" ? "Hi! I'm Shelly. Welcome to your gallery planet!" : "Hi! I'm Shelly. This is your very own planet!", {
            buttons: [{ label: "Hello!", tone: "green", onClick: () => setStep(mode === "gallery" ? "draw" : "drawme") }, skip],
          });
          break;
        case "drawme":
          guideSay("First, let's draw YOU!", {
            buttons: [
              {
                label: "Draw me!",
                tone: "green",
                onClick: () => {
                  guideHide();
                  setStep("waitme");
                  openDrawingBoard({ purpose: "player" });
                },
              },
              skip,
            ],
          });
          break;
        case "draw": {
          const w = useGame.getState().world;
          baseline.current = mode === "gallery" ? (w?.easels.length ?? 0) : (w?.creations.length ?? 0);
          const text =
            mode === "gallery" ? "Draw a picture to hang in your gallery!" : drewMe.current ? "That's you! Now draw anything you like!" : "Now draw anything you like!";
          guideSay(text, {
            mood: drewMe.current ? "wow" : "happy",
            buttons: [
              {
                label: "Draw!",
                tone: "green",
                onClick: () => {
                  guideHide();
                  setStep("waitdraw");
                  openDrawingBoard({ purpose: "creation", prompt: mode === "gallery" ? "Draw a picture to hang!" : null });
                },
              },
              skip,
            ],
          });
          break;
        }
        case "alive":
          guideSay(mode === "gallery" ? "Beautiful! Visitors will come to look." : "Look! It came alive!", {
            mood: "wow",
            buttons: [{ label: "Yay!", tone: "green", onClick: () => setStep(mode === "gallery" ? "walk" : "tap") }],
          });
          break;
        case "tap":
          guideSay("Tap it to say hi!", { buttons: [{ label: "OK!", tone: "green", onClick: () => guideHide() }] });
          // Don't wait forever.
          t = setTimeout(() => setStep("walk"), 25000);
          break;
        case "walk":
          guideSay(isCoarse() ? "Use the joystick to walk around!" : "Use the arrow keys to walk around!", {
            buttons: [{ label: "Let's go!", tone: "green", onClick: () => finish(true) }],
          });
          break;
        default:
          break;
      }
    };
    // Let the planet show itself before the very first hello.
    const delay = step === "hello" ? 1200 : 350;
    const d = setTimeout(say, delay);
    return () => {
      clearTimeout(d);
      if (t) clearTimeout(t);
    };
  }, [step, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch the game for the things each step waits on.
  useEffect(() => {
    return useGame.subscribe((s, prev) => {
      if (!s.world) return;
      if (step === "waitme") {
        if (s.world.playerArtworkId && s.world.playerArtworkId !== prev.world?.playerArtworkId) {
          drewMe.current = true;
          setStep("draw");
        } else if (!s.panel && prev.panel) setStep("draw");
      } else if (step === "waitdraw" || step === "draw") {
        // Any new creation counts (drawn, uploaded or a sample). Wait for its
        // paper-plane arrival before cheering.
        const n = mode === "gallery" ? s.world.easels.length : s.world.creations.length;
        if (n > baseline.current) {
          baseline.current = n;
          guideHide();
          setTimeout(() => setStep("alive"), mode === "gallery" ? 1200 : 3000);
        } else if (step === "waitdraw" && !s.panel && prev.panel) {
          if (s.pending) guideSay("Your drawing is waiting! Tap it to bring it to life.", { autoHideMs: 6000 });
          else setStep("draw");
        }
      }
    });
  }, [step, mode]);

  // A pat (tapping a creation) moves the "tap it" step along.
  useEffect(() => {
    if (step !== "tap") return;
    return onGameEvent((name) => {
      if (name === "pat") setStep("walk");
    });
  }, [step]);

  return null;
}
