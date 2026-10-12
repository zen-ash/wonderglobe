// zod schemas for everything Wonderglobe persists or imports.
// These are the *strict* shapes; ./repair.ts gently coerces messy data into them.

import { z } from "zod";
import type { ChatLine, CreationRecord, CutoutMeta, EaselRecord, Preferences, QuestProgress, StickyNote, Vec3, WorldSave } from "@/core/types";

export const LIMITS = {
  idLength: 100,
  nameLength: 40,
  titleLength: 60,
  artistLength: 40,
  storyLength: 600,
  noteTextLength: 140,
  noteColorLength: 16,
  chatLineLength: 400,
  chatLines: 20,
  notesPerEasel: 40,
  creations: 300,
  easels: 200,
  visited: 500,
  visitedIdLength: 60,
  /** Sticker / quest / collectible ids. */
  progressIdLength: 60,
  stickers: 200,
  quests: 200,
  found: 200,
  playerNameLength: 40,
  sampleLabelLength: 60,
  contentHashLength: 128,
  /** Unique artworks a world can reference (creations + easels). */
  artworks: 500,
  polygons: 64,
  polygonPoints: 4096,
  palette: 16,
  imageDimension: 16384,
} as const;

/** How far from length 1 a stored unit vector may be. */
export const UNIT_TOLERANCE = 1e-3;

const finite = z.number().refine(Number.isFinite, "must be finite");

export const Vec3Schema = z.tuple([finite, finite, finite]);

export const UnitVec3Schema = Vec3Schema.refine(
  (v) => Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) <= UNIT_TOLERANCE,
  "must be a unit vector",
);

export const WorldModeSchema = z.enum(["paper", "gallery"]);

export const BehaviorSchema = z.enum([
  "walk",
  "hop",
  "fly",
  "flutter",
  "swim",
  "float",
  "drive",
  "grow",
  "build",
  "hover",
  "still",
]);

export const FacingSchema = z.enum(["left", "right", "none"]);

export const ArtworkSourceSchema = z.enum(["drawing", "upload", "sample"]);

const idSchema = z.string().min(1).max(LIMITS.idLength);

export const CutoutMetaSchema = z.object({
  width: finite.positive(),
  height: finite.positive(),
  polygons: z.array(z.array(z.tuple([finite, finite])).max(LIMITS.polygonPoints)).max(LIMITS.polygons),
  anchor: z.tuple([finite, finite]),
  aspect: finite.positive(),
  coverage: finite.min(0).max(1),
  palette: z.array(z.string().max(32)).max(LIMITS.palette),
  roofLine: finite.min(0).max(1),
});

export const ChatLineSchema = z.object({
  role: z.enum(["player", "character"]),
  text: z.string().max(LIMITS.chatLineLength),
  via: z.enum(["ai", "local"]).optional(),
  at: finite,
});

export const StickyNoteSchema = z.object({
  id: idSchema,
  color: z.string().max(LIMITS.noteColorLength),
  text: z.string().max(LIMITS.noteTextLength),
  createdAt: finite,
});

export const CreationRecordSchema = z.object({
  id: idSchema,
  artworkId: idSchema,
  kind: z.string().min(1).max(LIMITS.idLength),
  name: z.string().max(LIMITS.nameLength),
  behavior: BehaviorSchema,
  facing: FacingSchema,
  classifiedBy: z.enum(["ai", "player"]),
  position: UnitVec3Schema,
  heading: UnitVec3Schema,
  createdAt: finite,
  chat: z.array(ChatLineSchema).max(LIMITS.chatLines),
});

export const EaselRecordSchema = z.object({
  id: idSchema,
  artworkId: idSchema,
  title: z.string().max(LIMITS.titleLength),
  artist: z.string().max(LIMITS.artistLength),
  story: z.string().max(LIMITS.storyLength),
  notes: z.array(StickyNoteSchema).max(LIMITS.notesPerEasel),
  position: UnitVec3Schema,
  heading: UnitVec3Schema,
  createdAt: finite,
});

const progressId = z.string().min(1).max(LIMITS.progressIdLength);

export const QuestProgressSchema = z.object({
  completed: z.array(progressId).max(LIMITS.quests),
  active: progressId.nullable(),
});

