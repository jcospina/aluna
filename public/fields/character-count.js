// @ts-check

/**
 * The counter's words. The server paints the sentence when the field is rendered and the browser
 * repaints it on the first keystroke, so a second copy made a wording change rewrite the counter
 * in front of the person typing. A leaf, because the control that repaints it installs itself.
 *
 * Lengths count UTF-16 code units, the unit native `maxlength` counts.
 *
 * @param {number} limit
 * @param {number} used
 * @returns {string}
 */
export function characterCountSentence(limit, used) {
  const left = limit - used;
  if (left < 0) return `${-left} over the limit`;
  return `${left} character${left === 1 ? "" : "s"} left`;
}
