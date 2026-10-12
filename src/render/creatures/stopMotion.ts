// Stop-motion papercraft timing and poses. Pure functions (no React, no GPU)
// so they can be unit-tested.
//
// Poses change "on twos": the animation inputs (gait phase, hop height, flap,
// sway time, flip progress) are sampled about 12 times a second and held in
// between, while the travel along the ground stays smooth. In calm (reduced)
// motion the poses update continuously instead, with smaller amplitudes.

import type { Behavior, Facing } from "@/core/types";

/** Pose changes per second (24 fps film, shot on twos). */
export const POSE_FPS = 12;

/** Animation time quantised to stop-motion frames. */
export function stepTime(t: number, continuous = false): number {
  return continuous ? t : Math.floor(t * POSE_FPS) / POSE_FPS;
}

/** Index of the stop-motion frame at time t. */
export function poseFrame(t: number): number {
  return Math.floor(t * POSE_FPS);
}

/**
 * Tells an animated thing when to sample a new pose. Every puppet shares the
 * same global frame grid, like a real stop-motion set.
 */
export class PoseClock {
  frame = -1;
  /** True when a new pose should be taken (always, in continuous/calm mode). */
  advance(t: number, continuous = false): boolean {
    if (continuous) {
      this.frame = -1;
      return true;
    }
    const k = poseFrame(t);
    if (k === this.frame) return false;
    this.frame = k;
    return true;
  }
}

// ------------------------------------------------------------------ gaits

/**
 * How a paper puppet walks:
 *  waddle – side view, rocks from foot to foot with little hops;
 *  front  – people seen from the front, rocking side to side;
 *  lope   – four-legged animals, a gentle rocking-horse canter;
 *  inch   – snails stretch and squeeze along;
 *  hop    – the simulation already hops (rabbits, frogs): stretch / squash;
 *  drive  – vehicles bump along;
 *  none   – not a walker.
 */
export type Gait = "waddle" | "front" | "lope" | "inch" | "hop" | "drive" | "none";

const QUADRUPEDS = new Set(["cat", "dog", "horse", "cow", "pig", "sheep", "bear", "lion", "elephant", "giraffe", "turtle", "mouse", "fox", "unicorn"]);
const PEOPLE = new Set(["person", "family", "robot", "monster"]);

export function gaitFor(kind: string, behavior: Behavior, facing: Facing): Gait {
  if (behavior === "hop") return "hop";
  if (behavior === "drive") return "drive";
  if (behavior !== "walk") return "none";
  if (kind === "snail") return "inch";
  if (QUADRUPEDS.has(kind)) return "lope";
  if (PEOPLE.has(kind) || facing === "none") return "front";
  return "waddle";
}

/** Gait angle speed (radians per unit of agent phase, which advances 1/s). */
export function gaitRate(gait: Gait): number {
  switch (gait) {
    case "lope":
      return 5.5;
    case "inch":
      return 3;
    case "drive":
      return 20;
    default:
      return 8;
  }
}

export interface PuppetPose {
  /** Extra lift above the ground (world units). */
  lift: number;
  /** Rotation in the card plane (radians, + = counter-clockwise on screen). */
  roll: number;
  scaleX: number;
  scaleY: number;
  /** Paper curl (shader uBend). */
  bend: number;
}

