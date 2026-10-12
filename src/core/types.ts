// Shared data shapes used across simulation, rendering, persistence and AI.
// Everything here is plain serialisable data (no Three.js objects).

export type WorldMode = "paper" | "gallery";

/** A unit vector on the planet (surface normal / direction from centre). */
export type Vec3 = [number, number, number];

/** How a creation moves and lives in the world. */
export type Behavior =
  | "walk" // people & walking animals wander on land
  | "hop" // small hoppers (frogs, rabbits) – walk with big hops
  | "fly" // birds, planes – curved paths in the sky
  | "flutter" // butterflies, bees, insects
  | "swim" // fish – must live in water
  | "float" // ducks, boats – bob on the water surface
  | "drive" // vehicles travel along land
  | "grow" // plants root, grow and sway
  | "build" // houses become paper buildings
  | "hover" // balloons, clouds, ghosts drift in the air
  | "still"; // sculptures that rock gently in place

export type Facing = "left" | "right" | "none";

export type KindCategory = "animal" | "plant" | "building" | "person" | "vehicle" | "imaginary" | "thing";

export type GroundType = "grass" | "sand" | "rock" | "water" | "snow" | "path";

/** Polygon in cut-out pixel space (x right, y down). */
export type Polygon = Array<[number, number]>;

/** Result of turning a picture into a paper cut-out. */
export interface CutoutMeta {
  /** Cut-out bitmap size in pixels (includes white border & outline). */
  width: number;
  height: number;
  /** Outer silhouettes (one per separate piece), simplified, in cut-out pixel space. */
  polygons: Polygon[];
  /** Anchor point (where it touches the ground) in normalised 0..1 cut-out coords. */
  anchor: [number, number];
  /** width / height */
  aspect: number;
  /** Fraction of the cut-out box covered by the silhouette (0..1). */
  coverage: number;
  /** Dominant colours of the artwork (hex), most common first. */
  palette: string[];
  /** For buildings: the normalised y (0 top..1 bottom) where the roof meets the walls. */
  roofLine: number;
}

export type ArtworkSource = "drawing" | "upload" | "sample";

/** Stored artwork: original picture + generated cut-out. Blobs live in IndexedDB. */
export interface ArtworkRecord {
  id: string;
  /** SHA-256 of the decoded original pixels – never derived from a filename. */
  contentHash: string;
  source: ArtworkSource;
  /** Label for samples only (e.g. "Sample: Fish"). Never used for uploads. */
  sampleLabel?: string;
  original: Blob;
  cutout: Blob;
  meta: CutoutMeta;
  /** Original picture size. */
  originalWidth: number;
  originalHeight: number;
  createdAt: number;
}

export interface ChatLine {
  role: "player" | "character";
  text: string;
  /** Where a character reply came from – shown honestly in the UI. */
  via?: "ai" | "local";
  at: number;
}

/** A drawing that came to life in the Living Paper World. */
export interface CreationRecord {
  id: string;
  artworkId: string;
  kind: string;
  name: string;
  behavior: Behavior;
  facing: Facing;
  /** Who decided what it is. */
  classifiedBy: "ai" | "player";
  /** Unit vector of its home/current location. */
  position: Vec3;
  /** Unit tangent heading. */
  heading: Vec3;
  createdAt: number;
  chat: ChatLine[];
}

export const NOTE_COLORS = ["#ffe066", "#ff9fb2", "#9be7a4", "#9fd3ff", "#ffbf6b"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface StickyNote {
  id: string;
  color: string;
  text: string;
  createdAt: number;
}

/** A picture hanging on an easel in the Miniature Gallery World. */
export interface EaselRecord {
  id: string;
  artworkId: string;
  title: string;
  artist: string;
  story: string;
  notes: StickyNote[];
  position: Vec3;
  heading: Vec3;
  createdAt: number;
}

export interface PlayerSave {
  position: Vec3;
  heading: Vec3;
}

export interface WorldSave {
  version: 1;
  mode: WorldMode;
  seed: number;
  createdAt: number;
  updatedAt: number;
  player: PlayerSave;
  creations: CreationRecord[];
  easels: EaselRecord[];
  /** Region ids the player has visited (for the little discovery map). */
  visited: string[];
  /** Sticker ids earned in the sticker book. */
  stickers?: string[];
  /** Guide quest progress (ids of completed quests, the active one). */
  quests?: QuestProgress;
  /** Collectible ids already found in this world. */
  found?: string[];
  /** The child's own drawing used as their player character (artwork id). */
  playerArtworkId?: string | null;
  /** Whether the first-time guided introduction has been completed or skipped. */
  onboarded?: boolean;
}

export interface QuestProgress {
  completed: string[];
  active: string | null;
}

export interface Preferences {
  music: boolean;
  musicVolume: number;
  sound: boolean;
  soundVolume: number;
  voice: boolean;
  reducedMotion: boolean;
  lightGraphics: boolean;
  lastMode: WorldMode | null;
  playerName: string;
  /** Day/night: a gentle cycle, the device's real clock, or always daytime. */
  timeMode: "cycle" | "real" | "day";
}

export const DEFAULT_PREFERENCES: Preferences = {
  music: true,
  musicVolume: 0.5,
  sound: true,
  soundVolume: 0.7,
  voice: true,
  reducedMotion: false,
  lightGraphics: false,
  lastMode: null,
  playerName: "",
  timeMode: "cycle",
};

/** What the server says it can do (never contains secrets). */
export interface ServiceStatus {
  recognition: boolean;
  dialogue: boolean;
  voice: boolean;
  sounds: boolean;
  transcription: boolean;
}

export const NO_SERVICES: ServiceStatus = {
  recognition: false,
  dialogue: false,
  voice: false,
  sounds: false,
  transcription: false,
};
