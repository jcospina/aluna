// @ts-check
/**
 * A press that only reaches a window.
 *
 * Two surfaces stand windows — the product's desk and this handbook's demo of one — and on both
 * of them a press raises whatever it lands on. The browser reads that same press as the start of
 * a selection, so moving between windows leaves a word highlighted in each one passed through.
 * The refusal lives here rather than beside each desk, for the reason the gestures live in
 * `window-gestures.js`: two copies drift apart the moment one of them is corrected.
 */

/**
 * What a press must reach whole. `.field__control` is the shell a text control is drawn on
 * (`src/presentation/fields/field-chrome.ts`), so a press on its padding is still a press at the
 * field, and only a real `mousedown` puts a caret where the person pressed.
 */
const FIELDS = "input, textarea, .field__control";

/**
 * Refuse a press that was only reaching, so it raises the window and chooses nothing inside it.
 * Cancelling `pointerdown` suppresses the `mousedown` whose default action starts a selection;
 * `click` still fires, so a lamp or a record in the window behind does what it always did. The
 * rest of that default action is kept by hand: an old highlight is dropped and the caret gives
 * up the window it was left in, which is what the press the browser lost would have done.
 *
 * @param {PointerEvent} press
 * @param {boolean} behind whether the window was behind before this press reached it
 * @returns {boolean} whether the press was refused
 */
export function refusePress(press, behind) {
  /* A finger is refused nothing. A tap drags no selection out of a window, and WebKit drops the
   * `click` of a cancelled touch press, which would cost the first tap on a window behind. */
  if (!behind || press.pointerType !== "mouse" || press.button !== 0) return false;
  const target = /** @type {Element | null} */ (press.target);
  if (target?.closest?.(FIELDS)) return false;
  press.preventDefault();
  const view = press.view;
  view?.getSelection?.()?.removeAllRanges();
  const held = /** @type {HTMLElement | null} */ (view?.document?.activeElement ?? null);
  if (held && held !== view?.document?.body) held.blur?.();
  return true;
}
