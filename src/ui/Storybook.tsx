"use client";
// "My planet" storybook: a cute picture book made from the world — a cover,
// one page per creation (or per gallery picture) and an ending page — with
// paper page turns and a print / save-as-PDF view.

import { useEffect, useMemo, useState } from "react";
import { Vector3 } from "three";
import { Modal } from "./Modal";
import { ArrowLeftIcon, ArrowRightIcon } from "./Icons";
import { StorybookIcon } from "./GameIcons";
import { useGame } from "@/state/store";
import { getArtworkUrls } from "@/persistence";
import { getKind } from "@/core/kinds";
import type { CreationRecord, EaselRecord, WorldSave } from "@/core/types";
import { closeGameOverlay, safeSfx } from "@/game/state";
import { reportEvent, speakLine } from "@/game/guide";
import { creationSentence, storybookTitle } from "@/game/story";
import { stickerCount, stickersForMode } from "@/game/stickers";
import { stickerUrl } from "@/art/stickers";
import { shellyUrl } from "@/art/guide";

type Page =
  | { type: "cover"; title: string; image: string | null; subtitle: string }
  | { type: "creation"; rec: CreationRecord; image: string | null; place: string; sentence: string }
  | { type: "easel"; rec: EaselRecord; image: string | null }
  | { type: "empty"; text: string }
  | { type: "end"; stickers: string[]; earned: number; total: number; date: string };

async function imageFor(artworkId: string | null | undefined, which: "cutoutUrl" | "originalUrl"): Promise<string | null> {
  if (!artworkId) return null;
  try {
    const urls = await getArtworkUrls(artworkId);
    return urls?.[which] ?? null;
  } catch {
    return null;
  }
}

async function buildPages(world: WorldSave, playerName: string, regionName: (n: Vector3) => string): Promise<Page[]> {
  const pages: Page[] = [];
  const cover = (await imageFor(world.playerArtworkId, "cutoutUrl")) ?? shellyUrl(256);
  pages.push({
    type: "cover",
    title: storybookTitle(playerName),
    image: cover,
    subtitle: world.mode === "gallery" ? "A picture book of my gallery" : "A picture book of my planet",
  });
  if (world.mode === "paper") {
    const recs = [...world.creations].sort((a, b) => a.createdAt - b.createdAt);
    for (const rec of recs) {
      const place = regionName(new Vector3(...rec.position));
      pages.push({ type: "creation", rec, image: await imageFor(rec.artworkId, "cutoutUrl"), place, sentence: creationSentence(rec, place) });
    }
  } else {
    const recs = [...world.easels].sort((a, b) => a.createdAt - b.createdAt);
    for (const rec of recs) pages.push({ type: "easel", rec, image: await imageFor(rec.artworkId, "originalUrl") });
  }
  if (pages.length === 1) pages.push({ type: "empty", text: world.mode === "gallery" ? "Hang a picture to fill this page!" : "Draw something to fill this page!" });
  const tally = stickerCount(world);
  const have = new Set(world.stickers ?? []);
  const shown = stickersForMode(world.mode)
    .filter((s) => have.has(s.id))
    .slice(-6)
    .map((s) => stickerUrl(s, 160));
  pages.push({
    type: "end",
    stickers: shown,
    earned: tally.earned,
    total: tally.total,
    date: new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
  });
  return pages;
}

