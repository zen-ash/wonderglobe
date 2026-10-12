// A flying ride must pass close enough to the summit star to collect it.
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { WorldRuntime } from "@/world/runtime";
import { REGIONS, REGION_BY_ID } from "@/world/planet";
import { toVec3 } from "@/world/sphere";
import { placeTreasures, canCollect } from "@/game/collectibles";
import type { WorldSave } from "@/core/types";

function worldWithBird(seed: number, start: Vector3): WorldSave {
  return {
    version: 1,
    mode: "paper",
    seed,
    createdAt: 0,
    updatedAt: 0,
    player: { position: toVec3(start), heading: [1, 0, 0] },
    creations: [
      {
        id: "bird1",
        artworkId: "a",
        kind: "bird",
        name: "Sky",
        behavior: "fly",
        facing: "right",
        classifiedBy: "player",
        position: toVec3(start),
        heading: [0, 1, 0],
        createdAt: 0,
        chat: [],
      },
    ],
    easels: [],
    visited: [],
  };
}

describe("riding to the summit star", () => {
  for (const regionId of ["garden", "picnic", "forest", "coast"] as const) {
    it(`a ride from ${regionId} reaches the star`, () => {
      const rt = new WorldRuntime(worldWithBird(4242, REGION_BY_ID[regionId].center.clone()));
      const star = placeTreasures(rt.terrain, 4242, "paper", rt.layout).find((t) => t.id === "summit-star");
      expect(star).toBeTruthy();
      expect(rt.startRide("bird1")).toBe(true);
      let reached = false;
      for (let i = 0; i < 2400 && rt.riding; i++) {
        rt.step(1 / 30);
        if (canCollect(star!, rt.player.pos, rt.player.n)) reached = true;
      }
      expect(reached).toBe(true);
      expect(rt.riding).toBeNull();
      expect(REGIONS.length).toBe(12);
    });
  }
});
