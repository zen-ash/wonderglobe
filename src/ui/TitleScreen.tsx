"use client";
// The first screen: choose the Living Paper World or the Miniature Gallery World.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGame } from "@/state/store";
import { loadWorld } from "@/persistence";
import type { WorldMode } from "@/core/types";
import { HelpIcon, MusicIcon } from "./Icons";
import { playSfx } from "@/audio/sfx";

// The turning 3D planet behind the logo: loaded lazily, client only, and
// simply absent if WebGL isn't available.
const TitlePlanet = dynamic(() => import("@/render/TitlePlanet"), { ssr: false, loading: () => null });

function useOsReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

const S = { stroke: "#2b2320", strokeWidth: 3.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function PaperWorldArt() {
  return (
    <svg viewBox="0 0 240 180" role="img" aria-label="A little paper planet with trees and a house">
      <rect width="240" height="180" fill="#a8e0d8" />
      <circle cx="200" cy="34" r="16" fill="#ffd447" {...S} />
      <path d="M40 40c4-10 22-10 24 0 10 0 10 12 0 12H38c-8 0-8-12 2-12z" fill="#fffdf6" {...S} />
      <circle cx="120" cy="210" r="120" fill="#8fd46c" {...S} />
      <ellipse cx="160" cy="118" rx="22" ry="7" fill="#7cc8d3" {...S} />
      {/* tree */}
      <path d="M62 112v-20" {...S} stroke="#fffdf6" strokeWidth="11" />
      <path d="M62 112v-20" {...S} />
      <circle cx="62" cy="80" r="17" fill="#fffdf6" />
      <circle cx="62" cy="80" r="14" fill="#5fb85a" {...S} />
      {/* house */}
      <path d="M100 104V84h28v20zM96 86l18-16 18 16z" fill="#fffdf6" stroke="#fffdf6" strokeWidth="10" strokeLinejoin="round" />
      <path d="M100 104V84h28v20z" fill="#ffe9a3" {...S} />
      <path d="M96 86l18-16 18 16z" fill="#ef5b5b" {...S} />
      <rect x="110" y="92" width="8" height="12" fill="#8b5a2b" {...S} strokeWidth="2.5" />
      {/* fish drawing */}
      <path d="M146 112c6-10 22-10 28 0-6 10-22 10-28 0zM174 112l10-7v14z" fill="#4dabf7" {...S} />
      {/* flowers */}
      <circle cx="86" cy="118" r="4" fill="#ff8fc2" {...S} strokeWidth="2.5" />
      <circle cx="196" cy="128" r="4" fill="#ffd447" {...S} strokeWidth="2.5" />
      {/* drawn kid */}
      <circle cx="40" cy="128" r="6" fill="#f6d2b4" {...S} strokeWidth="2.5" />
      <path d="M40 134v10M34 150l6-6 6 6" {...S} strokeWidth="2.5" />
    </svg>
  );
}

function GalleryWorldArt() {
  return (
    <svg viewBox="0 0 240 180" role="img" aria-label="A colourful planet with easels and little visitors">
      <rect width="240" height="180" fill="#bfe6ff" />
      <circle cx="36" cy="32" r="14" fill="#ffd447" {...S} />
      <circle cx="120" cy="215" r="120" fill="#b0e07c" {...S} />
      {/* easel 1 */}
      <path d="M76 120l10-46M106 120l-10-46M91 72v50" {...S} stroke="#c98d55" strokeWidth="5" />
      <path d="M76 120l10-46M106 120l-10-46" fill="none" {...S} strokeWidth="2" />
      <rect x="70" y="56" width="42" height="34" fill="#fffdf6" {...S} />
      <path d="M78 82c6-10 14-16 26-10" fill="none" stroke="#ef5b5b" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="96" cy="66" r="4" fill="#ffd447" />
      <rect x="104" y="52" width="12" height="12" fill="#ffe066" {...S} strokeWidth="2.5" transform="rotate(10 110 58)" />
      {/* easel 2 */}
      <path d="M150 124l8-36M174 124l-8-36" {...S} stroke="#c98d55" strokeWidth="5" />
      <rect x="144" y="74" width="36" height="28" fill="#fffdf6" {...S} />
      <path d="M150 96l8-10 6 6 6-8 6 12" fill="#9fd3ff" {...S} strokeWidth="2.5" />
      {/* visitors */}
      <path d="M126 132l6-18 6 18z" fill="#ff8fc2" {...S} strokeWidth="2.5" />
      <circle cx="132" cy="108" r="6" fill="#f6d2b4" {...S} strokeWidth="2.5" />
      <path d="M44 128l6-18 6 18z" fill="#6aa8ff" {...S} strokeWidth="2.5" />
      <circle cx="50" cy="104" r="6" fill="#e0b08c" {...S} strokeWidth="2.5" />
      <path d="M194 128l6-18 6 18z" fill="#ffd447" {...S} strokeWidth="2.5" />
      <circle cx="200" cy="104" r="6" fill="#f6d2b4" {...S} strokeWidth="2.5" />
      <path d="M128 92c4-6 10-6 12 0" fill="#fffdf6" {...S} strokeWidth="2" />
      <text x="134" y="96" fontSize="10" textAnchor="middle" fill="#ef5b5b" fontWeight="700">♥</text>
    </svg>
  );
}

const LETTERS = "Wonderglobe".split("");
const LETTER_COLORS = ["#ef5b5b", "#ff9f5a", "#ffd447", "#7fcf63", "#4fc1b5", "#6aa8ff", "#b48cff", "#ff8fc2", "#ef5b5b", "#ffd447", "#7fcf63"];

export function TitleScreen() {
  const { startWorld, openPanel } = useGame.getState();
  const prefs = useGame((s) => s.prefs);
  const osReduced = useOsReducedMotion();
  const [saved, setSaved] = useState<Record<WorldMode, number | null>>({ paper: null, gallery: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, g] = await Promise.all([loadWorld("paper").catch(() => null), loadWorld("gallery").catch(() => null)]);
      if (!alive) return;
      setSaved({ paper: p ? p.creations.length : null, gallery: g ? g.easels.length : null });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const go = (mode: WorldMode) => {
    playSfx("whoosh");
    void startWorld(mode);
  };

  const card = (mode: WorldMode, title: string, text: string, art: React.ReactNode, color: string) => {
    const count = saved[mode];
    return (
      <button className="world-card paper" onClick={() => go(mode)} aria-label={`${count !== null ? "Continue" : "Start"} ${title}`}>
        <div className="art">{art}</div>
        <div>
          <h2>{title}</h2>
          <p>{text}</p>
          <span className={`btn go ${color}`} aria-hidden>
            {count !== null ? `Continue${count ? ` (${count})` : ""}` : "Start"} ➜
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="title-screen">
      <TitlePlanet reducedMotion={prefs.reducedMotion || osReduced} />
      <h1 className="title-logo" aria-label="Wonderglobe">
        {LETTERS.map((l, i) => (
          <span key={i} style={{ color: LETTER_COLORS[i], ["--r" as string]: `${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg`, animationDelay: `${i * 0.12}s` }} aria-hidden>
            {l}
          </span>
        ))}
      </h1>
      <p className="title-sub">Draw something, and watch it come alive on a tiny planet.</p>
      <div className="world-cards">
        {card("paper", "Living Paper World", "Your drawings become paper animals, plants, houses and friends.", <PaperWorldArt />, "green")}
        {card("gallery", "Miniature Gallery World", "Hang your pictures on easels and little visitors come to look.", <GalleryWorldArt />, "blue")}
      </div>
      <div className="title-foot">
        <button className="btn paper-btn" onClick={() => openPanel("help")}>
          <HelpIcon /> How to play
        </button>
        <button className="btn paper-btn" onClick={() => useGame.getState().setPrefs({ music: !prefs.music })} aria-pressed={prefs.music}>
          <MusicIcon /> Music {prefs.music ? "on" : "off"}
        </button>
      </div>
    </div>
  );
}
