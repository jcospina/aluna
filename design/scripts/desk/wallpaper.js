// @ts-check
/**
 * The wallpaper.
 *
 * No longer a placeholder. What stood here was a stand-in — four flat bands, a
 * sun and one schematic tree, drawn to the settled direction so the desk could
 * be judged over something other than a flat fill while the artwork did not
 * exist. It exists, and this is it.
 *
 * It answers what the direction left open: the horizon sits **low**, a little
 * under halfway, which is what leaves the upper half quiet enough for logos to
 * be legible against it. It is **fixed** — it does not pan and does not shift
 * with time of day. Both were open questions and both are now decided by the
 * image itself rather than by this file.
 *
 * The artwork obeys the method the rest of the surface does, which is why it
 * sits under the windows without arguing with them: flat vivid fills, ink
 * hairlines around every shape, no gradients and no texture. The one thing it
 * does that the stand-in could not is carry detail — grass, foliage, bark — and
 * that is exactly why the shadow over it goes to 40%.
 */

/** 2560×1440, ~360KB. Wider than any desk; `cover` does the rest. */
const WALLPAPER = "assets/wallpaper/high-meadow.webp";

/** The wallpaper as a CSS `url()`, ready for `background-image`. */
export function wallpaperUrl() {
  return `url("${WALLPAPER}")`;
}
