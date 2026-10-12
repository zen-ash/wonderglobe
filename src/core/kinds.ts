// The shared kind table: maps "what it is" to how it looks in the world,
// how it moves, how big it is and how it reacts. Used by the recogniser
// (server validation), the manual "What did you draw?" picker, simulation
// and rendering, so every part of the game agrees.

import type { Behavior, KindCategory } from "./types";

export interface KindInfo {
  id: string;
  label: string;
  emoji: string;
  category: KindCategory;
  behavior: Behavior;
  /** Height in world units when standing on the planet (planet radius = 20). */
  size: number;
  /** Movement speed in world units / second (0 for static things). */
  speed: number;
  /** Whether a facing direction matters (moving things). */
  hasFacing: boolean;
  /** Sound word used in local replies and as a prompt for generated sounds. */
  sound: string;
  /** Short prompt for an optional generated animal/object sound effect. */
  soundPrompt?: string;
  /** Voice character used to pick a stable voice. */
  voice: "small" | "big" | "bright" | "calm" | "silly";
}

const K = (
  id: string,
  label: string,
  emoji: string,
  category: KindCategory,
  behavior: Behavior,
  size: number,
  speed: number,
  sound: string,
  voice: KindInfo["voice"],
  soundPrompt?: string,
): KindInfo => ({
  id,
  label,
  emoji,
  category,
  behavior,
  size,
  speed,
  hasFacing: speed > 0,
  sound,
  voice,
  soundPrompt,
});

