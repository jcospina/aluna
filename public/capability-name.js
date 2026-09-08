// @ts-check
// What a capability's name may be, read once for both sides of the boundary.
//
// The rename editor and the registry have to answer this identically, or the editor enables submit
// on a name the server then refuses. They used to hold a copy each, and the copies drifted: the
// server grew a markup rule the browser never got, so `<img src=x onerror=alert(1)>` looked fine
// in the editor. The rule lives here, in the one shape a browser module and `src/registry` can
// both import (`#shell/*.js` in package.json).

/**
 * The longest a capability name may be. The inline rename editor caps the field at the same
 * number the validator refuses past — a `maxlength` the person can feel, rather than a refusal
 * they only meet on submit.
 */
export const MAX_CAPABILITY_LABEL_CHARS = 48;

const MAX_CAPABILITY_LABEL_WORDS = 5;
const SENTENCE_PUNCTUATION = /[.!?]/;
const PRODUCT_VOICE_LABEL_START = /^(?:got it|i.?ll|i will|i.?m|we.?ll|we will|let.?s)\b/i;

/**
 * `<img src=x onerror=alert(1)>` is three words with no sentence punctuation, so every other rule
 * admits it. Angle brackets only: `&`, an apostrophe and a quote belong to real names.
 */
const MARKUP_SHAPED = /[<>]/;

/**
 * A name is one line. `\s+` collapses a break into the word split, so a two-line name counts as
 * few words and every sink that renders one on a line of its own gains a line nobody wrote.
 */
const LINE_BREAK = /[\r\n\u2028\u2029]/;

/**
 * Whether a name is refused for its angle brackets rather than its shape or length. The editor
 * asks so it can say something true about why.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isMarkupShapedName(value) {
  return MARKUP_SHAPED.test(value.trim());
}

/**
 * Whether a typed name is one the registry will take.
 * @param {string} value
 * @returns {boolean}
 */
export function isCapabilityNameLabel(value) {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_CAPABILITY_LABEL_CHARS) return false;
  if (SENTENCE_PUNCTUATION.test(label)) return false;
  // Every sink escapes this label, so this is not what makes it safe. What it refuses is a name
  // that is not a name.
  if (MARKUP_SHAPED.test(label)) return false;
  if (LINE_BREAK.test(label)) return false;
  if (PRODUCT_VOICE_LABEL_START.test(label)) return false;
  return label.split(/\s+/).length <= MAX_CAPABILITY_LABEL_WORDS;
}
