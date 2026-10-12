// Stop-motion papercraft timing and poses (pure helpers used by the renderers).

import { describe, expect, it } from "vitest";
import { POSE_FPS, PoseClock, PaperFlip, LandingSquash, gaitFor, walkPose, hopPose, restPose, stepTime, type PuppetPose } from "@/render/creatures/stopMotion";

const pose = (): PuppetPose => restPose({} as PuppetPose);

describe("stop-motion timing", () => {
  it("samples poses on twos (~12 per second) at any frame rate", () => {
    for (const fps of [30, 60, 144]) {
      const clock = new PoseClock();
      let poses = 0;
      for (let f = 0; f < fps * 2; f++) if (clock.advance(f / fps)) poses++;
      expect(poses).toBeGreaterThanOrEqual(POSE_FPS * 2 - 1);
      expect(poses).toBeLessThanOrEqual(POSE_FPS * 2 + 1);
    }
  });

  it("updates every frame in calm (reduced) motion", () => {
    const clock = new PoseClock();
    let poses = 0;
    for (let f = 0; f < 60; f++) if (clock.advance(f / 60, true)) poses++;
    expect(poses).toBe(60);
  });

  it("quantises animation time to stop-motion frames", () => {
    expect(stepTime(0.49)).toBeCloseTo(5 / POSE_FPS);
    expect(stepTime(0.49, true)).toBe(0.49);
  });
});

describe("paper flip", () => {
  it("turns edge-on and comes back mirrored instead of flipping instantly", () => {
    const flip = new PaperFlip(1);
    const yaws: number[] = [];
    const mirrors: number[] = [];
    for (let i = 0; i < 40; i++) {
      flip.update(-1, 1 / 60, 0.34);
      yaws.push(flip.yaw);
      mirrors.push(flip.mirror);
    }
    // Passes (nearly) edge-on on the way.
    expect(Math.max(...yaws.map(Math.abs))).toBeGreaterThan(1.4);
    // Mirror changes exactly once, around the edge-on moment.
    const switchAt = mirrors.findIndex((m) => m === -1);
    expect(switchAt).toBeGreaterThan(3);
    expect(Math.abs(yaws[switchAt])).toBeGreaterThan(1.2);
    expect(mirrors.slice(switchAt).every((m) => m === -1)).toBe(true);
    // Ends at rest, facing the other way.
    expect(flip.yaw).toBe(0);
    expect(flip.mirror).toBe(-1);
  });

  it("can change its mind halfway without jumping", () => {
    const flip = new PaperFlip(1);
    for (let i = 0; i < 6; i++) flip.update(-1, 1 / 60, 0.34);
    const before = flip.yaw;
    flip.update(1, 0, 0.34);
    expect(flip.yaw).toBeCloseTo(before, 5);
    for (let i = 0; i < 60; i++) flip.update(1, 1 / 60, 0.34);
    expect(flip.mirror).toBe(1);
    expect(flip.yaw).toBe(0);
  });
});

describe("puppet gaits", () => {
  it("classifies walkers", () => {
    expect(gaitFor("dog", "walk", "right")).toBe("lope");
    expect(gaitFor("person", "walk", "none")).toBe("front");
    expect(gaitFor("chicken", "walk", "left")).toBe("waddle");
    expect(gaitFor("snail", "walk", "left")).toBe("inch");
    expect(gaitFor("rabbit", "hop", "left")).toBe("hop");
    expect(gaitFor("car", "drive", "right")).toBe("drive");
    expect(gaitFor("fish", "swim", "right")).toBe("none");
  });

  it("rocks, hops and squashes on landing; calm motion is smaller", () => {
    let maxLift = 0, maxRoll = 0, minScaleY = 1;
    for (let s = 0; s < Math.PI * 2; s += 0.05) {
      const p = walkPose("waddle", s, 1, 1.2, 1, 1, pose());
      expect(p.lift).toBeGreaterThanOrEqual(0);
      maxLift = Math.max(maxLift, p.lift);
      maxRoll = Math.max(maxRoll, Math.abs(p.roll));
      minScaleY = Math.min(minScaleY, p.scaleY);
    }
    expect(maxLift).toBeGreaterThan(0.05);
    expect(maxRoll).toBeGreaterThan(0.05);
    expect(minScaleY).toBeLessThan(0.95);
    // Squash happens at foot contact (no lift), not mid-hop.
    const contact = walkPose("waddle", 0, 1, 1.2, 1, 1, pose());
    expect(contact.scaleY).toBeLessThan(0.95);
    const calm = walkPose("waddle", Math.PI / 2, 1, 1.2, 0.35, 1, pose());
    const full = walkPose("waddle", Math.PI / 2, 1, 1.2, 1, 1, pose());
    expect(calm.lift).toBeLessThan(full.lift * 0.5);
    // Standing still: rest pose.
    expect(walkPose("lope", 1, 0, 1.2, 1, 1, pose())).toEqual(restPose(pose()));
  });

  it("leans a lope into the direction the drawing faces", () => {
    const right = walkPose("lope", 0.3, 1, 1.5, 1, 1, pose());
    const left = walkPose("lope", 0.3, 1, 1.5, 1, -1, pose());
    expect(right.roll).toBeCloseTo(-left.roll);
  });

  it("stretches hops in the air and holds a squash on touch-down", () => {
    const air = hopPose(0.3, 0.2, 1, 1, pose());
    expect(air.scaleY).toBeGreaterThan(1);
    const squash = new LandingSquash();
    squash.sample(0.3);
    squash.sample(0.0);
    expect(squash.amount).toBe(1);
    squash.sample(0.0);
    expect(squash.amount).toBe(0.5);
    squash.sample(0.0);
    expect(squash.amount).toBe(0);
  });
});