export const KINDS: KindInfo[] = [
  // Animals that walk
  K("cat", "Cat", "🐱", "animal", "walk", 1.1, 1.3, "Meow!", "small", "a cute cartoon kitten meow"),
  K("dog", "Dog", "🐶", "animal", "walk", 1.2, 1.6, "Woof woof!", "bright", "a happy cartoon puppy bark"),
  K("rabbit", "Bunny", "🐰", "animal", "hop", 0.9, 1.4, "Sniff sniff!", "small"),
  K("horse", "Horse", "🐴", "animal", "walk", 1.8, 2.0, "Neigh!", "big", "a friendly cartoon horse neigh"),
  K("cow", "Cow", "🐮", "animal", "walk", 1.6, 0.8, "Moooo!", "big", "a gentle cartoon cow moo"),
  K("pig", "Pig", "🐷", "animal", "walk", 1.1, 1.0, "Oink oink!", "silly", "a cute cartoon pig oink"),
  K("sheep", "Sheep", "🐑", "animal", "walk", 1.1, 0.9, "Baaa!", "silly", "a cute cartoon sheep baa"),
  K("bear", "Bear", "🐻", "animal", "walk", 1.8, 1.0, "Grrr-hello!", "big", "a soft friendly cartoon bear growl"),
  K("lion", "Lion", "🦁", "animal", "walk", 1.7, 1.4, "Roar!", "big", "a small friendly cartoon lion roar"),
  K("elephant", "Elephant", "🐘", "animal", "walk", 2.2, 0.9, "Pawoo!", "big", "a cute cartoon elephant trumpet"),
  K("giraffe", "Giraffe", "🦒", "animal", "walk", 2.6, 1.1, "Hmm-hum!", "calm"),
  K("dinosaur", "Dinosaur", "🦖", "animal", "walk", 2.2, 1.3, "Rawr!", "big", "a cute cartoon baby dinosaur roar"),
  K("frog", "Frog", "🐸", "animal", "hop", 0.7, 1.2, "Ribbit!", "silly", "a cartoon frog ribbit"),
  K("turtle", "Turtle", "🐢", "animal", "walk", 0.8, 0.4, "Slow and steady!", "calm"),
  K("snail", "Snail", "🐌", "animal", "walk", 0.6, 0.25, "Sloooow hello!", "calm"),
  K("mouse", "Mouse", "🐭", "animal", "walk", 0.6, 1.5, "Squeak!", "small", "a tiny cartoon mouse squeak"),
  K("chicken", "Chicken", "🐔", "animal", "walk", 0.9, 1.2, "Cluck cluck!", "silly", "a cartoon chicken cluck"),
  K("monkey", "Monkey", "🐵", "animal", "hop", 1.2, 1.6, "Ooh ooh ah ah!", "silly", "a playful cartoon monkey chatter"),
  K("fox", "Fox", "🦊", "animal", "walk", 1.1, 1.7, "Yip yip!", "bright"),
  // Animals in the sky
  K("bird", "Bird", "🐦", "animal", "fly", 0.9, 3.0, "Tweet tweet!", "bright", "a cheerful little bird tweet"),
  K("owl", "Owl", "🦉", "animal", "fly", 1.0, 2.4, "Hoo hoo!", "calm", "a soft cartoon owl hoot"),
  K("butterfly", "Butterfly", "🦋", "animal", "flutter", 0.8, 1.2, "Flutter flutter!", "small"),
  K("bee", "Bee", "🐝", "animal", "flutter", 0.6, 1.6, "Bzzz!", "small", "a cute cartoon bee buzz"),
  K("ladybug", "Ladybug", "🐞", "animal", "flutter", 0.5, 1.0, "Hello, spots here!", "small"),
  K("dragonfly", "Dragonfly", "🪰", "animal", "flutter", 0.7, 2.0, "Zip zip!", "small"),
  // Animals in the water
  K("fish", "Fish", "🐟", "animal", "swim", 0.9, 1.6, "Blub blub!", "small", "cartoon underwater bubbles blub"),
  K("whale", "Whale", "🐋", "animal", "swim", 2.0, 1.2, "Wooo-ooo!", "big", "a gentle cartoon whale song"),
  K("shark", "Shark", "🦈", "animal", "swim", 1.6, 2.0, "Chomp! Just kidding!", "big"),
  K("octopus", "Octopus", "🐙", "animal", "swim", 1.1, 1.0, "Wiggle wiggle!", "silly"),
  K("duck", "Duck", "🦆", "animal", "float", 0.9, 1.0, "Quack quack!", "silly", "a cute cartoon duck quack"),
  K("swan", "Swan", "🦢", "animal", "float", 1.2, 0.8, "Honk!", "calm"),
  // People
  K("person", "Person", "🧒", "person", "walk", 1.6, 1.4, "Hi there!", "bright"),
  K("family", "Family", "👨‍👩‍👧", "person", "walk", 1.6, 1.0, "Hello from all of us!", "calm"),
  K("robot", "Robot", "🤖", "imaginary", "walk", 1.6, 1.1, "Beep boop!", "silly", "a cute cartoon robot beep boop"),
  // Plants
  K("flower", "Flower", "🌸", "plant", "grow", 1.0, 0, "La la la!", "small"),
  K("sunflower", "Sunflower", "🌻", "plant", "grow", 1.8, 0, "Sunny hello!", "bright"),
  K("tree", "Tree", "🌳", "plant", "grow", 3.2, 0, "Rustle rustle!", "calm"),
  K("bush", "Bush", "🌿", "plant", "grow", 1.1, 0, "Shh-shh!", "calm"),
  K("mushroom", "Mushroom", "🍄", "plant", "grow", 0.9, 0, "Pop!", "silly"),
  K("cactus", "Cactus", "🌵", "plant", "grow", 1.6, 0, "No hugs, but hello!", "calm"),
  // Buildings
  K("house", "House", "🏠", "building", "build", 2.6, 0, "Welcome home!", "calm"),
  K("castle", "Castle", "🏰", "building", "build", 3.6, 0, "Hear ye, hear ye!", "big"),
  K("tower", "Tower", "🗼", "building", "build", 3.8, 0, "I can see far!", "calm"),
  K("shop", "Shop", "🏪", "building", "build", 2.4, 0, "Come on in!", "bright"),
  K("tent", "Tent", "⛺", "building", "build", 1.6, 0, "Cosy inside!", "calm"),
  // A bridge lies across water so the player can walk over it (special-cased in the simulation).
  K("bridge", "Bridge", "🌉", "building", "build", 1.4, 0, "Trip trap, come across!", "calm"),
  // Vehicles
  K("car", "Car", "🚗", "vehicle", "drive", 1.2, 3.0, "Beep beep!", "bright", "a cartoon toy car horn beep beep"),
  K("bus", "Bus", "🚌", "vehicle", "drive", 1.7, 2.4, "All aboard!", "big"),
  K("truck", "Truck", "🚚", "vehicle", "drive", 1.6, 2.4, "Vroom vroom!", "big", "a cartoon toy truck vroom"),
  K("train", "Train", "🚂", "vehicle", "drive", 1.6, 2.8, "Choo choo!", "big", "a cartoon toy train whistle choo choo"),
  K("bicycle", "Bicycle", "🚲", "vehicle", "drive", 1.2, 2.2, "Ring ring!", "bright", "a bicycle bell ring ring"),
  K("tractor", "Tractor", "🚜", "vehicle", "drive", 1.6, 1.4, "Putt putt putt!", "big"),
  K("boat", "Boat", "⛵", "vehicle", "float", 1.6, 1.3, "Ahoy!", "calm", "a cartoon ship horn toot"),
  K("airplane", "Airplane", "✈️", "vehicle", "fly", 1.4, 4.0, "Zoooom!", "bright", "a cartoon toy airplane zoom"),
  K("rocket", "Rocket", "🚀", "vehicle", "fly", 1.8, 4.5, "3, 2, 1, whoosh!", "bright", "a cartoon rocket whoosh"),
  K("balloon", "Balloon", "🎈", "thing", "hover", 1.3, 0.5, "Up, up, up!", "small"),
  K("helicopter", "Helicopter", "🚁", "vehicle", "fly", 1.4, 2.6, "Whirr whirr!", "bright"),
  // Imaginary and other
  K("dragon", "Dragon", "🐉", "imaginary", "fly", 2.2, 3.2, "Fwoosh! A friendly one!", "big", "a cute cartoon dragon roar"),
  K("unicorn", "Unicorn", "🦄", "imaginary", "walk", 1.8, 1.8, "Sparkle neigh!", "bright"),
  K("monster", "Friendly monster", "👾", "imaginary", "walk", 1.6, 1.2, "Grumble-hello!", "silly", "a silly friendly cartoon monster grumble"),
  K("ghost", "Ghost", "👻", "imaginary", "hover", 1.3, 0.6, "Boo! Hee hee!", "silly"),
  K("alien", "Alien", "👽", "imaginary", "hover", 1.4, 0.8, "Greetings, Earthling!", "silly"),
  K("fairy", "Fairy", "🧚", "imaginary", "flutter", 1.0, 1.4, "Twinkle!", "small"),
  K("cloud", "Cloud", "☁️", "thing", "hover", 1.6, 0.4, "Puff puff!", "calm"),
  K("star", "Star", "⭐", "thing", "hover", 1.0, 0.3, "Twinkle twinkle!", "bright"),
  K("heart", "Heart", "❤️", "thing", "still", 1.2, 0, "Love you!", "small"),
  K("rainbow", "Rainbow", "🌈", "thing", "still", 2.4, 0, "So many colours!", "bright"),
  K("sculpture", "Something special", "✨", "thing", "still", 1.4, 0, "Hello!", "calm"),
];

