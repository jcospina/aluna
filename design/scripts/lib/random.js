// @ts-check
/**
 * Seeded randomness and smooth value noise.
 *
 * The one rule that matters here: the noise is smooth and periodic.
 * Per-point randomness is sandpaper — the deviation has to be low-frequency
 * value noise that meets itself at the seam, or a frame reads as corroded
 * rather than as drawn.
 */

/**
 * A small, fast, seedable PRNG. Same seed, same hand, every time.
 *
 * @param {number} a seed
 * @returns {() => number} successive values in [0, 1)
 */
export function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smoothstep — what keeps the interpolation from showing its lattice.
 *
 * @param {number} t
 * @returns {number}
 */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Value noise around a closed ring, sampled at arbitrary phases.
 *
 * The phase is given rather than assumed even, which is the whole reason this
 * exists. Spacing the lattice evenly by arc length means a box's short edges get
 * whatever fraction of a cycle their share of the perimeter allows — on a 220×36
 * field that is 14% of the ring across two edges, so they come out straight
 * while the long ones look drawn. Handing in phase lets the caller give each
 * edge its own budget of cycles, and it still closes: phase 1 is phase 0.
 *
 * @param {readonly number[]} phases positions round the ring, in [0, 1)
 * @param {number} lattice control points around the ring
 * @param {number} seed
 * @returns {number[]} one value in [-1, 1] per phase
 */
export function ringNoiseAt(phases, lattice, seed) {
  const rnd = mulberry32(seed);
  const size = Math.max(3, Math.round(lattice));
  const base = Array.from({ length: size }, () => rnd() * 2 - 1);
  return phases.map((phase) => {
    const t = ((((phase % 1) + 1) % 1) * size) % size;
    const i0 = Math.floor(t) % size;
    const i1 = (i0 + 1) % size;
    const s = smooth(t - Math.floor(t));
    /* Both indices are taken mod `size`, so neither fallback is reachable. */
    return (base[i0] ?? 0) * (1 - s) + (base[i1] ?? 0) * s;
  });
}

/**
 * Value noise around a closed ring at even spacing — {@link ringNoiseAt} for a
 * caller with nothing to say about phase.
 *
 * @param {number} n samples wanted
 * @param {number} lattice control points around the ring
 * @param {number} seed
 * @returns {number[]} n values in [-1, 1]
 */
export function ringNoise(n, lattice, seed) {
  return ringNoiseAt(
    Array.from({ length: n }, (_, i) => i / n),
    lattice,
    seed,
  );
}

/**
 * Value noise along an open run. Unlike `ringNoise` the ends are free, which
 * is what lets a single edge start and stop somewhere other than true.
 *
 * @param {number} n samples wanted
 * @param {number} lattice control points along the run
 * @param {number} seed
 * @returns {number[]} n values in [-1, 1]
 */
export function lineNoise(n, lattice, seed) {
  const rnd = mulberry32(seed);
  const size = Math.max(2, Math.ceil(lattice) + 2);
  const base = Array.from({ length: size }, () => rnd() * 2 - 1);
  /** @type {number[]} */
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1 || 1)) * (size - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(size - 1, i0 + 1);
    const s = smooth(t - i0);
    /* `t` never exceeds `size - 1`, so neither fallback is reachable. */
    out[i] = (base[i0] ?? 0) * (1 - s) + (base[i1] ?? 0) * s;
  }
  return out;
}

/**
 * A stable seed from a string, so a capability's hand follows its name.
 *
 * @param {string} text
 * @returns {number}
 */
export function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}
