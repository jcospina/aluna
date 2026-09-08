// @ts-check

/**
 * Recovering a capability deletion whose reply never arrived. A destructive action must never look
 * like it did nothing, so this asks the server what is true (CONTEXT.md, Ending).
 */

import { PROMPT_BAR_MESSAGE_EVENT } from "./prompt-bar.js";
import { registerRegionRelease } from "./region-scope.js";

/**
 * The surface of the capability standing in the window: a direct child of the region, never a
 * descendant. Restated rather than shared, and a platform test pins the two copies.
 */
const WINDOW_REGION_ID = "spec-build-output";

/**
 * Asking a region's scope to release everything its content started, before that content is
 * replaced — the only moment an htmx request inside it can still be aborted (region-scope.js).
 */
const RELEASE_REGION_EVENT = "aluna:release-region";

/**
 * What marks a preflight as a recheck rather than an ordinary press. Restated from
 * `src/lifecycle/deletion/presentation.ts`, and a platform test pins the two copies.
 */
const DELETION_RECHECK_PARAM = "after_confirm";

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/**
 * The capability standing in the window, if one is. Asked of the node rather than its
 * constructor: a rule that can only be proved in a browser is a rule nothing proves.
 *
 * @param {Document} root
 * @returns {{ dataset?: Record<string, string | undefined> } | null}
 */
function activeCapabilitySurface(root) {
  const output = /** @type {DeletionNode | null} */ (
    /** @type {unknown} */ (root.getElementById(WINDOW_REGION_ID))
  );
  return output?.querySelector?.(":scope > [data-active-capability-id]") ?? null;
}

/**
 * Capture the exact active registry identity before the deletion's POST goes out. The
 * server validates both hints and stores only the data-free descriptor.
 *
 * @param {{ elt?: DeletionNode, parameters?: Record<string, unknown> }} detail
 * @param {Document} [root]
 * @returns {boolean} whether this request was a deletion
 */
export function configureCapabilityDeletionRestoration(detail, root = globalThis.document) {
  if (detail.elt?.matches?.("[data-capability-delete]") !== true) return false;
  if (detail.parameters) detail.parameters.restore_surface = "neutral";
  const surface = activeCapabilitySurface(root);
  if (surface === null || !detail.parameters) return true;
  const capabilityId = surface.dataset?.activeCapabilityId;
  const incarnationId = surface.dataset?.activeCapabilityIncarnation;
  if (!capabilityId || !incarnationId) return true;
  detail.parameters.restore_surface = "capability";
  detail.parameters.restore_capability_id = capabilityId;
  detail.parameters.restore_incarnation_id = incarnationId;
  return true;
}

// Three tries, because the stale panel must never be left up: ask the server what is actually
// true and show its answer, whether that is the panel again or "already gone".
const CAPABILITY_DELETION_RECHECK_DELAYS_MS = [200, 800, 2000];

/**
 * The preflight URL for a Confirm form, carrying the same restoration evidence the
 * submission did so a recovered panel still knows where **Keep it** goes back to.
 * @param {DeletionNode & { getAttribute?: (name: string) => string | null }} form
 * @returns {string | null}
 */
export function capabilityDeletionPreflightUrl(form) {
  const base = form.getAttribute?.("data-capability-deletion-confirm") ?? null;
  if (!base) return null;
  const query = new URLSearchParams();
  for (const name of ["restore_surface", "restore_capability_id", "restore_incarnation_id"]) {
    const value = /** @type {{ value?: string } | null} */ (
      form.querySelector?.(`input[name="${name}"]`) ?? null
    )?.value;
    if (value) query.set(name, value);
  }
  // A recheck after a Confirm, not an ordinary press: "already gone, so I didn't delete anything"
  // is true for a tile another tab removed and must never be said of this confirm.
  query.set(DELETION_RECHECK_PARAM, "1");
  return `${base}?${query.toString()}`;
}