export const KIND_BY_ID: Record<string, KindInfo> = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const KIND_IDS = KINDS.map((k) => k.id) as [string, ...string[]];
export const FALLBACK_KIND = "sculpture";

export function getKind(id: string): KindInfo {
  return KIND_BY_ID[id] ?? KIND_BY_ID[FALLBACK_KIND];
}

/** Choices offered for imaginary creations: the player picks how it lives. */
export interface BehaviorChoice {
  behavior: Behavior;
  label: string;
  emoji: string;
  /** A representative kind so size/speed defaults make sense. */
  kind: string;
}

export const BEHAVIOR_CHOICES: BehaviorChoice[] = [
  { behavior: "walk", label: "Walks", emoji: "🚶", kind: "monster" },
  { behavior: "hop", label: "Hops", emoji: "🐇", kind: "frog" },
  { behavior: "fly", label: "Flies", emoji: "🕊️", kind: "dragon" },
  { behavior: "flutter", label: "Flutters", emoji: "🦋", kind: "fairy" },
  { behavior: "swim", label: "Swims", emoji: "🐠", kind: "fish" },
  { behavior: "float", label: "Floats on water", emoji: "🛟", kind: "boat" },
  { behavior: "drive", label: "Drives", emoji: "🛞", kind: "car" },
  { behavior: "hover", label: "Drifts in the air", emoji: "🎈", kind: "balloon" },
  { behavior: "grow", label: "Grows", emoji: "🌱", kind: "flower" },
  { behavior: "build", label: "Is a building", emoji: "🏠", kind: "house" },
  { behavior: "still", label: "Stays still", emoji: "🗿", kind: "sculpture" },
];

