// Offline character replies: simple keyword matching + templates using the
// kind's sound, the character's name and where it lives. Callers must label
// these `via: "local"` — they are never presented as AI.

import { getKind, type KindInfo } from "@/core/kinds";
import type { ChatCharacter } from "./schemas";
import { hashString } from "./hash";

type Intent =
  | "hello"
  | "bye"
  | "thanks"
  | "name"
  | "howareyou"
  | "food"
  | "play"
  | "where"
  | "love"
  | "what"
  | "question"
  | "other";

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ["bye", /\b(bye|goodbye|see you|good ?night|later)\b/],
  ["thanks", /\b(thanks|thank you|thx)\b/],
  ["howareyou", /\b(how are (you|u)|how do you feel|are you (ok|okay|happy|sad)|how's it going)\b/],
  ["name", /\b(your name|who are (you|u)|what are you called|whats your name|what's your name)\b/],
  ["food", /\b(eat|food|hungry|snack|lunch|dinner|breakfast|yummy|favou?rite food|drink)\b/],
  ["play", /\b(play|game|fun|race|dance|jump|tag|hide|seek|let's|lets)\b/],
  ["where", /\b(where|live|home|place|from)\b/],
  ["love", /\b(love|like you|best friend|friend|hug|cute|pretty|beautiful|cool)\b/],
  ["what", /\b(what (do|can) you do|what are you|can you)\b/],
  ["hello", /\b(hi|hello|hey|hiya|howdy|yo|good morning)\b/],
];

export function detectIntent(message: string): Intent {
  const m = message.toLowerCase().replace(/[’']/g, "'");
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(m)) return intent;
  return m.includes("?") ? "question" : "other";
}

type Lines = Partial<Record<Intent, string[]>>;

function fill(template: string, c: ChatCharacter, k: KindInfo): string {
  const region = c.region?.trim() || "meadow";
  return template
    .replaceAll("{name}", c.name)
    .replaceAll("{sound}", k.sound)
    .replaceAll("{label}", k.label.toLowerCase())
    .replaceAll("{region}", region)
    .replaceAll("{title}", c.title?.trim() || "my picture")
    .replaceAll("{artist}", c.artist?.trim() || "a wonderful artist");
}

const ANIMAL: Lines = {
  hello: ["{sound} Hello, friend! I'm so happy you came to the {region}!", "{sound} Hi hi! Want to explore with me?"],
  bye: ["{sound} Bye-bye! Come back soon!", "{sound} See you later, friend!"],
  thanks: ["{sound} You're welcome! You're very kind."],
  name: ["{sound} I'm {name}! A child drew me, and now I'm alive!", "{sound} My name is {name}. Nice to meet you!"],
  howareyou: ["{sound} I feel super happy today! How about you?", "{sound} I'm great! The {region} is lovely today."],
  food: ["{sound} I love yummy snacks! Maybe some berries from the {region}?", "{sound} Ooh, food! I'm a little bit hungry now."],
  play: ["{sound} Yes, let's play! Can you follow me around the {region}?", "{sound} I love games! Tag, you're it!"],
  where: ["{sound} I live right here in the {region}! Isn't it pretty?", "{sound} My home is the {region} on this tiny planet."],
  love: ["{sound} Aww, you're my friend too!", "{sound} That makes my paper heart go flutter!"],
  what: ["{sound} I can explore the {region} and make new friends!"],
  question: ["{sound} Hmm, good question! What do you think?", "{sound} Ooh, I wonder about that too!"],
  other: ["{sound} Wow, really? Tell me more!", "{sound} That sounds fun!", "{sound} You're so interesting!"],
};

const PLANT: Lines = {
  hello: ["Hello, little friend! I'm growing tall in the {region}.", "{sound} Welcome to my sunny spot!"],
  bye: ["Goodbye! I'll keep growing while you're away!"],
  thanks: ["Thank you! I'll share a little sunshine with you."],
  name: ["I'm {name}, a {label} with roots in the {region}!"],
  howareyou: ["I feel sunny and green! The rain gave me a drink today.", "I'm swaying happily in the breeze!"],
  food: ["I drink rain and eat sunshine. Yum!", "Sunlight is my favourite snack!"],
  play: ["I can't run, but I can wave my leaves at you!", "Let's play I-spy! I spy something green… me!"],
  where: ["I'm planted right here in the {region}. The bugs visit me every day!"],
  love: ["You make my petals blush!", "Aww! A hug from you helps me grow!"],
  what: ["I grow, I sway, and I give the bees somewhere to rest!"],
  question: ["Hmm, the wind whispered the answer, but I forgot! What do you think?"],
  other: ["{sound} The bees told me the same thing!", "How lovely! Tell me more while I grow."],
};

const BUILDING: Lines = {
  hello: ["{sound} Hello! My door is always open for friends.", "Welcome to the {region}! Come in, come in!"],
  bye: ["Goodbye! I'll keep a light on for you!"],
  thanks: ["You're welcome! Wipe your feet on the way in!"],
  name: ["I'm {name}! I'm the cosiest {label} in the {region}."],
  howareyou: ["I feel cosy and warm inside!", "My windows are sparkly today, so I feel great!"],
  food: ["My kitchen smells like warm cookies today!", "There's soup bubbling inside me!"],
  play: ["You can play hide and seek in my rooms!", "Let's pretend my top window is a lookout!"],
  where: ["I stand right here in the {region}. From my windows I can see the whole planet!"],
  love: ["Aww! You make me feel like home!"],
  what: ["I keep everyone cosy and dry. Little mice live in my attic!"],
  question: ["Hmm! Let me ask the mice in my attic. They know everything!"],
  other: ["{sound} What a lovely thing to say!", "Ooh! I'll tell my windows about that!"],
};

const VEHICLE: Lines = {
  hello: ["{sound} Hello! Want to go on an adventure?", "{sound} Hop on, friend!"],
  bye: ["{sound} Bye-bye! I'll zoom back soon!"],
  thanks: ["{sound} You're welcome! Safe travels!"],
  name: ["{sound} I'm {name}, the zoomiest {label} around!"],
  howareyou: ["{sound} I'm full of zoom today!", "{sound} My wheels feel happy!"],
  food: ["I drink sunshine fuel! Vroom!", "Snacks? I'd love a big tank of rainbow juice!"],
  play: ["{sound} Let's race around the {region}!", "{sound} Ready, steady, go!"],
  where: ["I travel all over the planet! Right now I'm in the {region}."],
  love: ["{sound} You're my favourite passenger!"],
  what: ["I can take you anywhere on this little planet!"],
  question: ["{sound} Hmm, let's drive around and find out!"],
  other: ["{sound} Wheee! That's awesome!", "{sound} Let's go see!"],
};

const MAGIC: Lines = {
  hello: ["{sound} Hello, friend! I came out of a drawing!", "{sound} Hi! Want to see some magic?"],
  bye: ["{sound} Goodbye! I'll sparkle until you're back!"],
  thanks: ["{sound} You're welcome! Magic hugs!"],
  name: ["{sound} I'm {name}! I'm one of a kind!"],
  howareyou: ["{sound} I feel magical today!", "{sound} Tingly and twinkly, thank you!"],
  food: ["I eat cloud candy and star sprinkles!", "Rainbow pancakes are my favourite!"],
  play: ["{sound} Let's play make-believe in the {region}!", "{sound} Catch me if you can!"],
  where: ["I was drawn on paper, and now I live in the {region}!"],
  love: ["{sound} You're magical too!", "{sound} Best friends forever!"],
  what: ["{sound} I can do a little bit of magic. Shh, it's a secret!"],
  question: ["{sound} That's a mystery! Shall we find out together?"],
  other: ["{sound} Ooh, how wonderful!", "{sound} Tell me more, tell me more!"],
};

const PERSON: Lines = {
  ...ANIMAL,
  food: ["I love sandwiches! What's your favourite food?", "Mmm, I'd love some fruit from the {region}!"],
  where: ["I live here in the {region}! It's my favourite place."],
};

const GALLERY: Lines = {
  hello: ["Hello! I'm \"{title}\". Thank you for visiting me!", "Welcome to the gallery! Come take a close look at me."],
  bye: ["Goodbye! I'll hang right here, waiting for you!"],
  thanks: ["You're welcome! Every visitor makes my colours brighter."],
  name: ["I'm a picture called \"{title}\", made by {artist}!"],
  howareyou: ["I feel colourful and proud on my easel!"],
  food: ["Pictures don't eat, but I do love a fresh coat of colour!"],
  play: ["Let's play I-spy! Can you find all my colours?"],
  where: ["I'm hanging on an easel in the {region} of the gallery."],
  love: ["Thank you! {artist} put lots of love into me."],
  what: ["I'm a picture! Look closely and you'll see lots of little details."],
  question: ["Good question! Maybe {artist} knows the answer!"],
  other: ["What a lovely thing to say!", "Do you like my colours? {artist} chose them!"],
};

function linesFor(c: ChatCharacter, k: KindInfo): Lines {
  if (c.mode === "gallery") return GALLERY;
  switch (k.category) {
    case "animal":
      return ANIMAL;
    case "plant":
      return PLANT;
    case "building":
      return BUILDING;
    case "vehicle":
      return VEHICLE;
    case "person":
      return PERSON;
    default:
      return MAGIC;
  }
}

/** A friendly offline reply. Deterministic for the same character/message/turn. */
export function localReply(
  character: ChatCharacter,
  message: string,
  history: ReadonlyArray<{ role: "player" | "character"; text: string }> = [],
): string {
  const kind = getKind(character.kind);
  const lines = linesFor(character, kind);
  const intent = detectIntent(message);
  let options = lines[intent] ?? lines.other ?? ["{sound} Hello!"];

  if (character.mode === "gallery" && character.story && (intent === "what" || intent === "question" || intent === "other")) {
    options = [...options, `My story? ${character.story.trim().slice(0, 120)}`];
  }

  const seed = `${character.id}|${message.trim().toLowerCase()}|${history.length}`;
  let choice = options[hashString(seed) % options.length];

  // Avoid repeating the previous character line verbatim.
  const last = [...history].reverse().find((t) => t.role === "character")?.text;
  if (options.length > 1 && last && fill(choice, character, kind) === last) {
    choice = options[(options.indexOf(choice) + 1) % options.length];
  }
  return fill(choice, character, kind).replace(/\s+/g, " ").trim();
}
