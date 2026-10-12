// Cute default names, used when AI recognition is unavailable or the player
// picks the kind themselves. Deterministic for a given (kind, seed).

import { getKind } from "@/core/kinds";
import { hashString } from "./hash";

const BY_KIND: Record<string, string[]> = {
  cat: ["Whiskers", "Mittens", "Purrcy", "Biscuit", "Luna"],
  dog: ["Biscuit", "Waggles", "Rusty", "Pepper", "Scout"],
  rabbit: ["Clover", "Hops", "Thumper", "Cotton", "Nibbles"],
  horse: ["Thunder", "Daisy", "Gallop", "Maple", "Comet"],
  cow: ["Buttercup", "Moomoo", "Clementine", "Patches"],
  pig: ["Truffle", "Pinky", "Oinkers", "Peanut"],
  sheep: ["Woolly", "Fluffy", "Cloud", "Baabara"],
  bear: ["Honey", "Bruno", "Teddy", "Huggles"],
  lion: ["Sunny", "Leo", "Mane", "Roary"],
  elephant: ["Peanut", "Trumpet", "Ellie", "Jumbo"],
  giraffe: ["Stretch", "Spots", "Gigi", "Treetop"],
  dinosaur: ["Rex", "Stompy", "Dino", "Pebbles"],
  frog: ["Ribbit", "Lily", "Hopper", "Pickle"],
  turtle: ["Shelly", "Slowpoke", "Mossy", "Tank"],
  snail: ["Swirl", "Slider", "Gary", "Spiral"],
  mouse: ["Squeaky", "Cheddar", "Pip", "Nibbles"],
  chicken: ["Nugget", "Clucky", "Henrietta", "Pecky"],
  monkey: ["Banana", "Cheeky", "Coco", "Swinger"],
  fox: ["Rusty", "Ember", "Foxy", "Maple"],
  bird: ["Tweety", "Sky", "Chirpy", "Feather"],
  owl: ["Hoot", "Professor", "Moony", "Owlivia"],
  butterfly: ["Flutter", "Petal", "Rainbow Wings", "Sunny"],
  bee: ["Buzzy", "Honey", "Stripes", "Bumble"],
  ladybug: ["Dotty", "Ruby", "Spots", "Cherry"],
  dragonfly: ["Zippy", "Shimmer", "Darter", "Glint"],
  fish: ["Bubbles", "Finn", "Splash", "Sunny the Fish"],
  whale: ["Big Blue", "Splashy", "Wavey", "Moby"],
  shark: ["Chompy", "Fin", "Smiley", "Bruce"],
  octopus: ["Inky", "Wiggles", "Ollie", "Squiggle"],
  duck: ["Puddles", "Quackers", "Waddles", "Daffy"],
  swan: ["Grace", "Snowy", "Feathers", "Bella"],
  person: ["Sunny", "Buddy", "Pip", "Rosie"],
  family: ["The Happy Family", "The Sunnies", "The Huggles"],
  robot: ["Bleep", "Sprocket", "Robo", "Gizmo"],
  flower: ["Petal", "Blossom", "Rosie", "Daisy"],
  sunflower: ["Sunny", "Goldie", "Beam", "Sol"],
  tree: ["Old Oak", "Leafy", "Branches", "Willow"],
  bush: ["Bushy", "Shrubby", "Twiggy", "Fern"],
  mushroom: ["Toadstool", "Spotty", "Shroomy", "Button"],
  cactus: ["Spike", "Prickles", "Sandy", "Cacti"],
  house: ["Cosy Cottage", "Home Sweet Home", "Little House", "Sunny Nook"],
  castle: ["Sparkle Castle", "Tall Towers", "Castle Cloud", "Royal Keep"],
  tower: ["Lookout", "Tall Tom", "Sky Tower", "Peak"],
  shop: ["Corner Shop", "Treat Shop", "Happy Market", "Little Store"],
  tent: ["Camp Cosy", "Starry Tent", "Snug Spot", "Adventure Tent"],
  car: ["Zoomy", "Beep", "Speedy", "Red Racer"],
  bus: ["Big Bus", "Bumpy", "Wheels", "Busby"],
  truck: ["Rumble", "Dumpy", "Big Wheels", "Trucky"],
  train: ["Choo-Choo", "Puffer", "Express", "Chuggy"],
  bicycle: ["Pedals", "Wheelie", "Spinny", "Zip"],
  tractor: ["Tilly", "Farmer Fred", "Chugger", "Dusty"],
  boat: ["Sailor", "Bobbin", "Wave Rider", "Little Ship"],
  airplane: ["Skyler", "Jet", "Zoom", "Cloud Hopper"],
  rocket: ["Blastoff", "Star Zoomer", "Comet", "Rocky"],
  balloon: ["Floaty", "Bobble", "Up-Up", "Bubble"],
  helicopter: ["Whirly", "Copter", "Spinner", "Hover"],
  dragon: ["Sparky", "Ember", "Scales", "Puff"],
  unicorn: ["Sparkle", "Twinkle", "Stardust", "Rainbow"],
  monster: ["Grumbles", "Fuzzy", "Snorkel", "Boogle"],
  ghost: ["Boo", "Casper", "Wispy", "Giggles"],
  alien: ["Zorp", "Blip", "Gloop", "Ziggy"],
  fairy: ["Twinkle", "Pixie", "Dewdrop", "Glimmer"],
  cloud: ["Puffy", "Fluff", "Nimbus", "Cotton"],
  star: ["Twinkle", "Shiny", "Stella", "Glow"],
  heart: ["Lovey", "Cuddles", "Sweetie", "Hugs"],
  rainbow: ["Rainbow", "Colours", "Arc", "Bright"],
  sculpture: ["Wonder", "Doodle", "Mystery", "Sparkle"],
};

const GENERIC = ["Doodle", "Scribbles", "Sunny", "Pip", "Wonder", "Buddy"];

/** A friendly default name for `kind`, stable for the same `seed` (e.g. an artwork id). */
export function suggestName(kind: string, seed: string): string {
  const list = BY_KIND[kind] ?? BY_KIND[getKind(kind).id] ?? GENERIC;
  return list[hashString(`name:${kind}:${seed}`) % list.length];
}
