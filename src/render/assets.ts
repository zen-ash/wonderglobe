// Lazily built, cached GPU textures for procedural art. Built once per page.

import * as THREE from "three";
import { buildSceneryAtlas, type SceneryAtlas } from "@/art/sceneryAtlas";
import { drawPlayerCutout } from "@/art/characters";
import { drawSunTexture, drawCloudTexture, drawSkyGradient } from "@/art/sky";
import { drawGroundGrain, drawStarParticle, drawCardboardTexture, drawNoteTexture } from "@/art/textures";
import { drawMoonTexture, drawPaperStar, drawRainbowTexture, drawParticleAtlas, drawRippleRing } from "@/art/weatherArt";

export interface Assets {
  atlas: SceneryAtlas;
  atlasTexture: THREE.Texture;
  player: [THREE.Texture, THREE.Texture];
  playerAspect: number;
  sun: THREE.Texture;
  clouds: THREE.Texture[];
  sky: THREE.Texture;
  grain: THREE.Texture;
  star: THREE.Texture;
  cardboard: THREE.Texture;
  shadow: THREE.Texture;
  notes: Map<string, THREE.Texture>;
  /** Atmosphere art (moon, paper star, rainbow band, particle atlas, ripple ring). */
  moon: THREE.Texture;
  paperStar: THREE.Texture;
  rainbow: THREE.Texture;
  particles: THREE.Texture;
  ripple: THREE.Texture;
}

let cached: Assets | null = null;

function tex(canvas: HTMLCanvasElement, opts: { mipmaps?: boolean } = {}): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.mipmaps === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  t.needsUpdate = true;
  return t;
}

/** Soft round contact shadow (warm brown, feathered edge) for object bases. */
function drawShadow(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 63);
  g.addColorStop(0, "rgba(46,34,40,0.40)");
  g.addColorStop(0.35, "rgba(46,34,40,0.30)");
  g.addColorStop(0.7, "rgba(46,34,40,0.12)");
  g.addColorStop(1, "rgba(46,34,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 63, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function getAssets(): Assets {
  if (cached) return cached;
  const atlas = buildSceneryAtlas();
  const atlasTexture = tex(atlas.canvas);
  const p0 = drawPlayerCutout(0);
  const p1 = drawPlayerCutout(1);
  const grain = tex(drawGroundGrain());
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  const cardboard = tex(drawCardboardTexture());
  cardboard.wrapS = cardboard.wrapT = THREE.RepeatWrapping;
  cached = {
    atlas,
    atlasTexture,
    player: [tex(p0), tex(p1)],
    playerAspect: p0.width / p0.height,
    sun: tex(drawSunTexture()),
    clouds: [0, 1, 2].map((v) => tex(drawCloudTexture(v))),
    sky: tex(drawSkyGradient(512, 512), { mipmaps: false }),
    grain,
    star: tex(drawStarParticle()),
    cardboard,
    shadow: tex(drawShadow()),
    notes: new Map(),
    moon: tex(drawMoonTexture()),
    paperStar: tex(drawPaperStar()),
    rainbow: tex(drawRainbowTexture()),
    particles: tex(drawParticleAtlas()),
    ripple: tex(drawRippleRing()),
  };
  cached.rainbow.wrapS = THREE.RepeatWrapping;
  return cached;
}

export function noteTexture(color: string): THREE.Texture {
  const a = getAssets();
  let t = a.notes.get(color);
  if (!t) {
    t = tex(drawNoteTexture(color));
    a.notes.set(color, t);
  }
  return t;
}

// ----------------------------------------------------- artwork textures (per id)

const artworkTextures = new Map<string, { texture: THREE.Texture; refs: number }>();

/** Load a texture from an object URL, shared by id with reference counting. */
export function acquireArtworkTexture(key: string, url: string): THREE.Texture {
  const hit = artworkTextures.get(key);
  if (hit) {
    hit.refs++;
    return hit.texture;
  }
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    texture.image = img;
    texture.needsUpdate = true;
  };
  img.src = url;
  artworkTextures.set(key, { texture, refs: 1 });
  return texture;
}

export function releaseArtworkTexture(key: string): void {
  const hit = artworkTextures.get(key);
  if (!hit) return;
  hit.refs--;
  if (hit.refs <= 0) {
    hit.texture.dispose();
    artworkTextures.delete(key);
  }
}
