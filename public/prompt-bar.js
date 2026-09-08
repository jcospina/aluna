// @ts-check

/**
 * The prompt bar's one live slot: the one thing on the page that belongs to Aluna, not to a
 * capability (design D5). Callers say what happened; this module places it (ARCH §6.1).
 */

/**
 * The bar, and the slot it speaks in: the `aria-live` region `public/index.html` already ships,
 * so the desk gains no notice surface of its own.
 */
const PROMPT_FORM_ID = "spec-build-form";
export const PROMPT_NOTICE_ID = "prompt-notice";
const PROMPT_FIELD_ID = "spec-build-prompt";

/**
 * The marker a refused sentence wears, and the design's `is-refused` cue with it
 * (`design/styles/components/desk.css`). `renderPromptNotice` writes it on the server's own.
 */
const PROMPT_REFUSAL_ATTRIBUTE = "data-prompt-refusal";
export const PROMPT_REFUSAL_SELECTOR = `[${PROMPT_REFUSAL_ATTRIBUTE}]`;
const PROMPT_REFUSED_CLASS = "is-refused";
const PROMPT_REFUSAL_FLASH_MS = 400;

/**
 * What the desk says here, and what it asks (PLAN decisions 24, 26). Both are restated in
 * `public/app.js`, a classic script that can import nothing; a platform test pins that they match.
 */
export const PROMPT_BAR_MESSAGE_EVENT = "aluna:prompt-bar-message";
export const PROMPT_BAR_RETIRE_RUN_SENTENCE_EVENT = "aluna:retire-run-sentence";

/**
 * What the bar answers a blank submission with, restated from `BLANK_PROMPT_NOTICE` and pinned
 * by a test. The server keeps its own guard for submissions that do not come from this bar.
 */
const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * Whether anything was actually typed. Spaces, invisible and default-ignorable characters all
 * look empty, so they count as nothing here — the reading `hasMeaningfulPromptContent` does.
 * @param {string} prompt
 */
function hasSomethingToBuild(prompt) {
  return prompt.replace(BLANK_PROMPT_CHARACTERS, "").length > 0;
}

/**
 * Character for character what `hasMeaningfulPromptContent` removes on the server
 * (`src/server/http/prompt-request.ts`); a test pins the two patterns as the same source text.
 */
const BLANK_PROMPT_CHARACTERS = /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/**
 * As much of the document as these rules reach for. Structural on purpose, so a double satisfies
 * it as well as a `Document` and the rules run in Bun without a browser.
 *
 * @typedef {{ classList: { add(name: string): void, remove(name: string): void } }} Flashable
 * @typedef {{
 *   replaceChildren(...nodes: unknown[]): void,
 *   querySelector(selector: string): unknown,
 *   firstChild: unknown,
 *   textContent: string,
 * }} Slot
 * @typedef {{
 *   getElementById(id: string): unknown,
 *   createElement(tag: string): unknown,
 *   addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void,
 *   readyState?: string,
 * }} PromptBarRoot
 */

/** @type {ReturnType<typeof setTimeout> | undefined} */
let promptRefusalFlash;

/**
 * The sentence the desk put here about a run that was still going, which stops being true the
 * moment that run ends. The node is kept, so a sentence that replaced it since stays.
 * @type {unknown}
 */
let sentenceAboutTheRun = null;

/**
 * Wire the bar's rules onto a document.
 * @param {PromptBarRoot} root
 */
export function startPromptBar(root) {
  root.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (/** @type {CustomEvent} */ event) => {
    const said = /** @type {{ sentence?: string, refused?: boolean, aboutTheRun?: boolean }} */ (
      event.detail
    );
    if (typeof said?.sentence !== "string") return;
    if (said.sentence === "") clearPromptBar(root);
    else {
      const placed = speakOnPromptBar(root, said.sentence, said.refused === true);
      if (said.aboutTheRun === true) sentenceAboutTheRun = placed;
    }
  });

  root.addEventListener(PROMPT_BAR_RETIRE_RUN_SENTENCE_EVENT, (/** @type {Event} */ event) => {
    if (retireSentenceAboutTheRun(root)) event.preventDefault();
  });

  // A blank prompt is refused here, before anything else sees the submission, the way
  // `design/scripts/prompt-bar.js` refuses one: nothing to build is nothing to ask the server.
  root.addEventListener(
    "submit",
    (/** @type {Event} */ event) => {
      const form = /** @type {{ id?: string, querySelector?: (s: string) => unknown } | null} */ (
        event.target
      );
      if (form?.id !== PROMPT_FORM_ID) return;
      const field = /** @type {{ value?: string } | null} */ (
        form.querySelector?.(`#${PROMPT_FIELD_ID}`) ?? null
      );
      if (hasSomethingToBuild(field?.value ?? "")) return;
      event.preventDefault();
      // `stopPropagation` in the capture phase keeps it off the wire: htmx listens on the form,
      // and the window the desk would have opened reads `defaultPrevented`, so none is left.
      event.stopPropagation();
      speakOnPromptBar(root, BLANK_PROMPT_NOTICE, true);
    },
    true,
  );

  // Editing answers the sentence: no timer takes a refusal away, but once the words change it
  // is about a prompt that is no longer in the field.
  root.addEventListener("input", (/** @type {Event} */ event) => {
    const edited = /** @type {{ id?: string } | null} */ (event.target);
    if (edited?.id === PROMPT_FIELD_ID) clearPromptBar(root);
  });

  // A sentence the server sent out of band; `renderPromptNotice` owns the id and the swap mode,
  // so only the cue is left. `detail.target`, because `event.target` is the main swap's element.
  root.addEventListener("htmx:oobAfterSwap", (/** @type {CustomEvent} */ event) => {
    const swapped = /** @type {{ id?: string, querySelector?: (s: string) => unknown }} */ (
      event.detail?.target
    );
    if (swapped?.id !== PROMPT_NOTICE_ID) return;
    if (swapped.querySelector?.(PROMPT_REFUSAL_SELECTOR)) flashPromptRefusal(root);
  });

  sayAgainWhatThePageArrivedWith(root);
}

