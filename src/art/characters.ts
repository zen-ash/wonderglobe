// Paper-doll people drawn the way a child draws people: a big round head
// with a smile, scribbled hair, a dress triangle or a shirt rectangle, stick
// arms with round hands and thick legs with oval shoes. The player is a kid
// with a backpack walking right (two walk frames); visitors face front.
// All cut-outs: dark outline + white paper border on a transparent canvas,
// bottom-anchored (feet on the ground line, ~92% of the height).

import type { Pt } from "./crayon";
import { CK, ChildPen, dk, renderChildArt } from "./childKit";
import { bezierPts } from "./kit";
import { createRng, hashString } from "./rng";

export type HairStyle = "short" | "bob" | "pigtails" | "bun" | "curly" | "spiky";

export interface PersonLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  shoes: string;
  dress?: boolean;
  hat?: string | null;
  backpack?: string | null;
}

const SKINS = ["#f6cfa8", "#eab68a", "#d39a6a", "#b07a4e", "#8a5a3a", "#f3c49b"];
const HAIRS = ["#5a3a24", "#2f2420", "#c8752f", "#e8c25a", "#7a4a2a", "#3b2a40"];
const SHIRTS = [CK.red, CK.blue, CK.teal, CK.purple, CK.orange, CK.pink, CK.yellow, CK.green];
const PANTS = [CK.navy, "#5b5f8f", CK.brown, "#3f7f7a", "#6d4f8f"];
const SHOES = [CK.red, CK.black, CK.blue, "#7a4a2a"];
const STYLES: HairStyle[] = ["short", "bob", "pigtails", "bun", "curly", "spiky"];

export function lookFromSeed(seed: number): PersonLook {
  const r = createRng(seed * 7919 + 13);
  const style = r.pick(STYLES);
  return {
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: style,
    shirt: r.pick(SHIRTS),
    pants: r.pick(PANTS),
    shoes: r.pick(SHOES),
    dress: (style === "pigtails" || style === "bob") && r.chance(0.6),
    hat: r.chance(0.3) ? r.pick([CK.yellow, CK.red, CK.teal, CK.purple]) : null,
    backpack: null,
  };
}

export const PLAYER_LOOK: PersonLook = {
  skin: "#f4c69e",
  hair: "#6b4128",
  hairStyle: "spiky",
  shirt: CK.yellow,
  pants: CK.navy,
  shoes: CK.red,
  backpack: CK.red,
};

export type PersonPose = "front" | "walk0" | "walk1";

function hairBack(p: ChildPen, L: PersonLook, cx: number, cy: number, r: number): void {
  const line = dk(L.hair, 0.5);
  if (L.hairStyle === "bob") p.shape(p.oval(cx, cy + r * 0.25, r * 1.22, r * 1.05, 0.06), L.hair, { line, angle: -1.4 });
  if (L.hairStyle === "pigtails") {
    for (const s of [-1, 1]) {
      p.shape(p.oval(cx + s * r * 1.3, cy + r * 0.25, r * 0.42, r * 0.6, 0.12), L.hair, { line, angle: -1.3, width: 2 });
      p.ball(cx + s * r * 1.08, cy - r * 0.2, r * 0.2, CK.red, 1.6);
    }
  }
  if (L.hairStyle === "bun") p.shape(p.oval(cx, cy - r * 1.05, r * 0.45, r * 0.38, 0.08), L.hair, { line, width: 2 });
  if (L.hairStyle === "curly") p.shape(p.bumpy(cx, cy - r * 0.1, r * 1.3, r * 1.15, 10, 0.3), L.hair, { line, loops: true, width: 2 });
}

function hairFront(p: ChildPen, L: PersonLook, cx: number, cy: number, r: number): void {
  const line = dk(L.hair, 0.5);
  if (L.hairStyle === "curly") return;
  // A cap of scribbled hair over the top of the head with a zig-zag fringe.
  const pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1.0 + i / 10);
    pts.push([cx + Math.cos(a) * r * 1.07, cy + Math.sin(a) * r * 1.07]);
  }
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const x = cx + r * 0.98 - (i / n) * r * 1.96;
    pts.push([x, cy - r * (i % 2 ? 0.25 : 0.5)]);
  }
  p.shape(p.poly(pts, 0.3, 0.6), L.hair, { line, angle: -1.2, width: 2.2 });
  if (L.hairStyle === "spiky") {
    // A crown of pointy spikes sticking up out of the hair.
    const sp: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1.12 + (i / 10) * 0.76);
      const rr = r * (i % 2 ? 1.5 : 0.92);
      sp.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    p.shape(p.hand(sp, true, 0.25, 1.2), L.hair, { line, angle: -1.5, width: 2 });
  }
}

function hat(p: ChildPen, color: string, cx: number, cy: number, r: number): void {
  p.shape(p.oval(cx, cy - r * 0.72, r * 0.95, r * 0.55, 0.06), color, { angle: -0.3 });
  p.shape(p.rect(cx - r * 1.35, cy - r * 0.62, r * 2.7, r * 0.3, 0.4), dk(color, 0.12), { width: 2, w: 2 });
}

