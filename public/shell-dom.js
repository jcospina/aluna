// @ts-check

/**
 * The names the server and the browser have to agree on: element ids, the attributes that carry
 * meaning, the sidecar's wire format, one selector, and the header an upload names its file in.
 *
 * A leaf on purpose. Their natural homes — `desk-window.js`, `record-view.js`,
 * `collection-count.js`, `search-chrome.js` — each install themselves on import, so reaching one
 * of these names used to mean pulling a self-starting module into whatever wanted the string.
 */

/** The window's content area: the one region a capability's surface is swapped into. */
export const WINDOW_CONTENT_ID = "spec-build-output";

/**
 * The attribute a run's narration carries its job id on. The desk finds a running build by it,
 * `leaving-a-run.js` cancels through it, and the question path's own two triggers reach the read
 * scope the same way — so a rename in the server's markup alone silently ends all three.
 */
export const BUILD_JOB_ID_ATTRIBUTE = "data-build-job-id";

/** The field a sentence is typed into, which the bar guards and the desk gives focus back to. */
export const PROMPT_FIELD_ID = "spec-build-prompt";

/** Where the prompt bar says what happened to the sentence that was typed into it. */
export const PROMPT_NOTICE_ID = "prompt-notice";

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

/** The header an upload names its file in, percent-encoded: a header cannot carry `日本.jpg`. */
export const FILE_NAME_HEADER = "x-file-name";

/**
 * What the server draws on a file field for the product's half of it (`file-field.js`): where its
 * upload goes, the cap and the sentence a file over it earns, and the one input it posts, with the
 * key it was drawn holding, the value that clears it, and whether it may be left empty.
 */
export const FILE_FIELD_ATTRIBUTES = Object.freeze({
  upload: "data-file-upload",
  cap: "data-file-cap",
  oversize: "data-file-oversize",
  value: "data-file-value",
  heldKey: "data-file-held-key",
  clearValue: "data-file-clear-value",
  required: "data-file-required",
});

/** How long the collection search waits after a keystroke before it asks the server. */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * What a form opening onto a record puts focus on. `:not([type=hidden])` because every field is
 * preceded by its own `__aluna_present` marker, and `:not([hidden])` for the picker a file field
 * keeps out of sight. The rest are drawn controls, which are not form elements at all.
 */
export const FIRST_FIELD_SELECTOR =
  "input:not([type=hidden]):not([hidden]), textarea, select," +
  " .listbox__button, .segmented button:not([disabled]), [data-file-focus]";

/* A comment, not markup: the fragment enforcer passes one straight through, so a generated
   Handler could open a mutation's answer with a forged sidecar. `readsThisRegion` refuses it. */
export const COLLECTION_COUNT_SIDECAR_PREFIX = "<!--aluna:count:";
export const COLLECTION_COUNT_SIDECAR_SUFFIX = "-->";

/** The attribute the shell finds the collection's count label by. */
export const COLLECTION_COUNT_LABEL_ATTR = "data-capability-count-label";

/** Said, bubbling, by a create form once its record is saved. */
export const RECORD_CREATED_EVENT = "aluna:record-created";

/** Said, bubbling, by a create form's Cancel once the draft is put down. */
export const CREATE_CANCELLED_EVENT = "aluna:create-cancelled";

/**
 * Hand `reset` the create form each time one finishes, saved or put down. Cancel is said by the
 * control that was pressed, so both are read up to the form; the prototype's `closest`, because a
 * form's own is clobbered by a control named `closest`.
 *
 * @param {{ addEventListener(type: string, listener: (event: Event) => void): void }} root
 * @param {(form: HTMLFormElement) => void} reset
 */
export function onCreateFinished(root, reset) {
  for (const finished of [RECORD_CREATED_EVENT, CREATE_CANCELLED_EVENT]) {
    root.addEventListener(finished, (event) => {
      const { target } = event;
      const form =
        target instanceof Element ? Element.prototype.closest.call(target, "form") : null;
      if (form instanceof HTMLFormElement) reset(form);
    });
  }
}