/**
 * @param {string} copy the empty string retires whatever is standing
 * @param {boolean} [refused] whether this is Aluna turning the deletion down
 * @param {{ dispatchEvent(event: Event): unknown } | undefined} [root] the document to
 *   say it on, which the recovery leaves to the page's own and a rescue is told
 */
function writeCapabilityDeletionRecheckNotice(copy, refused = false, root = globalThis.document) {
  root?.dispatchEvent(
    new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: copy, refused } }),
  );
}

/**
 * The recovery's claim on the window's content region: delete A, confirm, press B's logo, and
 * 200ms later A's deletion answer replaced B's collection and rewrote the address to match.
 *
 * @param {DeletionNode | undefined} form
 * @returns {{ owned: () => boolean, deregister: () => void }}
 */
function claimDeletionRegion(form) {
  // Anchored to the confirmation form, so whatever replaces it drops the claim. A recovery
  // without one still asks and still answers, on the prompt bar rather than in the region.
  let owned = true;
  const anchor = /** @type {Parameters<typeof registerRegionRelease>[0] | null} */ (
    /** @type {unknown} */ (form ?? null)
  );
  if (anchor === null || typeof anchor.closest !== "function") {
    return { owned: () => false, deregister: () => {} };
  }
  const deregister = registerRegionRelease(anchor, "deletion recheck", () => {
    owned = false;
  });
  return { owned: () => owned, deregister };
}

/**
 * @param {string} preflightUrl
 * @param {number} attempt
 * @param {{ owned: () => boolean, deregister: () => void }} claim
 * @returns {Promise<void>}
 */
async function recheckCapabilityDeletion(preflightUrl, attempt, claim) {
  const delay = CAPABILITY_DELETION_RECHECK_DELAYS_MS[attempt];
  if (delay === undefined) {
    claim.deregister();
    writeCapabilityDeletionRecheckNotice(
      "I still can’t tell what happened. Reload the page to see the latest.",
      true,
    );
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delay));

  const response = await fetch(preflightUrl, { headers: { "HX-Request": "true" } }).catch(
    () => null,
  );
  if (response === null || !response.ok) {
    await recheckCapabilityDeletion(preflightUrl, attempt + 1, claim);
    return;
  }

  const html = await response.text();

  // Something else may be standing in the slot now, which is the good ending: there is no panel
  // left to be stale. The answer is still owed, so it is read out of the reply and said anyway.
  const output = document.getElementById(WINDOW_REGION_ID);
  const owned = claim.owned();
  claim.deregister();
  if (!owned || !(output instanceof HTMLElement)) {
    const answer = answerIn(html, document);
    writeCapabilityDeletionRecheckNotice(answer.sentence, answer.refused);
    if (output === null) applyReplaceUrl(response);
    return;
  }
  const htmx =
    /** @type {Window & { htmx?: { swap(target: Element, content: string, spec: { swapStyle: string, swapDelay: number, settleDelay: number }, options?: { eventInfo?: unknown }): void } }} */ (
      window
    ).htmx;
  // Retire the "checking" line first, so an out-of-band notice in the answer is what the user is
  // left reading.
  writeCapabilityDeletionRecheckNotice("");
  releaseRegionContent(output);
  // `eventInfo` becomes `detail.target` on the `afterSwap` htmx fires, and two desk rules read it.
  // Without it htmx sends only `elt`, and both silently decline: no focus, and an empty frame.
  if (htmx) {
    htmx.swap(
      output,
      html,
      { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 },
      {
        eventInfo: { target: output },
      },
    );
  } else output.innerHTML = html;

  applyReplaceUrl(response);
}

/**
 * The server decides where this leaves the user: a capability that turned out to be gone answers
 * with the home URL, so a reload does not land on a dead route. HTMX applies this for its own.
 * @param {Response} response
 */
function applyReplaceUrl(response) {
  const replaceUrl = response.headers.get("HX-Replace-Url");
  if (replaceUrl) window.history.replaceState(window.history.state, "", replaceUrl);
}

