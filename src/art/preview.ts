// Debug preview of every procedural art asset. Not wired into any route;
// call renderArtPreview(container) from a scratch page to eyeball the art.

import { drawPlayerCutout, drawVisitorCutout } from "./characters";
import { buildSceneryAtlas, type AtlasEntry, type SceneryArtId } from "./sceneryAtlas";
import { SAMPLE_DRAWINGS, renderSample, renderSampleArtwork } from "./samples";
import { drawCloudTexture, drawSkyGradient, drawSunTexture } from "./sky";
import { drawCardboardTexture, drawGroundGrain, drawNoteTexture, drawPaperTexture, drawStarParticle } from "./textures";

function section(container: HTMLElement, title: string): HTMLElement {
  const h = document.createElement("h2");
  h.textContent = title;
  h.style.cssText = "font:600 18px system-ui;margin:24px 0 8px;color:#2b2320";
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end";
  container.append(h, wrap);
  return wrap;
}

function tile(parent: HTMLElement, label: string, canvas: HTMLCanvasElement, displayW?: number, bg = "#f3ead6"): void {
  const fig = document.createElement("figure");
  fig.style.cssText = `margin:0;padding:6px;background:${bg};border-radius:8px;text-align:center`;
  if (displayW) {
    canvas.style.width = `${displayW}px`;
    canvas.style.height = "auto";
  }
  canvas.style.display = "block";
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  cap.style.cssText = "font:12px system-ui;color:#5a4a40;margin-top:4px";
  fig.append(canvas, cap);
  parent.append(fig);
}

export function renderArtPreview(container: HTMLElement): void {
  container.style.background = "#efe5cf";
  container.style.padding = "16px";

  const t0 = performance.now();
  const atlas = buildSceneryAtlas();
  const ms = performance.now() - t0;

  const top = section(container, `Scenery atlas (${atlas.canvas.width}x${atlas.canvas.height}, built in ${ms.toFixed(0)} ms)`);
  tile(top, "atlas", atlas.canvas, Math.min(1400, atlas.canvas.width / 1.5), "repeating-conic-gradient(#e9dfc9 0 25%, #f6efe0 0 50%) 0 0/24px 24px");

  // Re-cut every entry (and every children's variant) from the atlas using its UVs to verify the mapping.
  const items = section(container, `Atlas entries with variants (cropped by UV, red line = anchorY) - ${atlas.ids.length} ids`);
  const W = atlas.canvas.width;
  const H = atlas.canvas.height;
  const crop = (e: AtlasEntry, dh: number, line: boolean): HTMLCanvasElement => {
    const sx = e.u0 * W;
    const sw = (e.u1 - e.u0) * W;
    const sy = (1 - e.v1) * H;
    const sh = (e.v1 - e.v0) * H;
    const dw = Math.max(1, Math.round(dh * e.aspect));
    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh + (line ? 4 : 0);
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(atlas.canvas, sx, sy, sw, sh, 0, 0, dw, dh);
    if (line) {
      ctx.strokeStyle = "rgba(220,40,40,0.7)";
      ctx.beginPath();
      const gy = dh * (1 - e.anchorY);
      ctx.moveTo(0, gy);
      ctx.lineTo(dw, gy);
      ctx.stroke();
    }
    return c;
  };
  for (const id of atlas.ids) {
    const e = atlas.entries[id as SceneryArtId];
    const vs = e.variants ?? [e];
    vs.forEach((v, i) => tile(items, vs.length > 1 ? `${id} #${i}` : id, crop(v, 110, true)));
  }

  // How the art reads at small on-screen sizes (a flower is ~40 px tall on a 1080p screen).
  const small = section(container, "Small sizes (40 px tall, on grass)");
  small.style.background = "#9fd27c";
  small.style.padding = "8px";
  small.style.gap = "6px";
  for (const id of atlas.ids) for (const v of atlas.entries[id as SceneryArtId].variants ?? []) small.append(crop(v, 40, false));

  const chars = section(container, "Characters");
  tile(chars, "player frame 0", drawPlayerCutout(0), 160);
  tile(chars, "player frame 1", drawPlayerCutout(1), 160);
  for (let i = 0; i < 4; i++) tile(chars, `visitor ${i}`, drawVisitorCutout(i), 120);

  const sky = section(container, "Sky");
  tile(sky, "sky gradient", drawSkyGradient(512, 256), 360);
  tile(sky, "sun", drawSunTexture(), 160);
  for (let i = 0; i < 3; i++) tile(sky, `cloud ${i}`, drawCloudTexture(i), 180, "#9fd8d2");

  const tex = section(container, "Textures");
  tile(tex, "ground grain", drawGroundGrain(), 160);
  const tiled = document.createElement("canvas");
  tiled.width = 512;
  tiled.height = 256;
  const tctx = tiled.getContext("2d");
  if (tctx) {
    const pat = tctx.createPattern(drawGroundGrain(128), "repeat");
    if (pat) {
      tctx.fillStyle = "#7cc35b";
      tctx.fillRect(0, 0, 512, 256);
      tctx.globalCompositeOperation = "multiply";
      tctx.fillStyle = pat;
      tctx.fillRect(0, 0, 512, 256);
    }
  }
  tile(tex, "grain x green (tiled)", tiled, 320);
  tile(tex, "cardboard", drawCardboardTexture(), 160);
  tile(tex, "paper", drawPaperTexture(), 160);
  tile(tex, "star", drawStarParticle(), 80);
  for (const col of ["#ffe066", "#ff9fb2", "#9be7a4", "#9fd3ff", "#ffbf6b"]) tile(tex, `note ${col}`, drawNoteTexture(col), 80);

  const samples = section(container, "Sample drawings (transparent)");
  for (const s of SAMPLE_DRAWINGS) tile(samples, `${s.label} -> ${s.suggestedKind}`, renderSample(s.id), 150, "#ffffff");
  const art = section(container, "Sample artwork (easel pictures)");
  for (const s of SAMPLE_DRAWINGS) tile(art, s.label, renderSampleArtwork(s.id), 150);
}
