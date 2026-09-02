// @ts-check

/**
 * Recovering a capability deletion whose reply never arrived.
 *
 * A destructive action must never look like it did nothing. A Confirm submission that
 * loses its connection swaps nothing at all, so htmx leaves the confirmation panel
 * sitting on screen at the same URL while the deletion itself may already be
 * permanently committed. This asks the server what is actually true and shows its
 * answer — the panel again, or "already gone".
 *
 * A module of its own rather than another item in the shell's leftovers
 * (`public/app.js`): deletion recovery is a subject, it is reached only through events,
 * and nothing about it has to be in place before Alpine starts. It also owns the other
 * half of the same concern — telling the server what a deletion displaces, so **Keep
 * it** has somewhere to go back to, and giving the recovered panel its focus.
 *
 * And it owns what a deletion that did not happen leaves standing. The ending fills the
 * window and waits there; every way out of it hands the keyboard back to the prompt bar,
 * and a window torn down over an ending nobody dismissed carries the sentence to the bar
 * on its way out, because the window is the only place it lives (CONTEXT.md, Ending).
 */

import { PROMPT_BAR_MESSAGE_EVENT } from "./prompt-bar.js";
import { registerRegionRelease } from "./region-scope.js";

/**
 * The surface of the capability standing in the window: a direct child of the region,
 * never a descendant. Restated here rather than shared, the way this shell's classic
 * script restates every constant it cannot import; a platform test pins the two copies
 * against each other.
 */
const WINDOW_REGION_ID = "spec-build-output";

/**
 * Asking a region's scope to release everything its current content started, before that
 * content is replaced — the only moment an htmx request inside it can still be aborted.
 * Kept in sync with public/region-scope.js (RELEASE_REGION_EVENT) and the shell's own
 * copy; a platform test pins that all of them match.
 */
const RELEASE_REGION_EVENT = "aluna:release-region";

/**
 * What marks a preflight as a recheck rather than an ordinary press. Restated here the way
 * this module restates every constant it cannot import
 * (`src/capability-deletion/presentation.ts`); a platform test pins the two copies.
 */
const DELETION_RECHECK_PARAM = "after_confirm";

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/**
 * The capability standing in the window, if one is.
 *
 * Asked of the node rather than of its constructor, the way the desk's other client rules
 * are written (`public/logo-menu.js`): a rule that can only be proved in a browser is a
 * rule nothing proves.
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

// A Confirm submission whose response never arrives — a dropped connection, or a
// server that went away mid-request — swaps nothing at all. HTMX then leaves the
// confirmation panel sitting on screen at the same URL, while the deletion itself may
// already be permanently committed: the destructive action looks like it did nothing.
// Never leave that stale panel up. Ask the server what is actually true and show its
// answer, whether that is the panel again or "already gone".
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
  // This is a recheck after a Confirm, not an ordinary press. It changes what the server
  // may say about a capability that is not there: "already gone, so I didn't delete
  // anything" is the truth for a tile another tab removed, and the one thing that must
  // never be said here — the deletion may have been *this* confirm crossing its point of
  // no return, and telling somebody their destructive action did nothing when it may have
  // done everything is the failure this whole recovery exists to prevent.
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
 * The recovery's claim on the window's content region.
 *
 * The recheck is a delayed chain, and by the time it answers the region may be holding
 * something else entirely. Its only staleness check used to be "was the window put away?",
 * which is true of the window and says nothing about what is *in* it: delete A → confirm →
 * press B's logo (which aborts the confirm and arms this recovery), and two hundred
 * milliseconds later B's freshly loaded collection was released and replaced by A's
 * deletion answer, with `HX-Replace-Url` rewriting the bar to match.
 *
 * So the recovery joins the region's own scope, anchored to the confirmation form it was
 * started for. Whatever replaces that form — another capability, a build, the window going
 * away — drops the claim, and a recovery without a claim may write neither the region nor
 * the address. It still asks and still answers: the person is owed the truth about a
 * destructive action either way, so the sentence goes to the prompt bar instead.
 *
 * @param {DeletionNode | undefined} form
 * @returns {{ owned: () => boolean, deregister: () => void }}
 */