/**
 * What a deletion reply says to the user, read out of the reply itself and parsed into an inert
 * template so nothing runs. Two shapes: an ending speaks in the window, a notice out of band.
 *
 * @param {string} html
 * @param {{ createElement(tag: string): { innerHTML: string, content: { querySelector(selector: string): unknown } } }} root
 * @returns {{ sentence: string, refused: boolean }}
 */
function answerIn(html, root) {
  const template = root.createElement("template");
  template.innerHTML = html;
  const held = /** @type {{ textContent?: string } | null} */ (
    template.content.querySelector(DELETION_SENTENCE_SELECTOR)
  );
  // An ending's sentence never reached a window, so this is the first telling and it arrives with
  // the bar's cue — unlike a rescued ending, which already had its moment on screen.
  if (held?.textContent?.trim()) return { sentence: held.textContent.trim(), refused: true };
  const notice = /** @type {{ textContent?: string, querySelector(s: string): unknown } | null} */ (
    template.content.querySelector("#prompt-notice")
  );
  return {
    sentence: notice?.textContent?.trim() || "That’s sorted — the desk is up to date.",
    // Carried across rather than flattened, so a deletion Aluna turned down says so with the
    // bar's cue whichever way the answer reached us (`renderPromptNotice`).
    refused: notice?.querySelector("[data-prompt-refusal]") != null,
  };
}

/**
 * As much of a node as these rules ask anything of.
 * @typedef {{
 *   matches?: (selector: string) => boolean,
 *   closest?: (selector: string) => DeletionNode | null,
 *   querySelector?: (selector: string) => DeletionNode | null,
 *   dataset?: Record<string, string | undefined>,
 *   textContent?: string | null,
 *   removeAttribute?: (name: string) => void,
 * }} DeletionNode
 */

/**
 * @typedef {{
 *   shouldSwap?: boolean,
 *   requestConfig?: { elt?: DeletionNode },
 * }} DeletionSwap
 */

/** @param {Event} event @param {Document} [root] */
export function recoverSeveredCapabilityDeletion(event, root = globalThis.document) {
  const form = /** @type {CustomEvent<{ elt?: DeletionNode }>} */ (event).detail?.elt;
  const preflightUrl = form ? capabilityDeletionPreflightUrl(form) : null;
  if (preflightUrl === null) return;

  writeCapabilityDeletionRecheckNotice(
    "Something interrupted that. Let me check what happened…",
    false,
    root,
  );
  void recheckCapabilityDeletion(preflightUrl, 0, claimDeletionRegion(form));
}

/**
 * The prompt bar's field, restated the way this module restates every constant it cannot
 * import; a platform test pins the copies against each other.
 */
const PROMPT_FIELD_ID = "spec-build-prompt";

/**
 * The ending's own marks, and the one the three presses that end a deletion share: backing out,
 * dismissing, committing. Restated from `src/lifecycle/deletion/presentation.ts` and pinned.
 */
const DELETION_ENDING_ATTRIBUTE = "data-capability-deletion-ending";
const DELETION_ENDING_SELECTOR = `[${DELETION_ENDING_ATTRIBUTE}]`;
const DELETION_SENTENCE_SELECTOR = "[data-capability-deletion-sentence]";
const DELETION_EXIT_SELECTOR = "[data-capability-deletion-exit]";

/**
 * The floor, not the last word: `focusOpener` and `focusCapabilityDeletion` both land after this
 * and are better where they apply. What is left is a restored capability, and a commit's dead logo.
 *
 * @param {Document} root
 */
function handKeyboardBackToTheDesk(root) {
  root.getElementById(PROMPT_FIELD_ID)?.focus();
}

/**
 * An ending about to be destroyed rather than read. The window is the only place the sentence
 * lives, so it moves to the prompt bar on the way out; a dismissal retires it first instead.
 *
 * @param {DeletionNode | null | undefined} leaving
 * @param {{ dispatchEvent(event: Event): unknown } | undefined} [root]
 */
