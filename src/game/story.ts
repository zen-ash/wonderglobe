// Little sentences for the "My planet" storybook (pure, deterministic).

import type { Behavior } from "@/core/types";
import { getKind } from "@/core/kinds";

const TEMPLATES: Record<Behavior, string[]> = {
  swim: ["{who} loves swimming in {place}.", "{who} blows bubbles in {place}."],
  float: ["{who} bobs happily on {place}.", "{who} floats along in {place}."],
  fly: ["{who} flies high over {place}.", "{who} swoops through the sky above {place}."],
  flutter: ["{who} flutters from flower to flower in {place}.", "{who} dances in the air in {place}."],
  hover: ["{who} drifts softly above {place}.", "{who} floats over {place} like a dream."],
  walk: ["{who} likes to wander around {place}.", "{who} goes for walks in {place}."],
  hop: ["{who} hops all over {place}.", "{who} bounces happily in {place}."],
  drive: ["{who} goes beep beep around {place}.", "{who} zooms along in {place}."],
  grow: ["{who} grows tall and happy in {place}.", "{who} sways in the breeze in {place}."],
  build: ["{who} is a cosy place in {place}.", "{who} stands snug in {place}."],
  still: ["{who} stands proudly in {place}.", "{who} keeps watch over {place}."],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "Bubbles the Fish loves swimming in Lily Pond." */
export function creationSentence(c: { id: string; name: string; kind: string; behavior: Behavior }, place: string): string {
  const k = getKind(c.kind);
  const label = k.label.toLowerCase();
  const name = c.name.trim() || k.label;
  const who = name.toLowerCase() === label ? `The ${label}` : `${name} the ${label}`;
  const options = TEMPLATES[c.behavior] ?? TEMPLATES.still;
  return options[hash(c.id) % options.length].replace("{who}", who).replace("{place}", place);
}

/** Cover title: "Mia's Wonderglobe" or "My Wonderglobe". */
export function storybookTitle(playerName: string): string {
  const n = playerName.trim();
  if (!n) return "My Wonderglobe";
  return /s$/i.test(n) ? `${n}' Wonderglobe` : `${n}'s Wonderglobe`;
}
