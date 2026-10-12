// Social life for drawn creations: they notice the player (each with its own
// personality), play with friends of the same kind or family, school in their
// pond, perch on trees and roofs, visit drawn houses, gather in the evening and
// sleep at night. Decisions run at ~4 Hz; movement itself stays in agents.ts
// (this only sets targets, states and emotes), so habitats are always kept.

import { Vector3 } from "three";
import { getKind } from "@/core/kinds";
import { environment } from "./environment";
import { busy, startBounce, landOk, type Agent, type SimContext } from "./agents";
import { hashString, mulberry32 } from "./noise";
import { angleBetween, moveAlong, tangentToward, turn, pointAt, PLANET_RADIUS } from "./sphere";

export type Personality = "friendly" | "shy" | "curious";
export type Mood = "happy" | "shy" | "curious";

export type Activity =
  | "free"
  | "attend"
  | "follow"
  | "flee"
  | "hide"
  | "approach"
  | "circle"
  | "return"
  | "play"
  | "rest"
  | "perch"
  | "perched"
  | "visit"
  | "inside"
  | "gather"
  | "gathered"
  | "sleep";

/** Emote ids understood by the renderer. */
export type EmoteId = "heart" | "wow" | "exclaim" | "question" | "zzz" | "note" | "sparkle";

export interface Mind {
  personality: Personality;
  /** Who it plays with (same family or same kind). */
  family: string;
  /** Stays awake at night (owls, ghosts, stars…). */
  nightOwl: boolean;
  activity: Activity;
  /** Runtime time at which the current activity times out. */
  until: number;
  nextNotice: number;
  /** Next time it considers playing / perching / visiting. */
  nextSocial: number;
  partner: string | null;
  chaser: boolean;
  circleAngle: number;
  /** House being visited (people), or for houses: someone lives here. */
  houseId: string | null;
  livedIn: boolean;
  /** Patted or startled awake: stay up until this time. */
  wakeUntil: number;
  /** Gathering point (house or picnic blanket) for the evening. */
  gatherAt: Vector3 | null;
  /** Last seen value of the agent's give-up counter. */
  giveUps: number;
  rng: () => number;
}

const PEOPLE = new Set(["person", "family", "robot"]);
const NIGHT_OWLS = new Set(["owl", "ghost", "star", "alien", "fairy", "cloud"]);
const FAMILY: Record<string, string> = {
  cow: "farm", pig: "farm", sheep: "farm", horse: "farm", chicken: "farm",
  cat: "pets", dog: "pets", mouse: "pets", fox: "pets",
  rabbit: "little", frog: "little", turtle: "little", snail: "little",
  bear: "wild", lion: "wild", elephant: "wild", giraffe: "wild", monkey: "wild", dinosaur: "wild",
  person: "people", family: "people", robot: "people",
  unicorn: "magic", monster: "magic", dragon: "magic",
  car: "wheels", bus: "wheels", truck: "wheels", train: "wheels", bicycle: "wheels", tractor: "wheels",
};
/** Personality leanings per kind: weights for friendly, shy, curious. */
const LEAN: Record<string, [number, number, number]> = {
  dog: [5, 1, 2], horse: [3, 1, 2], cow: [3, 1, 1], pig: [3, 1, 2], sheep: [2, 3, 1], bear: [3, 1, 1],
  cat: [2, 2, 4], fox: [1, 2, 3], monkey: [2, 1, 4], mouse: [1, 4, 2], rabbit: [1, 4, 2], snail: [1, 4, 1],
  turtle: [1, 3, 2], frog: [2, 2, 3], chicken: [1, 3, 2], person: [4, 1, 2], family: [4, 1, 1], robot: [2, 1, 4],
  fish: [2, 2, 3], whale: [4, 1, 1], shark: [3, 1, 2], octopus: [1, 3, 3], duck: [3, 1, 2], swan: [2, 2, 1],
  bird: [2, 2, 3], owl: [2, 1, 3], butterfly: [2, 2, 3], bee: [2, 1, 3], dragon: [3, 1, 2], ghost: [1, 3, 3],
};

