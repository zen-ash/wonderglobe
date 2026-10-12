"use client";
// The sticker book: a paper scrapbook (two-page spread on wide screens, one
// page on phones). Earned stickers in colour; the rest as soft grey
// silhouettes with a one-line hint. Tap a sticker to hear its name.

import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { ArrowLeftIcon, ArrowRightIcon } from "./Icons";
import { StickerBookIcon } from "./GameIcons";
import { useGame } from "@/state/store";
import { safeSfx, closeGameOverlay } from "@/game/state";
import { stickersForMode, type StickerDef } from "@/game/stickers";
import { speakLine } from "@/game/guide";
import { stickerUrl, stickerSilhouetteUrl } from "@/art/stickers";

const PER_PAGE = 12;

function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 760px)");
    setWide(mq.matches);
    const fn = () => setWide(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return wide;
}

/** Draw sticker art a few at a time so the book opens instantly. */
function useStickerArt(defs: StickerDef[], earned: Set<string>): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    let i = 0;
    let raf = 0;
    const step = () => {
      if (!alive) return;
      const batch: Record<string, string> = {};
      const until = performance.now() + 12;
      while (i < defs.length && performance.now() < until) {
        const d = defs[i++];
        batch[d.id] = earned.has(d.id) ? stickerUrl(d, 192) : stickerSilhouetteUrl(d, 192);
      }
      setUrls((u) => ({ ...u, ...batch }));
      if (i < defs.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [defs, earned]);
  return urls;
}

export function StickerBook() {
  const mode = useGame((s) => s.mode) ?? "paper";
  const stickers = useGame((s) => s.world?.stickers);
  const wide = useWide();
  // A stable order helps children find "their" spot in the book.
  const defs = useMemo(() => stickersForMode(mode), [mode]);
  const earned = useMemo(() => new Set(stickers ?? []), [stickers]);
  const urls = useStickerArt(defs, earned);
  const pages = useMemo(() => {
    const out: StickerDef[][] = [];
    for (let i = 0; i < defs.length; i += PER_PAGE) out.push(defs.slice(i, i + PER_PAGE));
    return out;
  }, [defs]);
  const perView = wide ? 2 : 1;
  const views = Math.ceil(pages.length / perView);
  const [view, setView] = useState(0);
  const [wiggle, setWiggle] = useState<string | null>(null);
  const count = defs.filter((d) => earned.has(d.id)).length;

  useEffect(() => {
    if (view >= views) setView(Math.max(0, views - 1));
  }, [view, views]);

  const turn = (d: number) => {
    const v = Math.min(views - 1, Math.max(0, view + d));
    if (v === view) return;
    safeSfx("page");
    setView(v);
  };

  const tap = (d: StickerDef) => {
    setWiggle(d.id);
    setTimeout(() => setWiggle((w) => (w === d.id ? null : w)), 600);
    if (earned.has(d.id)) {
      safeSfx("pop");
      speakLine(d.title);
    } else speakLine(d.hint);
  };

  const shown = pages.slice(view * perView, view * perView + perView);

  return (
    <Modal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <StickerBookIcon width={34} height={34} /> My Sticker Book
          <span className="sticker-count">
            {count} / {defs.length}
          </span>
        </span>
      }
      size="wide"
      className="sticker-book-modal"
      onClose={closeGameOverlay}
    >
      <div className={`scrapbook ${wide ? "spread" : "single"}`}>
        {shown.map((page, pi) => (
          <div key={`${view}-${pi}`} className={`scrap-page ${pi === 0 ? "left" : "right"}`}>
            <div className="scrap-grid">
              {page.map((d) => {
                const on = earned.has(d.id);
                return (
                  <button key={d.id} className={`scrap-sticker ${on ? "on" : "off"} ${wiggle === d.id ? "wiggle" : ""}`} onClick={() => tap(d)} aria-label={on ? d.title : `Not yet: ${d.hint}`}>
                    <span className="scrap-art">{urls[d.id] ? <img src={urls[d.id]} alt="" draggable={false} /> : <span className="scrap-placeholder" />}</span>
                    <span className="scrap-name">{on ? d.title : d.hint}</span>
                  </button>
                );
              })}
            </div>
            <span className="scrap-page-num" aria-hidden>
              {view * perView + pi + 1}
            </span>
          </div>
        ))}
      </div>
      {views > 1 && (
        <div className="scrap-nav">
          <button className="btn paper-btn" onClick={() => turn(-1)} disabled={view === 0} aria-label="Previous page">
            <ArrowLeftIcon />
          </button>
          <span className="scrap-dots" aria-hidden>
            {Array.from({ length: views }, (_, i) => (
              <span key={i} className={i === view ? "on" : ""} />
            ))}
          </span>
          <button className="btn paper-btn" onClick={() => turn(1)} disabled={view >= views - 1} aria-label="Next page">
            <ArrowRightIcon />
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Small helper for the HUD: how many stickers are earned (for a badge). */
export function useStickerTally(): { earned: number; total: number } {
  const mode = useGame((s) => s.mode) ?? "paper";
  const stickers = useGame((s) => s.world?.stickers);
  return useMemo(() => {
    const all = stickersForMode(mode);
    const have = new Set(stickers ?? []);
    return { earned: all.filter((s) => have.has(s.id)).length, total: all.length };
  }, [mode, stickers]);
}