export const PlayerSaveSchema = z.object({
  position: UnitVec3Schema,
  heading: UnitVec3Schema,
});

export const WorldSaveSchema = z.object({
  version: z.literal(1),
  mode: WorldModeSchema,
  seed: z.number().int().min(0).max(0x7fffffff),
  createdAt: finite,
  updatedAt: finite,
  player: PlayerSaveSchema,
  creations: z.array(CreationRecordSchema).max(LIMITS.creations),
  easels: z.array(EaselRecordSchema).max(LIMITS.easels),
  visited: z.array(z.string().max(LIMITS.visitedIdLength)).max(LIMITS.visited),
  stickers: z.array(progressId).max(LIMITS.stickers).optional(),
  quests: QuestProgressSchema.optional(),
  found: z.array(progressId).max(LIMITS.found).optional(),
  playerArtworkId: idSchema.nullable().optional(),
  onboarded: z.boolean().optional(),
});

export const PreferencesSchema = z.object({
  music: z.boolean(),
  musicVolume: finite.min(0).max(1),
  sound: z.boolean(),
  soundVolume: finite.min(0).max(1),
  voice: z.boolean(),
  reducedMotion: z.boolean(),
  lightGraphics: z.boolean(),
  lastMode: WorldModeSchema.nullable(),
  playerName: z.string().max(LIMITS.playerNameLength),
  timeMode: z.enum(["cycle", "real", "day"]),
});

// ---------------------------------------------------------------------------
// Export file

export const EXPORT_FORMAT = "wonderglobe-world" as const;
export const EXPORT_VERSION = 1 as const;
export const EXPORT_EXTENSION = ".wonderglobe.json";

export const ORIGINAL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const CUTOUT_IMAGE_TYPES = ["image/png"] as const;

export const ExportedArtworkSchema = z.object({
  id: idSchema,
  contentHash: z.string().min(1).max(LIMITS.contentHashLength),
  source: ArtworkSourceSchema,
  sampleLabel: z.string().max(LIMITS.sampleLabelLength).optional(),
  meta: CutoutMetaSchema,
  originalWidth: z.number().int().positive().max(LIMITS.imageDimension),
  originalHeight: z.number().int().positive().max(LIMITS.imageDimension),
  createdAt: finite,
  /** data: URL (png | jpeg | webp, base64). Validated separately. */
  original: z.string().startsWith("data:"),
  /** data: URL (png, base64). Validated separately. */
  cutout: z.string().startsWith("data:"),
});

/**
 * Envelope of a `.wonderglobe.json` file. `world` is left as unknown here – it is
 * run through the gentle repair pipeline (which ends in WorldSaveSchema).
 */
export const ExportFileEnvelopeSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: finite,
  mode: WorldModeSchema,
  world: z.unknown(),
  artworks: z.array(ExportedArtworkSchema).max(LIMITS.artworks),
});

export const ExportFileSchema = ExportFileEnvelopeSchema.extend({ world: WorldSaveSchema });

export type ExportedArtwork = z.infer<typeof ExportedArtworkSchema>;
export type ExportFile = z.infer<typeof ExportFileSchema>;

// ---------------------------------------------------------------------------
// Compile-time checks that the schemas agree with the shared types.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function assertTrue<T extends true>(): T | void {}
assertTrue<Same<z.infer<typeof Vec3Schema>, Vec3>>();
assertTrue<Same<z.infer<typeof CutoutMetaSchema>, CutoutMeta>>();
assertTrue<Same<z.infer<typeof ChatLineSchema>, ChatLine>>();
assertTrue<Same<z.infer<typeof StickyNoteSchema>, StickyNote>>();
assertTrue<Same<z.infer<typeof CreationRecordSchema>, CreationRecord>>();
assertTrue<Same<z.infer<typeof EaselRecordSchema>, EaselRecord>>();
assertTrue<Same<z.infer<typeof QuestProgressSchema>, QuestProgress>>();
assertTrue<Same<z.infer<typeof WorldSaveSchema>, WorldSave>>();
assertTrue<Same<z.infer<typeof PreferencesSchema>, Preferences>>();