export function createMind(id: string, kind: string): Mind {
  const rng = mulberry32(hashString(`${id}|${kind}|mind`));
  const w = LEAN[kind] ?? [1, 1, 1];
  const r = rng() * (w[0] + w[1] + w[2]);
  const personality: Personality = r < w[0] ? "friendly" : r < w[0] + w[1] ? "shy" : "curious";
  return {
    personality,
    family: FAMILY[kind] ?? getKind(kind).category,
    nightOwl: NIGHT_OWLS.has(kind),
    activity: "free",
    until: 0,
    nextNotice: 0,
    nextSocial: 4 + rng() * 10,
    partner: null,
    chaser: false,
    circleAngle: rng() * Math.PI * 2,
    houseId: null,
    livedIn: false,
    wakeUntil: 0,
    gatherAt: null,
    giveUps: 0,
    rng,
  };
}

export interface Perch {
  n: Vector3;
  /** Height above the ground to sit at. */
  alt: number;
}

/** What social decisions can see of the world. */
export interface SocialWorld {
  time: number;
  ctx: SimContext;
  creations: Map<string, Agent>;
  player: Vector3;
  /** Id of the creation currently carrying the player, if any. */
  ridingId: string | null;
  /** Scenery tree tops. */
  perches: Perch[];
  /** The picnic blanket (evening gathering spot), if there is one. */
  blanket: Vector3 | null;
  friendship: Map<string, number>;
  notice(id: string, kind: string, mood: Mood): void;
}

/** How long a social decision tick lasts (seconds). */
export const SOCIAL_TICK = 0.25;
const NOTICE_RANGE = 4;
const COS_NEAR = Math.cos(9 / PLANET_RADIUS);

type Klass = "walker" | "flyer" | "flutter" | "hover" | "swimmer" | "plant" | "house" | "bridge" | "still";

export function klassOf(a: Agent): Klass {
  switch (a.behavior) {
    case "walk":
    case "hop":
    case "drive":
      return "walker";
    case "fly":
      return "flyer";
    case "flutter":
      return "flutter";
    case "hover":
      return "hover";
    case "swim":
    case "float":
      return "swimmer";
    case "grow":
      return "plant";
    case "build":
      return a.kind === "bridge" ? "bridge" : "house";
    default:
      return "still";
  }
}

export function setEmote(a: Agent, emote: EmoteId, seconds: number): void {
  a.emote = emote;
  a.emoteTimer = seconds;
}

/** Plant growth with age: ×1 when new, up to ×1.6 after about a week. */
export function growthScale(createdAt: number, now: number): number {
  const days = Math.max(0, (now - createdAt) / 86_400_000);
  const k = Math.min(1, days / 7);
  return 1 + 0.6 * k * k * (3 - 2 * k);
}

/** Little paper flowers sprouting around a plant after two days. */
export function sproutCount(createdAt: number, now: number): number {
  const days = (now - createdAt) / 86_400_000;
  if (!(days >= 2)) return 0;
  return Math.min(6, 2 + Math.floor((days - 2) * 0.8));
}

const _v = new Vector3();
const _t = new Vector3();

/** A point `dist` world units from `from`, in the direction away from `away`. */
function pointAway(from: Vector3, away: Vector3, dist: number, wobble: number): Vector3 {
  tangentToward(from, away, _t).negate();
  const n = from.clone();
  const t = _t.clone();
  if (wobble) turn(n, t, wobble);
  moveAlong(n, t, dist);
  return n;
}

function dist(a: Vector3, b: Vector3): number {
  return angleBetween(a, b) * PLANET_RADIUS;
}

function houses(world: SocialWorld): Agent[] {
  const out: Agent[] = [];
  for (const h of world.creations.values()) if (h.behavior === "build" && h.kind !== "bridge" && h.spawn >= 1 && h.state !== "carried") out.push(h);
  return out;
}

