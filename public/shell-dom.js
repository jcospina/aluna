// @ts-check

/**
 * The names the server's markup and the browser's behaviour have to agree on: element ids, the
 * attributes that carry meaning, the sidecar's wire format, and one selector.
 *
 * A leaf on purpose. Their natural homes — `desk-window.js`, `record-view.js`,
 * `collection-count.js`, `search-chrome.js` — each install themselves on import, so reaching one
 * of these names used to mean pulling a self-starting module into whatever wanted the string.
 */

/** The window's content area: the one region a capability's surface is swapped into. */
export const WINDOW_CONTENT_ID = "spec-build-output";

/** Marks the capability currently standing in the window, on a direct child of that region. */
export const ACTIVE_CAPABILITY_ATTRIBUTE = "data-active-capability-id";

/**
 * The attribute a submit control carries the sentence it says while its request is out. The
 * browser reads it back rather than holding its own copy, so renaming a button in one place
 * renames it everywhere it appears — including mid-request.
 */
export const BUSY_LABEL_ATTRIBUTE = "data-busy-label";

/**
 * Where a control keeps its idle text while the busy sentence is showing. Written by whichever
 * side is about to overwrite the label, so neither side has to know what the words were.
 */
export const IDLE_LABEL_ATTRIBUTE = "data-idle-label";

/** How long the collection search waits after a keystroke before it asks the server. */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * What a form opening onto a record puts focus on. `:not([type=hidden])` because every field is
 * preceded by its own `__aluna_present` marker; the last two are drawn choice controls, which are
 * not form elements at all.
 */
export const FIRST_FIELD_SELECTOR =
  "input:not([type=hidden]), textarea, select," +
  " .listbox__button, .segmented button:not([disabled])";

/* A comment, not markup: the fragment enforcer passes one straight through, so a generated
   Handler could open a mutation's answer with a forged sidecar. `readsThisRegion` refuses it. */
export const COLLECTION_COUNT_SIDECAR_PREFIX = "<!--aluna:count:";
export const COLLECTION_COUNT_SIDECAR_SUFFIX = "-->";

/** The attribute the shell finds the collection's count label by. */
export const COLLECTION_COUNT_LABEL_ATTR = "data-capability-count-label";
