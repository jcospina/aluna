// @ts-check
/**
 * The settled specification of the drawn line, in one place. `index.html` reads
 * these back under *The window* rather than restating them.
 */

/**
 * Where the second pass lands relative to the first: across, then down.
 * @typedef {readonly [number, number]} PassOffset
 */

/**
 * How many waves one edge may carry, as `[fewest, most]`.
 *
 * The wavelength sets the rate; the floor exists because a box is not one length.
 * On a 220×36 field the lateral edges are 14% of the perimeter, so a wave tuned for
 * the top is spent before it reaches the sides — the floor lifts a short edge to one
 * gentle bow instead. `most` is `Infinity` on every hand that goes round a ring: a
 * cap does not calm a long edge, it stretches its wave into a straight line that
 * misses.
 * @typedef {readonly [number, number]} CycleBounds
 */

/**
 * One hand — how hard the line is pressed. Amplitude, rate and spread, never
 * weight: every line on the surface is 2px whichever hand drew it.
 * @typedef {{ deviation: number, wavelength: number, cycles: CycleBounds,
 *             passOffset: PassOffset }} Hand
 */

export const SPEC = Object.freeze({
  /** Every line, no exceptions. There is no weight ladder. */
  weight: /** @type {number} */ (2),

  /** px amplitude the path deviates from true, in the full hand. */
  deviation: 0.9,

  /** px wavelength of that deviation. Smooth, low-frequency, periodic. */
  wavelength: 58,

  /** Second pass lands +0.7 across, +0.56 down. */
  passOffset: /** @type {PassOffset} */ ([0.7, 0.56]),

  /** Opacity of each pass. Both equal; where they overlap, one solid line. */
  passInk: 0.74,

  /** The second pass runs 15% further through the frame than the first. */
  pass2Reach: 1.15,

  /** px each side the title-bar rule runs through the frame. */
  dividerReach: 5,

  /** Mitred. Four edges meet and stop. Every corner on the surface. */
  radius: 0,

  /**
   * Sampling step along a path, in px. Must stay well below the shortest wave in
   * play: a spline given two points per cycle draws the chord across the wave, not
   * the wave. Changes fidelity only — nothing about the hand is derived from it.
   */
  step: 4,

  /**
   * The shortest wave any run may be pushed to, in px. Without it the floor in
   * `cycles` would force a tiny run — a chip's corner arc — into a wave a few pixels
   * long, which reads as sandpaper. Below this a run simply gets less than one cycle.
   */
  minWave: 9,

  /** Room the SVG needs outside the window box for shadow and overhang. */
  bleed: 14,
});

/**
 * The hands. The line treatment is the same everywhere — mitred, deviating, inked
 * twice; what changes is how hard it is pressed.
 *
 * This is a hierarchy device and deliberately NOT a weight ladder: every line is
 * still 2px, and only the amplitude and the spread between passes step down, which
 * is what lets a window read as being in front of its contents without its frame
 * getting thicker. Each step down shortens the wavelength too, because a long
 * wavelength on a short edge reads as a bowed rectangle rather than a lighter hand.
 */
export const HAND = Object.freeze({
  /** Windows, the prompt rail — the things that hold other things. */
  frame: /** @type {Hand} */ (
    Object.freeze({
      deviation: 0.9,
      wavelength: 58,
      /* The only capped hand: a 600px window edge lands on ten waves of its own
       * accord, and the cap stops a maximised window going further. Neither bound
       * binds at the ordinary size. */
      cycles: Object.freeze(/** @type {CycleBounds} */ ([1.5, 11])),
      passOffset: Object.freeze(/** @type {PassOffset} */ ([0.7, 0.56])),
    })
  ),

  /**
   * Everything drawn at component scale inside a frame, and the logo tile. Subtler,
   * never absent. Uncapped: the wavelength is the rate at every length, and the
   * floor is what a 36px control edge needs to get its one bow.
   */
  fine: /** @type {Hand} */ (
    Object.freeze({
      deviation: 0.45,
      wavelength: 42,
      cycles: Object.freeze(/** @type {CycleBounds} */ ([1.3, Number.POSITIVE_INFINITY])),
      passOffset: Object.freeze(/** @type {PassOffset} */ ([0.4, 0.32])),
    })
  ),

  /**
   * The third hand, for small parts: a checkbox, a radio, a lamp, a swatch —
   * everything under about 24px. What separates it from the fine hand is amplitude,
   * not wavelength: 0.45px is 2% of a 22px box against 0.15% of a window, so the fine
   * hand on a checkbox reads as a dented square rather than a lighter hand.
   */
  close: /** @type {Hand} */ (
    Object.freeze({
      deviation: 0.28,
      wavelength: 20,
      cycles: Object.freeze(/** @type {CycleBounds} */ ([1.2, Number.POSITIVE_INFINITY])),
      passOffset: Object.freeze(/** @type {PassOffset} */ ([0.3, 0.24])),
    })
  ),
});

/**
 * Everything drawn in the fine hand asks through this rather than reading
 * `HAND.fine` directly, so the components and the logos stay demonstrably one hand
 * rather than two that happen to match.
 */
export const fineHand = () => HAND.fine;

/** Hard offset shadow, in px. Displacement, never blur. */
export const SHADOW_OFFSET = Object.freeze({ x: 5, y: 6 });