function nearestHouse(world: SocialWorld, n: Vector3, maxDist: number): Agent | null {
  let best: Agent | null = null, bestD = maxDist;
  for (const h of houses(world)) {
    const d = dist(h.n, n);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** The spot in front of a house's door. */
export function doorOf(h: Agent): Vector3 {
  const n = h.n.clone(), t = h.t.clone();
  moveAlong(n, t, h.radius + 0.55);
  return n;
}

function seek(a: Agent, target: Vector3, speed: number, stop: number): void {
  if (a.state !== "seek") a.stuck = 0;
  a.state = "seek";
  a.target = target;
  a.seekSpeed = speed;
  a.seekStop = stop;
  a.arrived = false;
}

function settle(a: Agent): void {
  a.state = "idle";
  a.target = null;
  a.timer = 0.5 + a.rng();
  a.steerTo = null;
}

function startReturn(a: Agent, m: Mind, time: number): void {
  m.activity = "return";
  m.until = time + 20;
  m.partner = null;
  a.steerTo = null;
  if (a.home && dist(a.n, a.home) > a.homeRadius * PLANET_RADIUS * 0.6) seek(a, a.home.clone(), 1, Math.max(1.2, a.homeRadius * PLANET_RADIUS * 0.4));
  else {
    m.activity = "free";
    settle(a);
  }
}

function goToSleep(a: Agent, m: Mind): void {
  m.activity = "sleep";
  m.partner = null;
  a.target = null;
  a.steerTo = null;
  a.state = "sleep";
  setEmote(a, "zzz", 4);
}

function wakeUp(a: Agent, m: Mind, time: number): void {
  if (a.state === "sleep") a.state = a.behavior === "fly" ? "move" : "idle";
  a.timer = 0.5;
  a.perchAlt = 0;
  a.target = null;
  m.activity = "free";
  m.nextSocial = time + 3 + m.rng() * 6;
  startBounce(a, m.rng() * 0.6, 0.35);
  if (m.rng() < 0.6) setEmote(a, m.rng() < 0.5 ? "note" : "sparkle", 2.5);
  // Walkers far from home after the evening gathering head back.
  if (klassOf(a) === "walker" && a.home && dist(a.n, a.home) > a.homeRadius * PLANET_RADIUS) startReturn(a, m, time);
}

function findPerch(world: SocialWorld, a: Agent): Perch | null {
  let best: Perch | null = null, bestD = 9;
  for (const p of world.perches) {
    if (p.n.dot(a.n) < COS_NEAR) continue;
    const d = dist(p.n, a.n);
    if (d < bestD && d > 1) {
      bestD = d;
      best = p;
    }
  }
  for (const h of houses(world)) {
    const d = dist(h.n, a.n);
    if (d < bestD && d > 1) {
      bestD = d;
      best = { n: h.n.clone(), alt: h.size * 0.95 };
    }
  }
  return best;
}

/** A spot behind the nearest tree or house (as seen from the player), or straight away from the player. */
function hideSpot(world: SocialWorld, a: Agent): Vector3 {
  let best: Vector3 | null = null, bestD = 7;
  const consider = (n: Vector3, radius: number) => {
    const d = dist(n, a.n);
    if (d >= bestD || dist(n, world.player) < 2.5) return;
    const spot = pointAway(n, world.player, radius + 0.9, 0);
    if (!landOk(world.ctx, spot, a.radius * 0.6, a.id)) return;
    bestD = d;
    best = spot;
  };
  for (const p of world.perches) if (p.n.dot(a.n) > COS_NEAR) consider(p.n, 0.7);
  for (const h of houses(world)) if (h.n.dot(a.n) > COS_NEAR) consider(h.n, h.radius);
  if (best) return best;
  for (const wob of [0, 0.7, -0.7, 1.4, -1.4]) {
    const n = pointAway(a.n, world.player, 4, wob);
    if (landOk(world.ctx, n, a.radius * 0.6, a.id)) return n;
  }
  return a.home?.clone() ?? a.n.clone();
}

function circlePoint(center: Vector3, angle: number, radius: number): Vector3 {
  return pointAt(center, radius / PLANET_RADIUS, angle, new Vector3());
}

/** Evening gathering point: the nearest drawn house, else the picnic blanket (if near enough). */
function gatherSpot(world: SocialWorld, a: Agent, m: Mind): Vector3 | null {
  const home = a.home ?? a.n;
  const h = nearestHouse(world, home, 9);
  let center: Vector3 | null = h ? h.n : null;
  if (!center && world.blanket && dist(world.blanket, home) < 13) center = world.blanket;
  if (!center) return null;
  // Each one picks its own place in a loose ring.
  const ring = (h ? h.radius + 1.3 : 1.9) + m.rng() * 0.9;
  return circlePoint(center, (hashString(a.id) % 360) * (Math.PI / 180), ring);
}

function startNotice(world: SocialWorld, a: Agent, m: Mind, k: Klass): void {
  const time = world.time;
  const friends = world.friendship.get(a.id) ?? 0;
  m.nextNotice = time + 14 / (1 + 0.35 * friends) + m.rng() * 4;
  // Good friends warm up even when shy.
  const p: Personality = friends >= 3 && m.personality === "shy" ? "friendly" : m.personality;
  const mood: Mood = p === "friendly" ? "happy" : p === "shy" ? "shy" : "curious";
  world.notice(a.id, a.kind, mood);
  const player = world.player.clone();
  if (k === "walker") {
    if (p === "friendly") {
      setEmote(a, "heart", 2.4);
      a.state = "attend";
      a.target = player;
      a.timer = 1.8;
      startBounce(a, 0.2, 0.45); // a little wave-hop
      m.activity = "attend";
      m.until = time + 1.8;
    } else if (p === "shy") {
      setEmote(a, "exclaim", 1.8);
      seek(a, hideSpot(world, a), 1.6, 0.5);
      m.activity = "flee";
      m.until = time + 6;
    } else {
      setEmote(a, "question", 2.2);
      seek(a, player, 0.9, 1.8);
      m.activity = "approach";
      m.until = time + 5;
    }
    return;
  }
  // Flyers, flutterers, floaters and swimmers steer instead of walking.
  setEmote(a, p === "friendly" ? "heart" : p === "shy" ? "exclaim" : "question", 2.2);
  a.steerTo = p === "shy" ? pointAway(a.n, world.player, 6, 0) : player;
  a.steerGain = p === "shy" ? 1.2 : 0.9;
  m.activity = p === "shy" ? "flee" : "circle";
  m.until = time + (p === "shy" ? 3 : 6);
}

/** Continue whatever the creature is doing; returns true if it is occupied. */
function continueActivity(world: SocialWorld, a: Agent, m: Mind, k: Klass): boolean {
  const time = world.time;
  const timedOut = time > m.until;
  const seeking = a.state === "seek";
  // Blocked while chasing something that keeps moving: stop trying.
  if (a.giveUps !== m.giveUps) {
    m.giveUps = a.giveUps;
    if (m.activity === "follow" || m.activity === "circle" || m.activity === "play") {
      if (m.activity === "play") {
        const p = m.partner ? world.creations.get(m.partner) : null;
        if (p?.mind && p.mind.partner === a.id) p.mind.until = 0;
      }
      m.partner = null;
      m.activity = "rest";
      m.until = time + 2 + m.rng() * 3;
      settle(a);
      return true;
    }
  }
  switch (m.activity) {
    case "free":
      return false;
    case "attend":
      if (timedOut) {
        const friends = world.friendship.get(a.id) ?? 0;
        if (m.rng() < 0.45 + 0.1 * friends) {
          m.activity = "follow";
          m.until = time + 4 + m.rng() * 3 + friends;
        } else startReturn(a, m, time);
      }
      return true;
    case "follow": {
      if (timedOut) {
        startReturn(a, m, time);
        return true;
      }
      const d = dist(a.n, world.player);
      if (d > 2.4) seek(a, world.player.clone(), 1.15, 1.5);
      else if (!seeking) {
        a.state = "attend";
        a.target = world.player.clone();
        a.timer = 1;
      }
      return true;
    }
    case "flee":
      if (k !== "walker") {
        if (timedOut) {
          a.steerTo = null;
          m.activity = "free";
        }
        return true;
      }
      if (!seeking || timedOut) {
        m.activity = "hide";
        m.until = time + 3 + m.rng() * 3;
        a.state = "attend";
        a.target = world.player.clone();
        a.timer = 1;
      }
      return true;
    case "hide":
      if (timedOut) startReturn(a, m, time);
      else if (a.state !== "attend") {
        a.state = "attend";
        a.timer = 1;
      } else a.timer = Math.max(a.timer, 0.5);
      return true;
    case "approach":
      if (!seeking || timedOut) {
        m.activity = "circle";
        m.until = time + 4 + m.rng() * 2;
        m.circleAngle = m.rng() * Math.PI * 2;
      }
      return true;
    case "circle":
      if (k !== "walker") {
        if (timedOut) {
          a.steerTo = null;
          m.activity = "free";
        } else if (a.steerTo) a.steerTo.copy(world.player);
        return true;
      }
      if (timedOut) {
        startReturn(a, m, time);
        return true;
      }
      m.circleAngle += SOCIAL_TICK * 1.3;
      seek(a, circlePoint(world.player, m.circleAngle, 1.9), 0.85, 0.35);
      return true;
    case "return":
      if (!seeking || timedOut) {
        m.activity = "free";
        if (seeking) settle(a);
      }
      return true;
    case "play":
      stepPlay(world, a, m);
      return true;
    case "rest":
      if (timedOut) startReturn(a, m, time);
      return true;
    case "perch":
      if (a.state === "rest") {
        m.activity = "perched";
        m.until = time + 6 + m.rng() * 8;
      } else if (timedOut || a.state !== "perch") {
        a.state = "move";
        a.target = null;
        m.activity = "free";
      }
      return true;
    case "perched":
      if (timedOut) {
        a.state = "move";
        a.target = null;
        a.perchAlt = 0;
        a.timer = 0;
        m.activity = "free";
        m.nextSocial = time + 15 + m.rng() * 20;
        if (m.rng() < 0.4) setEmote(a, "note", 2);
      }
      return true;
    case "visit": {
      const house = m.houseId ? world.creations.get(m.houseId) : null;
      if (!house || house.state === "carried" || timedOut) {
        startReturn(a, m, time);
        return true;
      }
      if (!seeking) {
        if (a.arrived) {
          a.state = "inside";
          a.hidden = true;
          a.target = null;
          m.activity = "inside";
          m.until = time + 6 + m.rng() * 9;
          if (house.mind) house.mind.livedIn = true;
          house.attendTarget = 1;
        } else startReturn(a, m, time);
      }
      return true;
    }
    case "inside": {
      const house = m.houseId ? world.creations.get(m.houseId) : null;
      const night = environment.isNight && !m.nightOwl;
      if (!house || house.state === "carried" || (timedOut && !night)) popOut(a, m, house ?? null, time);
      return true;
    }
    case "gather":
      if (!seeking || timedOut) {
        m.activity = "gathered";
        a.state = "attend";
        a.target = m.gatherAt?.clone() ?? null;
        a.timer = 1;
      }
      return true;
    case "gathered":
      if (a.state !== "attend") a.state = "attend";
      a.timer = Math.max(a.timer, 0.5);
      if (!a.emote && m.rng() < 0.03) setEmote(a, "note", 2);
      return true;
    case "sleep":
      if (a.state !== "sleep") a.state = "sleep";
      if (!a.emote && m.rng() < 0.3) setEmote(a, "zzz", 3.5);
      return true;
  }
}

function popOut(a: Agent, m: Mind, house: Agent | null, time: number): void {
  a.hidden = false;
  if (house) {
    const door = doorOf(house);
    a.n.copy(door);
    a.t.copy(house.t).addScaledVector(a.n, -house.t.dot(a.n)).normalize();
  }
  a.state = "idle";
  a.timer = 1;
  m.houseId = null;
  m.nextSocial = time + 20 + m.rng() * 20;
  startBounce(a, 0, 0.5);
  setEmote(a, m.rng() < 0.5 ? "note" : "heart", 2.2);
  startReturn(a, m, time);
}

function stepPlay(world: SocialWorld, a: Agent, m: Mind): void {
  const time = world.time;
  const p = m.partner ? world.creations.get(m.partner) : null;
  if (!p || !p.mind || p.mind.activity !== "play" || p.mind.partner !== a.id || time > m.until || busy(p)) {
    m.activity = "rest";
    m.partner = null;
    m.until = time + 3 + m.rng() * 4;
    m.nextSocial = time + 25 + m.rng() * 25;
    settle(a);
    if (m.rng() < 0.5) setEmote(a, "heart", 2);
    return;
  }
  if (m.chaser) {
    if (dist(a.n, p.n) < 1.1) {
      // Tag! Swap roles.
      m.chaser = false;
      p.mind.chaser = true;
      setEmote(p, "note", 1.4);
      startBounce(p, 0, 0.4);
      // Run off right away.
      seek(a, pointAway(a.n, p.n, 3, 0), 1.25, 0.4);
      return;
    }
    seek(a, p.n.clone(), 1.35, 0.9);
  } else {
    const wob = Math.sin(time * 1.7 + a.phase) * 0.7;
    seek(a, pointAway(a.n, p.n, 3, wob), 1.2, 0.4);
  }
}

function tryStartPlay(world: SocialWorld, a: Agent, m: Mind): boolean {
  for (const b of world.creations.values()) {
    if (b === a || !b.mind || b.mind.activity !== "free" || busy(b)) continue;
    if (klassOf(b) !== "walker") continue;
    if (b.kind !== a.kind && b.mind.family !== m.family) continue;
    if (b.n.dot(a.n) < COS_NEAR || dist(b.n, a.n) > 7) continue;
    const until = world.time + 12 + m.rng() * 6;
    m.activity = b.mind.activity = "play";
    m.partner = b.id;
    b.mind.partner = a.id;
    m.chaser = true;
    b.mind.chaser = false;
    m.until = b.mind.until = until;
    setEmote(a, "note", 2);
    setEmote(b, "exclaim", 1.5);
    return true;
  }
  return false;
}

function school(world: SocialWorld, a: Agent): void {
  if (!a.home) return;
  let count = 0;
  const c = _v.set(0, 0, 0);
  const h = new Vector3();
  for (const b of world.creations.values()) {
    if (b === a || klassOf(b) !== "swimmer" || b.behavior !== a.behavior || !b.home || busy(b)) continue;
    if (b.home.dot(a.home) < 0.9999 || b.n.dot(a.n) < COS_NEAR) continue;
    if (dist(b.n, a.n) > 6) continue;
    c.add(b.n);
    h.add(b.t);
    count++;
  }
  if (!count) {
    a.steerTo = null;
    return;
  }
  // Swim toward the group, a little ahead along its heading.
  c.add(a.n).normalize();
  h.add(a.t);
  h.addScaledVector(c, -h.dot(c));
  const target = c.clone();
  if (h.lengthSq() > 1e-8) moveAlong(target, h.normalize(), 1.6);
  a.steerTo = target;
  a.steerGain = 0.45;
}

/** One social decision tick (call at ~4 Hz with dt ≈ SOCIAL_TICK). */
export function stepSocial(world: SocialWorld): void {
  const time = world.time;
  const night = environment.isNight;
  const evening = !night && environment.dusk > 0.3 && environment.time > 0.5;
  const playerNear = (a: Agent) => a.n.dot(world.player) > COS_NEAR && dist(a.n, world.player) < NOTICE_RANGE;

  for (const a of world.creations.values()) {
    const m = a.mind;
    if (!m) continue;
    if (a.state === "carried" || a.state === "ride" || a.spawn < 1 || a.id === world.ridingId) continue;
    const k = klassOf(a);

    // Plants lean toward the player; houses light their door.
    if (k === "plant" || k === "still" || k === "house" || k === "bridge") {
      const near = a.n.dot(world.player) > COS_NEAR && dist(a.n, world.player) < (k === "house" ? 5.5 : 4.5);
      a.attendTarget = near || (k === "house" && m.livedIn && night) ? 1 : 0;
      continue;
    }

    // Night: most creatures sleep (walkers first finish gathering).
    const sleepy = night && !m.nightOwl && time > m.wakeUntil;
    if (m.activity === "inside") {
      continueActivity(world, a, m, k);
      continue;
    }
    if (sleepy && m.activity !== "sleep") {
      if (k === "walker" && m.activity === "gather" && a.state === "seek" && time < m.until) continue;
      if (k === "flyer") {
        if (a.state === "rest") goToSleep(a, m);
        else if (m.activity !== "perch") {
          const perch = findPerch(world, a);
          if (perch) {
            a.state = "perch";
            a.target = perch.n.clone();
            a.perchAlt = perch.alt;
            a.steerTo = null;
            m.activity = "perch";
            m.until = time + 25;
          } else if (m.activity !== "free") {
            m.activity = "free";
            a.steerTo = null;
          }
        } else continueActivity(world, a, m, k);
        continue;
      }
      if (m.activity === "play") {
        m.partner = null;
      }
      goToSleep(a, m);
      continue;
    }
    if (!sleepy && m.activity === "sleep") {
      wakeUp(a, m, time);
      continue;
    }

    // Evening: walkers wander over to a house or the picnic blanket.
    if (k === "walker" && evening && (m.activity === "free" || m.activity === "rest")) {
      const spot = gatherSpot(world, a, m);
      if (spot && dist(spot, a.n) > 1) {
        m.gatherAt = spot;
        m.activity = "gather";
        m.until = time + 30;
        seek(a, spot, 1, 0.6);
        continue;
      }
    }
    if (!evening && !night && (m.activity === "gathered" || m.activity === "gather")) {
      startReturn(a, m, time);
      continue;
    }

    // Noticing the player.
    const canNotice = m.activity === "free" || m.activity === "gathered" || m.activity === "rest" || m.activity === "perched";
    if (canNotice && time >= m.nextNotice && !world.ridingId && playerNear(a)) {
      if (m.activity === "perched") {
        // Sitting birds just look and chirp.
        m.nextNotice = time + 12;
        world.notice(a.id, a.kind, m.personality === "shy" ? "shy" : m.personality === "friendly" ? "happy" : "curious");
        setEmote(a, m.personality === "shy" ? "exclaim" : "note", 2);
        continue;
      }
      startNotice(world, a, m, k);
      continue;
    }

    if (continueActivity(world, a, m, k)) continue;

    // Free time with friends.
    if (k === "swimmer") {
      school(world, a);
      continue;
    }
    if (time < m.nextSocial || night) continue;
    m.nextSocial = time + 6 + m.rng() * 10;
    if (k === "walker") {
      // People often pop into a drawn house; other walking animals now and then.
      if ((PEOPLE.has(a.kind) && m.rng() < 0.5) || (a.behavior === "walk" && m.rng() < 0.12)) {
        const house = nearestHouse(world, a.n, 9);
        if (house) {
          m.activity = "visit";
          m.houseId = house.id;
          m.until = time + 25;
          seek(a, doorOf(house), 1, 0.55);
          continue;
        }
      }
      if (m.rng() < 0.45) tryStartPlay(world, a, m);
    } else if (k === "flyer" && m.rng() < 0.4) {
      const perch = findPerch(world, a);
      if (perch) {
        a.state = "perch";
        a.target = perch.n.clone();
        a.perchAlt = perch.alt;
        m.activity = "perch";
        m.until = time + 20;
      }
    }
  }
}

/** Pat a creature: heart, happy hop, friendship +1. */
export function patAgent(a: Agent, world: Pick<SocialWorld, "friendship" | "time">): void {
  world.friendship.set(a.id, (world.friendship.get(a.id) ?? 0) + 1);
  setEmote(a, "heart", 2.6);
  if (a.state !== "inside" && a.state !== "carried") startBounce(a, 0, 0.7);
  const m = a.mind;
  if (m) {
    m.wakeUntil = world.time + 12;
    if (m.activity === "sleep") {
      wakeUp(a, m, world.time);
      setEmote(a, "heart", 2.6);
    }
    // A patted shy creature stops running away.
    if (m.activity === "flee" || m.activity === "hide") {
      m.activity = "free";
      settle(a);
    }
  }
}

/** Startle (shake the planet): a surprised jump after a tiny random delay. */
export function startleAgent(a: Agent, time: number, rng: () => number, withEmote: boolean): void {
  if (a.state === "carried" || a.state === "inside" || a.state === "ride" || a.hidden) return;
  startBounce(a, rng() * 0.35, 0.8 + rng() * 0.6);
  if (withEmote) setEmote(a, "wow", 1.8);
  const m = a.mind;
  if (m) {
    m.wakeUntil = time + 6;
    if (m.activity === "sleep") wakeUp(a, m, time);
  }
}