export const BEHAVIOR_LABEL: Record<Behavior, string> = Object.fromEntries(
  BEHAVIOR_CHOICES.map((c) => [c.behavior, c.label]),
) as Record<Behavior, string>;

/** Groups for the "What did you draw?" picker. */
export const KIND_GROUPS: Array<{ id: KindCategory | "sky" | "water"; label: string; kinds: string[] }> = [
  { id: "animal", label: "Animals", kinds: ["cat", "dog", "rabbit", "horse", "cow", "pig", "sheep", "bear", "lion", "elephant", "giraffe", "dinosaur", "frog", "turtle", "snail", "mouse", "chicken", "monkey", "fox"] },
  { id: "sky", label: "Sky friends", kinds: ["bird", "owl", "butterfly", "bee", "ladybug", "dragonfly"] },
  { id: "water", label: "Water friends", kinds: ["fish", "whale", "shark", "octopus", "duck", "swan"] },
  { id: "person", label: "People", kinds: ["person", "family", "robot"] },
  { id: "plant", label: "Plants", kinds: ["flower", "sunflower", "tree", "bush", "mushroom", "cactus"] },
  { id: "building", label: "Buildings", kinds: ["house", "castle", "tower", "shop", "tent", "bridge"] },
  { id: "vehicle", label: "Things that go", kinds: ["car", "bus", "truck", "train", "bicycle", "tractor", "boat", "airplane", "rocket", "helicopter", "balloon"] },
  { id: "imaginary", label: "Imaginary", kinds: ["dragon", "unicorn", "monster", "ghost", "alien", "fairy", "cloud", "star", "heart", "rainbow", "sculpture"] },
];

/** Whether a behaviour lives on/in water. */
export function needsWater(b: Behavior): boolean {
  return b === "swim" || b === "float";
}

/** Whether a behaviour must stand on dry land. */
export function needsLand(b: Behavior): boolean {
  return b === "walk" || b === "hop" || b === "drive" || b === "grow" || b === "build" || b === "still";
}

/** Whether a behaviour moves through the air. */
export function isAirborne(b: Behavior): boolean {
  return b === "fly" || b === "flutter" || b === "hover";
}

/** Movement speed for a kind + behaviour override (imaginary creations). */
export function speedFor(kind: string, behavior: Behavior): number {
  const k = getKind(kind);
  if (k.behavior === behavior) return k.speed;
  const choice = BEHAVIOR_CHOICES.find((c) => c.behavior === behavior);
  return choice ? getKind(choice.kind).speed : 0;
}

/** World height for a kind (behaviour can change the default slightly). */
export function sizeFor(kind: string): number {
  return getKind(kind).size;
}
