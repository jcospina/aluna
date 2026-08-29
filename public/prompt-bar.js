// @ts-check

/**
 * The prompt bar's one live slot, and everything the desk says through it.
 *
 * The bar is the one thing on the page that belongs to Aluna rather than to a capability
 * (design D5). Anything the desk turns down before a build starts is explained there — a
 * prompt the resolver refuses, a build refused because a run already has the window, a
 * desk action that would take the window from one — and so is any structured refusal that
 * arrived from that surface rather than from inside the window (PLAN decisions 24, 26).
 * The slot is the one the shell already ships inside the bar (`public/index.html`), an
 * `aria-live` region above the rail, so the desk gains no notice surface of its own.
 *
 * A module of its own, like every other subject of the desk, and nothing calls into it:
 * the shell glue and the deletion module both *say what happened* and let this place it
 * (ARCH §6.1). That keeps one pair of hands on the slot, on the 400ms cue, and on the
 * rule that retires a sentence about a run that has since ended.
 */

/** The bar, and the slot it speaks in. */
const PROMPT_FORM_ID = "spec-build-form";
const PROMPT_NOTICE_ID = "prompt-notice";
const PROMPT_FIELD_ID = "spec-build-prompt";

/**
 * The marker a refused sentence wears, and the 400ms cue that goes with it — the design's
 * own `is-refused` state (`design/styles/components/desk.css`), kept as the attention cue
 * and no longer the whole message. The marker is written by the server on every sentence
 * that is a refusal (`renderPromptNotice`, `src/web/fragments.ts`) and by this module on
 * the ones the desk authors, so nothing here has to know *which* refusal it is looking at.
 */
const PROMPT_REFUSAL_ATTRIBUTE = "data-prompt-refusal";
const PROMPT_REFUSAL_SELECTOR = `[${PROMPT_REFUSAL_ATTRIBUTE}]`;
const PROMPT_REFUSED_CLASS = "is-refused";
const PROMPT_REFUSAL_FLASH_MS = 400;

/**
 * What the desk says here, and what it asks. Both are restated in `public/app.js`, which
 * is a classic script and can import nothing; a platform test pins that they match.
 *
 * The message is one sentence and whether it is a refusal, with the empty sentence
 * retiring whatever stands. `aboutTheRun` marks the two the desk says *while a run has
 * the window* — a second prompt turned down, and a desk action refused it — which stop
 * being true the moment that run ends.
 *
 * The question is answered by cancelling: the bar knows whether such a sentence was
 * standing, and what the asker does with that — whether to wipe the field it is about to
 * wake — is the asker's own business.
 */
export const PROMPT_BAR_MESSAGE_EVENT = "aluna:prompt-bar-message";
export const PROMPT_BAR_RETIRE_RUN_SENTENCE_EVENT = "aluna:retire-run-sentence";

/**
 * What the bar answers a blank submission with, restated from `BLANK_PROMPT_NOTICE`
 * (`src/web/fragments.ts`); a platform test pins that the two agree. The server keeps its
 * own guard for every submission that does not come from this bar.
 */
const BLANK_PROMPT_NOTICE = "What would you like me to make?";

/**
 * Whether anything was actually typed. Nothing to build is nothing to build whether the
 * field is empty or holds only spaces — and invisible and default-ignorable characters
 * look empty on screen, so they are nothing here too. The same reading the server does
 * (`hasMeaningfulPromptContent`), which is what makes the two answers identical.
 * @param {string} prompt
 */
function hasSomethingToBuild(prompt) {
  return prompt.replace(BLANK_PROMPT_CHARACTERS, "").length > 0;
}

/**
 * Character for character what `hasMeaningfulPromptContent` removes on the server
 * (`src/web/prompt-request.ts`); a platform test pins that the two patterns are the same
 * source text, so one answer can never drift from the other.
 */
const BLANK_PROMPT_CHARACTERS = /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/**
 * As much of the document as these rules reach for. Structural on purpose, the way the
 * desk's other modules take theirs: a real `Document` satisfies it and so does a double,
 * which is what lets the rules run in Bun without a browser.
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
 * The sentence the desk put here *about a run that was still going*. The node is kept
 * rather than the words: a sentence that replaced it since — a warm deflection, a
 * deletion's outcome, an ending carried out of the window — is about something else and
 * stays.
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

  // Editing answers the sentence. A refusal stays up for as long as it is being read and
  // no timer takes it away, but the moment the person starts changing the words, it is
  // about a prompt that is no longer in the field.
  // A blank prompt is refused here, before anything else sees the submission — the way
  // `design/scripts/prompt-bar.js` refuses one, and for the reason it does: there is
  // nothing to build, so there is nothing to open a window for and nothing to ask the
  // server. Empty and whitespace-only are the same submission and get the same answer.
  //
  // `stopPropagation` in the capture phase is what keeps it off the wire: htmx listens on
  // the form itself, and an event stopped at the document never reaches it. The window
  // the desk would have opened reads `defaultPrevented` (`public/desk-window.js`), so a
  // refusal here never leaves a frame behind to flicker shut.
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
      event.stopPropagation();
      speakOnPromptBar(root, BLANK_PROMPT_NOTICE, true);
    },
    true,
  );

  root.addEventListener("input", (/** @type {Event} */ event) => {
    const edited = /** @type {{ id?: string } | null} */ (event.target);
    if (edited?.id === PROMPT_FIELD_ID) clearPromptBar(root);
  });

  // A sentence the server sent out of band. htmx swaps it into the slot itself — the id
  // and the swap mode belong to `renderPromptNotice` — so all that is left is the cue that
  // goes with a refusal. `detail.target` and nothing else: htmx dispatches this on each
  // element of the *main* swap, so `event.target` is never the out-of-band one.
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
 * Say again the sentence the page arrived already carrying.
 *
 * Page assembly seeds one into this slot for the one load that has something to say before
 * anybody has asked it anything — an address naming a capability that is not there
 * (`renderRehydratedShell`, PLAN decision 21). A live region announces what *changes* in
 * it, never what was already standing when the document was parsed, so a sentence served
 * with the page is read by eye and by nobody else. Every other sentence on this bar is a
 * change and is therefore spoken; this one had to be made into one.
 *
 * The words never move. It is the same sentence put back in the same slot, so a browser
 * that never reaches `DOMContentLoaded` is exactly as well off as it was before this
 * existed — and the flag is what stops a document that had already finished from hearing
 * it twice.
 *
 * @param {PromptBarRoot} root
 */
function sayAgainWhatThePageArrivedWith(root) {
  const notice = /** @type {Slot | null} */ (root.getElementById(PROMPT_NOTICE_ID) ?? null);
  const standing = notice?.textContent ?? "";
  if (notice === null || standing === "") return;
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
 * Say one sentence on the bar, and flash if it is a refusal. Nothing here touches the
 * field or moves focus: a line asking the person to try again beside a field that was just
 * wiped is asking for something it took away.
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
 * Retire the sentence about the run if it is still the one standing.
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
