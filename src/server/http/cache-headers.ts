// The cache policies the platform's own routes answer with. A leaf.

/** For an answer no cache may keep: a refusal, an absence, anything true only for now. */
export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * A year is the longest age HTTP defines, and `immutable` stops even a reload revalidating. Only
 * for an address whose bytes can never change.
 */
export const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" } as const;