function PageView({ page, index }: { page: Page; index: number }) {
  switch (page.type) {
    case "cover":
      return (
        <div className="story-page cover">
          <div className="story-cover-title">{page.title}</div>
          {page.image && <img className="story-cover-art" src={page.image} alt="" draggable={false} />}
          <div className="story-cover-sub">{page.subtitle}</div>
        </div>
      );
    case "creation": {
      const k = getKind(page.rec.kind);
      return (
        <div className="story-page">
          <div className="story-art">{page.image ? <img src={page.image} alt={page.rec.name} draggable={false} /> : <span className="story-emoji">{k.emoji}</span>}</div>
          <h3 className="story-name">{page.rec.name}</h3>
          <div className="story-kind">
            {k.emoji} {k.label} · {page.place}
          </div>
          <p className="story-text">{page.sentence}</p>
          <span className="story-num">{index}</span>
        </div>
      );
    }
    case "easel":
      return (
        <div className="story-page">
          <div className="story-art framed">{page.image ? <img src={page.image} alt={page.rec.title || "Picture"} draggable={false} /> : <span className="story-emoji">🖼️</span>}</div>
          <h3 className="story-name">{page.rec.title || "Untitled"}</h3>
          {page.rec.artist && <div className="story-kind">by {page.rec.artist}</div>}
          {page.rec.story && <p className="story-text">{page.rec.story}</p>}
          {page.rec.notes.length > 0 && (
            <div className="story-notes">
              {page.rec.notes.slice(0, 4).map((n) => (
                <span key={n.id} className="story-note" style={{ background: n.color }}>
                  {n.text}
                </span>
              ))}
            </div>
          )}
          <span className="story-num">{index}</span>
        </div>
      );
    case "empty":
      return (
        <div className="story-page">
          <div className="story-art">
            <span className="story-emoji">🖍️</span>
          </div>
          <p className="story-text">{page.text}</p>
        </div>
      );
    case "end":
      return (
        <div className="story-page end">
          <div className="story-cover-title">The End</div>
          <div className="story-end-stickers">
            {page.stickers.map((u, i) => (
              <img key={i} src={u} alt="" draggable={false} />
            ))}
          </div>
          <p className="story-text">
            {page.earned} of {page.total} stickers collected!
          </p>
          <div className="story-kind">{page.date}</div>
        </div>
      );
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function printHtml(pages: Page[]): string {
  const body = pages
    .map((p) => {
      switch (p.type) {
        case "cover":
          return `<section class="pg cover"><h1>${esc(p.title)}</h1>${p.image ? `<img src="${p.image}">` : ""}<p>${esc(p.subtitle)}</p></section>`;
        case "creation": {
          const k = getKind(p.rec.kind);
          return `<section class="pg">${p.image ? `<img src="${p.image}">` : ""}<h2>${esc(p.rec.name)}</h2><div class="kind">${esc(k.label)} · ${esc(p.place)}</div><p>${esc(p.sentence)}</p></section>`;
        }
        case "easel":
          return `<section class="pg">${p.image ? `<img class="framed" src="${p.image}">` : ""}<h2>${esc(p.rec.title || "Untitled")}</h2>${p.rec.artist ? `<div class="kind">by ${esc(p.rec.artist)}</div>` : ""}${p.rec.story ? `<p>${esc(p.rec.story)}</p>` : ""}${p.rec.notes.length ? `<div class="notes">${p.rec.notes.slice(0, 6).map((n) => `<span style="background:${esc(n.color)}">${esc(n.text)}</span>`).join("")}</div>` : ""}</section>`;
        case "empty":
          return `<section class="pg"><p>${esc(p.text)}</p></section>`;
        case "end":
          return `<section class="pg cover"><h1>The End</h1><div class="stk">${p.stickers.map((u) => `<img src="${u}">`).join("")}</div><p>${p.earned} of ${p.total} stickers collected!</p><div class="kind">${esc(p.date)}</div></section>`;
      }
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>My Wonderglobe storybook</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Fredoka", "Nunito", "Trebuchet MS", system-ui, sans-serif; color: #2b2320; background: #fff; }
    .pg { height: 180mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; break-after: page; border: 3px dashed #d9c9a8; border-radius: 18px; padding: 10mm; background: #fffaf0; }
    .pg:last-child { page-break-after: auto; break-after: auto; }
    .pg img { max-width: 70%; max-height: 105mm; object-fit: contain; }
    .pg img.framed { border: 10px solid #e6b85c; border-radius: 6px; background: #fff; }
    h1 { font-size: 34pt; margin: 0 0 8mm; }
    h2 { font-size: 26pt; margin: 6mm 0 2mm; }
    p { font-size: 18pt; max-width: 80%; margin: 4mm auto 0; }
    .kind { font-size: 14pt; color: #5b4a42; }
    .notes span { display: inline-block; margin: 3mm; padding: 3mm 4mm; font-size: 12pt; border: 2px solid #2b2320; border-radius: 4px; }
    .stk img { width: 30mm; height: 30mm; margin: 2mm; }
  </style></head><body>${body}</body></html>`;
}

function printPages(pages: Page[]) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  iframe.onload = async () => {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return cleanup();
    // Wait for every picture before opening the print dialog.
    await Promise.all(
      [...doc.images].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    );
    win.addEventListener("afterprint", cleanup);
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 120_000);
  };
  iframe.srcdoc = printHtml(pages);
}

export function Storybook() {
  const world = useGame((s) => s.world);
  const playerName = useGame((s) => s.prefs.playerName);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [index, setIndex] = useState(0);
  const [turning, setTurning] = useState<{ from: number; dir: 1 | -1; key: number } | null>(null);

  // Build once per opening (the world doesn't change while the book is open).
  const snapshot = useMemo(() => world, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    const rt = useGame.getState().runtime;
    void buildPages(snapshot, playerName, (n) => (rt ? rt.regionNameAt(n.normalize()) : "the planet")).then((p) => {
      if (alive) setPages(p);
    });
    reportEvent("storybook");
    return () => {
      alive = false;
    };
  }, [snapshot, playerName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const go = (d: 1 | -1) => {
    if (!pages) return;
    const next = index + d;
    if (next < 0 || next >= pages.length) return;
    safeSfx("page");
    setTurning({ from: index, dir: d, key: Date.now() });
    setIndex(next);
  };

  const page = pages?.[index];
  const readAloud = () => {
    if (!page) return;
    if (page.type === "cover") speakLine(page.title);
    else if (page.type === "creation") speakLine(page.sentence);
    else if (page.type === "easel") speakLine([page.rec.title, page.rec.story].filter(Boolean).join(". "));
    else if (page.type === "end") speakLine(`The end! ${page.earned} stickers collected!`);
    else speakLine(page.text);
  };

  return (
    <Modal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <StorybookIcon width={34} height={34} /> My Storybook
        </span>
      }
      size="wide"
      className="storybook-modal"
      onClose={closeGameOverlay}
      footer={
        <>
          <button className="btn paper-btn" onClick={() => pages && printPages(pages)} disabled={!pages}>
            🖨️ Print or save as PDF
          </button>
          <span className="spacer" />
          <button className="btn paper-btn" onClick={readAloud} disabled={!page} aria-label="Read this page aloud">
            🔊 Read
          </button>
        </>
      }
    >
      <div className="story-book">
        <button className="btn paper-btn story-arrow" onClick={() => go(-1)} disabled={!pages || index === 0} aria-label="Previous page">
          <ArrowLeftIcon />
        </button>
        <div className="story-stage">
          {!pages && (
            <div className="story-page loading">
              <span className="spinner-small" /> Making your book…
            </div>
          )}
          {pages && page && <PageView key={`p${index}`} page={page} index={index} />}
          {pages && turning && pages[turning.from] && (
            <div key={turning.key} className={`story-flip ${turning.dir > 0 ? "next" : "prev"}`} onAnimationEnd={() => setTurning(null)} aria-hidden>
              <PageView page={pages[turning.from]} index={turning.from} />
            </div>
          )}
        </div>
        <button className="btn paper-btn story-arrow" onClick={() => go(1)} disabled={!pages || index >= pages.length - 1} aria-label="Next page">
          <ArrowRightIcon />
        </button>
      </div>
      {pages && (
        <div className="story-count" aria-live="polite">
          {index + 1} / {pages.length}
        </div>
      )}
    </Modal>
  );
}