export function rescueCapabilityDeletionEnding(leaving, root) {
  /* Asked of the node itself, not its ancestors: htmx fires the cleanup event for every node of
   * every removed subtree — thousands on a collection swap — and reaches the panel first. */
  const ending = leaving?.matches?.(DELETION_ENDING_SELECTOR) ? leaving : null;
  const sentence = ending?.querySelector?.(DELETION_SENTENCE_SELECTOR)?.textContent?.trim();
  if (!sentence) return;
  retireCapabilityDeletionEnding(ending);
  /* Carried as the ending it already was, not turned into a refusal: the sentence already had
   * the window, and the bar's cue belongs to a refusal arriving for the first time. */
  writeCapabilityDeletionRecheckNotice(sentence, false, root);
}

/**
 * Take the mark off, so a sentence already accounted for cannot leave twice. Not on the press: a
 * dismissal that never arrives leaves the ending standing and still unread.
 * @param {DeletionNode | null | undefined} ending
 */
function retireCapabilityDeletionEnding(ending) {
  ending?.removeAttribute?.(DELETION_ENDING_ATTRIBUTE);
}

/**
 * Whatever a deletion swapped into the window takes the keyboard by its own heading. Asked of the
 * node rather than its constructor: a rule only provable in a browser is a rule nothing proves.
 *
 * @param {Event} event
 */
export function focusCapabilityDeletion(event) {
  const target = /** @type {CustomEvent<{ target?: { querySelector?: Function } }>} */ (event)
    .detail?.target;
  const heading = target?.querySelector?.("[data-capability-deletion-focus]");
  if (!heading?.focus) return;
  requestAnimationFrame(() => heading.focus());
}
/**
 * Wire the recovery's obligations onto a document: what a deletion says it displaces,
 * the two ways a reply can fail to arrive, and where a recovered panel puts focus.
 *
 * @param {Document} root
 */
export function startCapabilityDeletionRecovery(root) {
  root.addEventListener("htmx:configRequest", (event) => {
    const detail =
      /** @type {CustomEvent<{ elt?: Element, parameters?: Record<string, unknown> }>} */ (
        /** @type {unknown} */ (event)
      ).detail;
    if (!detail) return;
    configureCapabilityDeletionRestoration(detail, root);
  });
  const recover = (/** @type {Event} */ event) => recoverSeveredCapabilityDeletion(event, root);
  root.addEventListener("htmx:sendError", recover);
  root.addEventListener("htmx:timeout", recover);
  /* The third way a reply never arrives, and the one the desk causes itself: a region release
   * aborts the request while the server goes on. An aborted confirm fires nothing else. */
  root.addEventListener("htmx:sendAbort", recover);
  root.addEventListener("htmx:afterSwap", focusCapabilityDeletion);
  /* htmx's cleanup is the hook because every disappearance goes through it: an `innerHTML` swap
   * runs `cleanUpElement` over each node it removes, so the panel is always reached. */
  root.addEventListener("htmx:beforeCleanupElement", (event) =>
    rescueCapabilityDeletionEnding(/** @type {DeletionNode | null} */ (event.target), root),
  );
  root.addEventListener("click", (event) => {
    const target = /** @type {DeletionNode | null} */ (event.target);
    if (target?.closest?.(DELETION_EXIT_SELECTOR)) handKeyboardBackToTheDesk(root);
  });
  /* The sentence is read once its answer is about to land, so it may not also follow the panel
   * out to the prompt bar. A dismissal that never lands leaves the ending standing. */
  root.addEventListener("htmx:beforeSwap", (event) => {
    const detail = /** @type {{ detail?: DeletionSwap }} */ (/** @type {unknown} */ (event)).detail;
    if (detail?.shouldSwap === false) return;
    if (!detail) return;
    const leaving = detail.requestConfig?.elt?.closest?.(DELETION_EXIT_SELECTOR);
    if (leaving) retireCapabilityDeletionEnding(leaving.closest?.(DELETION_ENDING_SELECTOR));
  });
}

if (typeof document !== "undefined") startCapabilityDeletionRecovery(document);
