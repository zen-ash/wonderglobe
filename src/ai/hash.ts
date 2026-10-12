// Tiny, dependency-free string hashing shared by client and server code.
// Used for stable per-character choices (voice, pitch, names) and cache keys.
// NOT cryptographic.

/** 32-bit FNV-1a hash of a string (unsigned). */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministically pick an item from a non-empty list. */
export function pickStable<T>(items: readonly T[], seed: string): T {
  return items[hashString(seed) % items.length];
}

/** Stable number in [0, 1) derived from a seed. */
export function unitHash(seed: string): number {
  return hashString(seed) / 4294967296;
}

/** Hex string of two independent 32-bit hashes (good enough for cache keys). */
export function cacheHash(input: string): string {
  const a = hashString(input).toString(16).padStart(8, "0");
  const b = hashString(`${input.length}:${input}:wg`).toString(16).padStart(8, "0");
  return a + b;
}
