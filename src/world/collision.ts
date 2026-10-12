// Obstacles on the sphere, bucketed in a coarse 3D grid over unit vectors so
// queries only look at nearby cells. Also keeps the walkable corridors of
// drawn bridges (great-circle segments over water with a paper deck).

import { Vector3 } from "three";
import { PLANET_RADIUS } from "./sphere";

export interface Obstacle {
  id: string;
  n: Vector3;
  /** World-unit radius. */
  radius: number;
}

const G = 14; // cells per axis over [-1, 1]

function cellKey(x: number, y: number, z: number): number {
  return (x * G * 2 + y) * G * 2 + z;
}

function cellOf(v: number): number {
  return Math.min(G * 2 - 1, Math.max(0, Math.floor((v + 1) * G)));
}

/**
 * A bridge corridor: a great-circle segment centred on `center`, running along
 * the unit tangent `t`. Points within `halfWidth` (world units) of the segment
 * and within `halfAngle` of the centre (along it) are walkable, at deck height.
 */
export interface BridgeSpan {
  id: string;
  center: Vector3;
  t: Vector3;
  /** Normal of the bridge's great circle (center × t). */
  axis: Vector3;
  /** Half-length along the crossing, radians. */
  halfAngle: number;
  /** Half the corridor width, world units. */
  halfWidth: number;
  /** Deck radius (absolute) at the -t end and the +t end. */
  endA: number;
  endB: number;
  /** Extra height of the arch in the middle (world units). */
  arch: number;
}

/** Signed position of n in a bridge's frame: along (world units from the centre) and lateral offset. */
export function bridgeCoords(b: BridgeSpan, n: Vector3): { along: number; lateral: number } {
  const lateral = Math.asin(Math.max(-1, Math.min(1, n.dot(b.axis)))) * PLANET_RADIUS;
  const along = Math.atan2(n.dot(b.t), n.dot(b.center)) * PLANET_RADIUS;
  return { along, lateral };
}

/** Deck radius (absolute) at a signed distance along the bridge. */
export function bridgeDeckAt(b: BridgeSpan, along: number): number {
  const half = b.halfAngle * PLANET_RADIUS;
  const u = Math.max(-1, Math.min(1, along / Math.max(1e-6, half)));
  return b.endA + (b.endB - b.endA) * ((u + 1) / 2) + b.arch * (1 - u * u);
}

export class ObstacleGrid {
  private cells = new Map<number, Obstacle[]>();
  private byId = new Map<string, { obstacle: Obstacle; key: number }>();
  private bridges = new Map<string, BridgeSpan>();

  addBridge(b: BridgeSpan): void {
    this.bridges.set(b.id, b);
  }

  removeBridge(id: string): void {
    this.bridges.delete(id);
  }

  getBridge(id: string): BridgeSpan | undefined {
    return this.bridges.get(id);
  }

  get bridgeCount(): number {
    return this.bridges.size;
  }

  /** The bridge whose walkable corridor contains n (shrunk by `margin` world units), if any. */
  onBridge(n: Vector3, margin = 0): BridgeSpan | null {
    if (this.bridges.size === 0) return null;
    for (const b of this.bridges.values()) {
      // Cheap reject: farther than the half-length plus a little from the centre.
      if (n.dot(b.center) < Math.cos(b.halfAngle + 0.08)) continue;
      const { along, lateral } = bridgeCoords(b, n);
      if (Math.abs(lateral) <= b.halfWidth - margin && Math.abs(along) <= b.halfAngle * PLANET_RADIUS) return b;
    }
    return null;
  }

  /** Absolute deck radius under n, or -Infinity when n is not on any bridge. */
  deckAt(n: Vector3): number {
    const b = this.onBridge(n);
    if (!b) return -Infinity;
    return bridgeDeckAt(b, bridgeCoords(b, n).along);
  }

  add(o: Obstacle): void {
    this.remove(o.id);
    const key = cellKey(cellOf(o.n.x), cellOf(o.n.y), cellOf(o.n.z));
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(o);
    this.byId.set(o.id, { obstacle: o, key });
  }

  remove(id: string): void {
    this.bridges.delete(id);
    const entry = this.byId.get(id);
    if (!entry) return;
    const list = this.cells.get(entry.key);
    if (list) {
      const i = list.indexOf(entry.obstacle);
      if (i >= 0) list.splice(i, 1);
    }
    this.byId.delete(id);
  }

  /** Returns the first obstacle overlapping a circle of `radius` at n, ignoring `ignoreId`. */
  hit(n: Vector3, radius: number, ignoreId?: string): Obstacle | null {
    const cx = cellOf(n.x), cy = cellOf(n.y), cz = cellOf(n.z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const o of list) {
            if (o.id === ignoreId) continue;
            const need = (o.radius + radius) / PLANET_RADIUS;
            // Chord length ≈ angle for small angles.
            const dxv = o.n.x - n.x, dyv = o.n.y - n.y, dzv = o.n.z - n.z;
            if (dxv * dxv + dyv * dyv + dzv * dzv < need * need) return o;
          }
        }
    return null;
  }

  get size(): number {
    return this.byId.size;
  }
}