function claimDeletionRegion(form) {
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

  // The window may have been put away while this was in flight, or something else may be
  // standing in it now. Either way this recovery no longer owns the slot. That is the
  // *good* ending — the danger it exists for is a stale confirmation panel left standing,
  // and there is no panel left to be stale. What is still owed is the answer, so it is read
  // out of the reply and left at the prompt bar rather than reported as "I can't tell",
  // which would be untrue: we just found out. The address is left exactly where whoever
  // owns the region put it.
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
  // Retire the "checking" line first so an out-of-band notice in the answer — the one
  // that explains a capability turning out to be already gone — is what the user is
  // left reading.
  writeCapabilityDeletionRecheckNotice("");
  releaseRegionContent(output);
  // `eventInfo` is what htmx puts in the detail of the `afterSwap`/`afterSettle` it
  // fires for this swap, and two desk rules read `detail.target` off it: where a swapped
  // panel puts focus, and whether the region was left empty for the window to put itself
  // away. Without it htmx sends only `elt`, and both rules silently decline — a recovered
  // panel never took the keyboard, and an "already gone" answer left an empty frame
  // standing.
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
 * The server decides where this leaves the user. A capability that turned out to be
 * gone answers with the home URL, and honouring it is what stops a reload from
 * landing on the deleted capability's dead route. HTMX applies this header for its
 * own requests; this one is ours, so apply it ourselves.
 * @param {Response} response
 */
function applyReplaceUrl(response) {
  const replaceUrl = response.headers.get("HX-Replace-Url");
  if (replaceUrl) window.history.replaceState(window.history.state, "", replaceUrl);
}

/**
 * What a deletion reply says to the user, read out of the reply itself. Parsed into an
 * inert template, so nothing in it runs or loads.
 *
 * Two shapes, because a deletion answers in two places now. An ending says its piece in
 * the window and carries no notice; a commit and an "already gone" say theirs out of band
 * on the prompt bar. Both are read here, because both callers are asking the same
 * question — what does this reply tell the person — at a moment when the window it was
 * written for is not there to hold it.
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
  // An ending's sentence never reached a window, so this is the first time the person is
  // being told and it arrives with the bar's cue — unlike a *rescued* ending, which
  // already had its moment on screen.
  if (held?.textContent?.trim()) return { sentence: held.textContent.trim(), refused: true };
  const notice = /** @type {{ textContent?: string, querySelector(s: string): unknown } | null} */ (
    template.content.querySelector("#prompt-notice")
  );
  return {
    sentence: notice?.textContent?.trim() || "That’s sorted — the desk is up to date.",
    // Carried across rather than flattened: a deletion Aluna turned down says so with the
    // bar's cue whichever way the answer reached us — out of band, or read back out of
    // this recovery's own reply (`renderPromptNotice`, `src/web/fragments.ts`).
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
 * The ending's own marks — the panel and the sentence inside it — and the one the three
 * presses that end a deletion share: backing out, dismissing an ending, and committing.
 * Restated from `src/capability-deletion/presentation.ts`, the way this shell restates
 * every mark it cannot import; a platform test pins the copies against each other.
 */
const DELETION_ENDING_ATTRIBUTE = "data-capability-deletion-ending";
const DELETION_ENDING_SELECTOR = `[${DELETION_ENDING_ATTRIBUTE}]`;
const DELETION_SENTENCE_SELECTOR = "[data-capability-deletion-sentence]";
const DELETION_EXIT_SELECTOR = "[data-capability-deletion-exit]";

/**
 * Every way out of a deletion hands the keyboard somewhere it can be used, rather than
 * dropping it on `<body>`: the control that was pressed is about to be swapped away, the
 * menu item it came from is closed, and after a commit the whole logo it hung on is gone.
 *
 * This is the floor, not the last word. Two rules land after it and both are better where
 * they apply. A press that leaves the region empty puts the window away, and the window
 * gives the keyboard back to whatever opened it (`focusOpener`, `public/desk-window.js`)
 * — the capability's own logo, which is where the whole gesture started and is still on
 * the desk after everything except a commit. And a press that is answered with an ending
 * hands the keyboard to the sentence, which is the thing that has something to say
 * (`focusCapabilityDeletion`). What is left for this is the case both decline: the window
 * standing with a restored capability in it, and the commit whose logo has gone.
 *
 * The prompt bar is the destination for the same reason a dismissed run ending uses it
 * (`public/app.js`), so the desk has one answer rather than two.
 *
 * @param {Document} root
 */
function handKeyboardBackToTheDesk(root) {
  root.getElementById(PROMPT_FIELD_ID)?.focus();
}

/**
 * An ending about to be destroyed rather than read.
 *
 * The window is the only place the sentence lives, and the window can be put away, taken
 * by a build, or navigated off — none of which is the person saying they have read it. It
 * moves to the prompt bar's standing slot on the way out, so a deletion Aluna turned down
 * can never leave the desk looking exactly as it did before Delete was pressed. A
 * dismissal never reaches this: the press retires the sentence itself first.
 *
 * @param {DeletionNode | null | undefined} leaving
 * @param {{ dispatchEvent(event: Event): unknown } | undefined} [root]
 */
export function rescueCapabilityDeletionEnding(leaving, root) {
  /* Asked of the node itself rather than of its ancestors. htmx fires the cleanup event
   * for every node of every removed subtree — on a collection swap that is thousands — and
   * it reaches the panel before it recurses into the panel's children, so matching one
   * attribute is both the whole of what is needed and the cheapest thing to do per node.
   * The same shape the shell's own rescue uses (`public/app.js`). */
  const ending = leaving?.matches?.(DELETION_ENDING_SELECTOR) ? leaving : null;
  const sentence = ending?.querySelector?.(DELETION_SENTENCE_SELECTOR)?.textContent?.trim();
  if (!sentence) return;
  retireCapabilityDeletionEnding(ending);
  /* Carried as the ending it already was, not turned into a refusal on the way — the same
   * call `rescueHeldEnding` makes for a run's ending (`public/app.js`), and for its
   * reason: the sentence had the window and the keyboard, and this is only the line
   * surviving the window. The bar's cue belongs to a refusal arriving for the first
   * time. */
  writeCapabilityDeletionRecheckNotice(sentence, false, root);
}

/**
 * Take the mark off, so a sentence already accounted for cannot leave a second time — a
 * dismissal retires it as its answer lands, and a rescue retires it as it goes.
 *
 * Not on the press. A dismissal whose request never arrives swaps nothing, so the ending
 * is still standing and is still unread; retiring it at the press would have spent the
 * sentence on a reply that never came, and the next teardown would have taken it away
 * with nothing left to say. `htmx:beforeSwap` is the moment the answer is known to be
 * about to land.
 * @param {DeletionNode | null | undefined} ending
 */
function retireCapabilityDeletionEnding(ending) {
  ending?.removeAttribute?.(DELETION_ENDING_ATTRIBUTE);
}

/**
 * Whatever a deletion swapped into the window takes the keyboard by its own heading —
 * the confirmation's question, and the ending's sentence about what happened instead.
 *
 * Asked of the node rather than of its constructor, the way the desk's other client rules
 * are written (`public/logo-menu.js`): a rule that can only be proved in a browser is a
 * rule nothing proves.
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
  /* And the third way a confirm's reply never arrives, which is the one the desk causes
   * itself: putting the window away — or opening anything else into it — releases the
   * region's scope, and that aborts every request the region's content started
   * (`public/region-scope.js`). The abort is the browser's alone; the server goes on and
   * may cross the point of no return. Read off a live desk rather than reasoned about:
   * an aborted confirm fires no `beforeSwap` and no `beforeOnLoad`, so nothing else on
   * this path ever hears about it. */
  root.addEventListener("htmx:sendAbort", recover);
  root.addEventListener("htmx:afterSwap", focusCapabilityDeletion);
  /* htmx's own cleanup is the hook, because it is the one thing every disappearance goes
   * through. Read out of the vendored copy rather than assumed: an `innerHTML` swap runs
   * `cleanUpElement` over every node it is about to remove, and that fires this event on
   * the node and then on each of its children in turn — so the panel is always reached,
   * whether the window is put away, taken by a build, or navigated off. A dismissal is
   * the one exception, and it has already retired the sentence by the time it gets here. */
  root.addEventListener("htmx:beforeCleanupElement", (event) =>
    rescueCapabilityDeletionEnding(/** @type {DeletionNode | null} */ (event.target), root),
  );
  root.addEventListener("click", (event) => {
    const target = /** @type {DeletionNode | null} */ (event.target);
    if (target?.closest?.(DELETION_EXIT_SELECTOR)) handKeyboardBackToTheDesk(root);
  });
  /* The sentence is read once its answer is about to land, so it may not also follow the
   * panel out to the prompt bar. A dismissal that never lands leaves the ending standing
   * and still owed. */
  root.addEventListener("htmx:beforeSwap", (event) => {
    const detail = /** @type {{ detail?: DeletionSwap }} */ (/** @type {unknown} */ (event)).detail;
    if (detail?.shouldSwap === false) return;
    if (!detail) return;
    const leaving = detail.requestConfig?.elt?.closest?.(DELETION_EXIT_SELECTOR);
    if (leaving) retireCapabilityDeletionEnding(leaving.closest?.(DELETION_ENDING_SELECTOR));
  });
}

if (typeof document !== "undefined") startCapabilityDeletionRecovery(document);