/**
 * Say again the sentence page assembly seeded here (`renderRehydratedShell`, PLAN decision 21):
 * a live region announces what changes in it, never what stood when the document was parsed.
 *
 * @param {PromptBarRoot} root
 */
function sayAgainWhatThePageArrivedWith(root) {
  const notice = /** @type {Slot | null} */ (root.getElementById(PROMPT_NOTICE_ID) ?? null);
  const standing = notice?.textContent ?? "";
  if (notice === null || standing === "") return;
  // The same sentence back in the same slot, so a browser that never reaches `DOMContentLoaded`
  // is no worse off; the flag stops a document that had already finished hearing it twice.
  let saidIt = false;
  const sayItAgain = () => {
    if (saidIt) return;
    saidIt = true;
    notice.replaceChildren();
    notice.textContent = standing;
  };
  root.addEventListener("DOMContentLoaded", sayItAgain);
  if (root.readyState === "complete") sayItAgain();
}

/**
 * Say one sentence on the bar, and flash if it is a refusal. Nothing here touches the field or
 * moves focus: asking someone to try again beside a field just wiped takes back what it asks.
 * @param {PromptBarRoot} root @param {string} sentence @param {boolean} refused
 * @returns {unknown} the node the sentence was placed in, when it is one that can be
 * retired later
 */
function speakOnPromptBar(root, sentence, refused) {
  const notice = /** @type {Slot | null} */ (root.getElementById(PROMPT_NOTICE_ID) ?? null);
  if (notice === null) return null;
  if (!refused) {
    // An answer landing inside a refusal's 400ms is still an answer: the cue goes with the
    // sentence it belonged to, or the bar is left flashing over the wrong words.
    stopPromptRefusalFlash(root);
    notice.textContent = sentence;
    return null;
  }
  const marked =
    /** @type {{ setAttribute(name: string, value: string): void, textContent: string }} */ (
      root.createElement("span")
    );
  marked.setAttribute(PROMPT_REFUSAL_ATTRIBUTE, "");
  marked.textContent = sentence;
  notice.replaceChildren(marked);
  flashPromptRefusal(root);
  return marked;
}

/**
 * Flash the bar. Restarted rather than stacked, so a second refusal inside the first one's
 * window is a single cue rather than two that end each other early.
 * @param {PromptBarRoot} root
 */
function flashPromptRefusal(root) {
  const form = /** @type {Flashable | null} */ (root.getElementById(PROMPT_FORM_ID) ?? null);
  if (form === null) return;
  clearTimeout(promptRefusalFlash);
  form.classList.add(PROMPT_REFUSED_CLASS);
  promptRefusalFlash = setTimeout(
    () => form.classList.remove(PROMPT_REFUSED_CLASS),
    PROMPT_REFUSAL_FLASH_MS,
  );
}

/** Take the cue off now, whatever is left of its 400ms. @param {PromptBarRoot} root */
function stopPromptRefusalFlash(root) {
  clearTimeout(promptRefusalFlash);
  const form = /** @type {Flashable | null} */ (root.getElementById(PROMPT_FORM_ID) ?? null);
  form?.classList.remove(PROMPT_REFUSED_CLASS);
}

/**
 * Retire whatever the bar was saying, cue included.
 * @param {PromptBarRoot} root
 */
function clearPromptBar(root) {
  stopPromptRefusalFlash(root);
  sentenceAboutTheRun = null;
  const notice = /** @type {Slot | null} */ (root.getElementById(PROMPT_NOTICE_ID) ?? null);
  notice?.replaceChildren();
}

/**
 * Retire the sentence about the run if it is still the one standing. The asker learns whether
 * there was one from whether the event was cancelled.
 * @param {PromptBarRoot} root
 * @returns {boolean} whether there was one to retire
 */
function retireSentenceAboutTheRun(root) {
  const standing = sentenceAboutTheRun;
  sentenceAboutTheRun = null;
  const notice = /** @type {Slot | null} */ (root.getElementById(PROMPT_NOTICE_ID) ?? null);
  if (standing === null || notice === null || notice.firstChild !== standing) return false;
  clearPromptBar(root);
  return true;
}

if (typeof document !== "undefined") startPromptBar(document);