/**
 * A person the way a child draws one, standing on the ground line (y = 93).
 * "front": facing the viewer, arms out. "walk0"/"walk1": walking right
 * (stride / passing frame), face turned right.
 */
export function drawChildPerson(p: ChildPen, L: PersonLook, pose: PersonPose = "front"): void {
  const G = p.G;
  const walking = pose !== "front";
  const bob = pose === "walk1" ? -1.5 : 0;
  const hx = 50 + (walking ? 1.5 : 0);
  const hy = 28 + bob;
  const hr = 14;
  // Backpack sits behind the body on the left (the kid walks right).
  if (L.backpack) {
    p.shape(p.rect(26, 45 + bob, 15, 22, 0.8), L.backpack, { angle: -1.3 });
    p.ball(33.5, 56 + bob, 2, CK.yellow, 1.5);
  }
  // Legs & shoes
  const legTop = 72 + bob;
  const feet: Array<[Pt, Pt]> =
    pose === "walk0"
      ? [
          [[46, legTop], [38, G - 3]],
          [[54, legTop], [63, G - 3]],
        ]
      : pose === "walk1"
        ? [
            [[47, legTop], [46, G - 5]],
            [[53, legTop], [54, G - 3]],
          ]
        : [
            [[45, legTop], [43.5, G - 3]],
            [[55, legTop], [56.5, G - 3]],
          ];
  for (const [a, b] of feet) {
    p.tube([a, b], L.skin, 5, CK.black);
    const sx = walking ? b[0] + 2.5 : b[0] + (b[0] < 50 ? -1 : 1);
    p.shape(p.oval(sx, b[1] + 0.5, 5.5, 3.3, 0.1), L.shoes, { width: 1.8, w: 2 });
  }
  // Arms: sticks out to the side with round hands.
  const sh = 47 + bob;
  const hands: Pt[] =
    pose === "front"
      ? [
          [26, 62],
          [74, 62],
        ]
      : pose === "walk0"
        ? [
            [38, 66 + bob],
            [70, 58 + bob],
          ]
        : [
            [43, 67 + bob],
            [60, 67 + bob],
          ];
  p.tube([[42, sh], hands[0]], L.shirt, 4.4, CK.black);
  p.tube([[58, sh], hands[1]], L.shirt, 4.4, CK.black);
  for (const h of hands) p.ball(h[0], h[1], 3.4, L.skin, 1.8);
  // Body
  if (L.dress) {
    p.shape(p.poly([[42, 42 + bob], [58, 42 + bob], [69, 76 + bob], [31, 76 + bob]], 0.8), L.shirt, { angle: -0.9 });
    p.line([[34, 70 + bob], [66, 70 + bob]], dk(L.shirt, 0.35), 2);
  } else {
    p.shape(p.rect(39, 66 + bob, 22, 9, 0.6), L.pants, { angle: -0.2, width: 2.2 });
    p.shape(p.rect(39, 42 + bob, 22, 26, 0.9), L.shirt, { angle: -0.8 });
    for (const y of [50, 57]) p.dot(50, y + bob, 1.1);
  }
  if (L.backpack) p.line([[44, 43 + bob], [45, 66 + bob]], dk(L.backpack, 0.1), 2.6);
  // Head
  hairBack(p, L, hx, hy, hr);
  p.shape(p.oval(hx, hy, hr, hr * 0.96, 0.05), L.skin, { angle: -0.5, width: 2.2, base: 0.45 });
  hairFront(p, L, hx, hy, hr);
  if (L.hat) hat(p, L.hat, hx, hy, hr);
  if (walking) {
    // Looking right: eyes and smile shifted towards the walking direction.
    p.dot(hx + 2, hy + 1, 1.5);
    p.dot(hx + 8, hy + 1.2, 1.5);
    p.stroke(p.hand(bezierPts([hx + 1.5, hy + 6], [hx + 6, hy + 10.5], [hx + 10, hy + 5.5], 6), false, 0.15, 1.5), CK.black, 1.8, { even: true });
    p.dot(hx - 2, hy + 6, 2.2, "#f59a9a");
  } else {
    p.smile(hx, hy + 3, 12, { cheeks: true, w: 1.8 });
  }
}

/** The player: a child-drawn kid with a backpack, walking right. Two walk frames. */
export function drawPlayerCutout(frame: 0 | 1, size = 256): HTMLCanvasElement {
  return renderChildArt(size, size, 9001 + frame, (p) => drawChildPerson(p, PLAYER_LOOK, frame === 0 ? "walk0" : "walk1"));
}

/** A small visitor person (front view) with seeded clothes and hair. */
export function drawVisitorCutout(seed: number, size = 256): HTMLCanvasElement {
  return renderChildArt(size, size, hashString(`visitor-${seed}`), (p) => drawChildPerson(p, lookFromSeed(seed)));
}