export function restPose(out: PuppetPose): PuppetPose {
  out.lift = 0;
  out.roll = 0;
  out.scaleX = 1;
  out.scaleY = 1;
  out.bend = 0;
  return out;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Walking pose for a paper puppet.
 * @param s     gait angle (radians); one |sin| hump is one step
 * @param move  0..1 how much it is walking
 * @param height card height (world units), scales the hop
 * @param amp   1 normally, smaller for calm motion
 * @param nose  +1 if the drawing's nose points right on screen, -1 left
 */
export function walkPose(gait: Gait, s: number, move: number, height: number, amp: number, nose: number, out: PuppetPose): PuppetPose {
  restPose(out);
  if (move < 0.01 || gait === "none" || gait === "hop") return out;
  const k = move * amp;
  const H = (0.05 + 0.045 * Math.min(2.2, Math.max(0.5, height))) * k;
  const hump = Math.abs(Math.sin(s));
  switch (gait) {
    case "waddle":
    case "front": {
      const front = gait === "front";
      out.lift = hump * H * (front ? 0.75 : 1);
      // Rock toward the stepping foot.
      out.roll = Math.sin(s) * (front ? 0.13 : 0.085) * k;
      // Squash on each landing (the frames around foot contact).
      const squash = (1 - smooth(0, 0.4, hump)) * 0.1 * k;
      out.scaleY = 1 - squash;
      out.scaleX = 1 + squash * 0.6;
      out.bend = (front ? 0.04 : 0.1) * Math.cos(s) * k;
      break;
    }
    case "lope": {
      // Rocking-horse canter: rise nose-up, land nose-down, squash on the ground.
      const air = Math.max(0, Math.sin(s));
      out.lift = air * H * 1.15;
      out.roll = Math.cos(s) * 0.085 * k * nose;
      const squash = Math.max(0, -Math.sin(s)) * 0.07 * k;
      out.scaleY = 1 - squash + air * 0.03 * k;
      out.scaleX = 1 + squash * 0.5;
      out.bend = -Math.cos(s) * 0.07 * k;
      break;
    }
    case "inch": {
      const st = Math.sin(s);
      out.scaleX = 1 + st * 0.07 * k;
      out.scaleY = 1 - st * 0.05 * k;
      out.roll = Math.max(0, st) * 0.03 * k * nose;
      break;
    }
    case "drive": {
      // Little bumps in the road.
      out.lift = Math.pow(Math.max(0, Math.sin(s * 0.37)), 6) * 0.06 * k;
      out.roll = Math.sin(s * 0.5) * 0.025 * k;
      out.scaleY = 1 - Math.pow(Math.max(0, -Math.sin(s * 0.37)), 8) * 0.04 * k;
      break;
    }
  }
  return out;
}

/**
 * Hop pose from the (held) height above the ground: stretched and tipped
 * nose-up while rising, nose-down while falling.
 */
export function hopPose(above: number, prevAbove: number, amp: number, nose: number, out: PuppetPose): PuppetPose {
  restPose(out);
  if (above > 0.04) {
    const rising = above >= prevAbove;
    out.scaleY = 1 + 0.09 * amp;
    out.scaleX = 1 - 0.05 * amp;
    out.roll = (rising ? 0.14 : -0.1) * amp * nose;
    out.bend = (rising ? -0.08 : 0.06) * amp;
  }
  return out;
}

/** Tracks touch-downs and holds a squash pose for a couple of stop-motion frames. */
export class LandingSquash {
  private prev = 0;
  private frames = 0;
  /** Call once per pose frame with the held height above the ground. */
  sample(above: number): void {
    if (this.frames > 0) this.frames--;
    if (above < 0.03 && this.prev > 0.07) this.frames = 2;
    this.prev = above;
  }
  /** 0..1 strength of the landing squash. */
  get amount(): number {
    return this.frames === 2 ? 1 : this.frames === 1 ? 0.5 : 0;
  }
}

// ------------------------------------------------------------- paper flip

/**
 * Turning around: the card spins about its up axis, passes edge-on, and comes
 * back showing the drawing mirrored (as if the other side were printed too).
 * `yaw` and `mirror` are the pose to show; `progress` 1 means at rest.
 */
export class PaperFlip {
  mirror: number;
  yaw = 0;
  progress = 1;
  private from: number;
  private to: number;

  constructor(initial = 1) {
    this.mirror = this.from = this.to = initial >= 0 ? 1 : -1;
  }

  get target(): number {
    return this.to;
  }

  /** Advance toward `want` (+1 / -1). `duration` is the whole turn in seconds. */
  update(want: number, dt: number, duration = 0.34): void {
    const w = want >= 0 ? 1 : -1;
    if (w !== this.to) {
      if (this.progress >= 1) {
        this.from = this.to;
        this.to = w;
        this.progress = 0;
      } else {
        // Changed its mind halfway: turn back the way it came.
        const f = this.from;
        this.from = this.to;
        this.to = f;
        this.progress = 1 - this.progress;
      }
    }
    if (this.progress < 1) this.progress = Math.min(1, this.progress + dt / Math.max(0.01, duration));
    this.pose(this.progress);
  }

  /** Pose at a given turn progress (0..1). */
  pose(u: number): void {
    const dir = this.to;
    if (u >= 1) {
      this.mirror = this.to;
      this.yaw = 0;
    } else if (u < 0.5) {
      this.mirror = this.from;
      this.yaw = u * Math.PI * dir;
    } else {
      this.mirror = this.to;
      this.yaw = (u - 1) * Math.PI * dir;
    }
  }

  /** Jump straight to a side (no animation). */
  snap(side: number): void {
    this.mirror = this.from = this.to = side >= 0 ? 1 : -1;
    this.progress = 1;
    this.yaw = 0;
  }
}

/** A held copy of a flip's pose (sampled on pose frames). */
export interface HeldFlip {
  yaw: number;
  mirror: number;
}
