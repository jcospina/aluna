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
 */

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

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/** @returns {HTMLElement | null} */
function activeCapabilitySurface() {
  const output = document.getElementById(WINDOW_REGION_ID);
  const surface = output?.querySelector(":scope > [data-active-capability-id]");
  return surface instanceof HTMLElement ? surface : null;
}

/**
 * Capture the exact active registry identity before the deletion's POST goes out. The
 * server validates both hints and stores only the data-free descriptor.
 *
 * @param {{ elt?: Element, parameters?: Record<string, unknown> }} detail
 * @returns {boolean} whether this request was a deletion
 */
export function configureCapabilityDeletionRestoration(detail) {
  const trigger = detail.elt;
  if (!(trigger instanceof Element) || !trigger.matches("[data-capability-delete]")) return false;
  if (detail.parameters) detail.parameters.restore_surface = "neutral";
  const surface = activeCapabilitySurface();
  if (surface === null || !detail.parameters) return true;
  const capabilityId = surface.dataset.activeCapabilityId;
  const incarnationId = surface.dataset.activeCapabilityIncarnation;
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
 * @param {Element} form
 * @returns {string | null}
 */
export function capabilityDeletionPreflightUrl(form) {
  const base = form.getAttribute("data-capability-deletion-confirm");
  if (!base) return null;
  const query = new URLSearchParams();
  for (const name of ["restore_surface", "restore_capability_id", "restore_incarnation_id"]) {
    const field = form.querySelector(`input[name="${name}"]`);
    if (field instanceof HTMLInputElement && field.value) query.set(name, field.value);
  }
  const suffix = query.toString();
  return suffix ? `${base}?${suffix}` : base;
}

/** @param {string} copy */
function writeCapabilityDeletionRecheckNotice(copy) {
  const notice = document.getElementById("prompt-notice");
  if (notice instanceof HTMLElement) notice.textContent = copy;
}

/**
 * @param {string} preflightUrl
 * @param {number} attempt
 * @returns {Promise<void>}
 */
async function recheckCapabilityDeletion(preflightUrl, attempt) {
  const delay = CAPABILITY_DELETION_RECHECK_DELAYS_MS[attempt];
  if (delay === undefined) {
    writeCapabilityDeletionRecheckNotice(
      "I still can’t tell what happened. Reload the page to see the latest.",
    );
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delay));

  const response = await fetch(preflightUrl, { headers: { "HX-Request": "true" } }).catch(
    () => null,
  );
  if (response === null || !response.ok) {
    await recheckCapabilityDeletion(preflightUrl, attempt + 1);
    return;
  }

  const html = await response.text();

  // The window may have been put away while this was in flight. That is the *good*
  // ending — the danger this recovery exists for is a stale confirmation panel left
  // standing, and there is no panel left to be stale. What is still owed is the
  // answer, so it is read out of the reply and left at the prompt bar rather than
  // reported as "I can't tell", which would be untrue: we just found out.
  const output = document.getElementById(WINDOW_REGION_ID);
  if (!(output instanceof HTMLElement)) {
    writeCapabilityDeletionRecheckNotice(noticeIn(html));
    applyReplaceUrl(response);
    return;
  }
  const htmx =
    /** @type {Window & { htmx?: { swap(target: Element, content: string, spec: { swapStyle: string, swapDelay: number, settleDelay: number }): void } }} */ (
      window
    ).htmx;
  // Retire the "checking" line first so an out-of-band notice in the answer — the one
  // that explains a capability turning out to be already gone — is what the user is
  // left reading.
  writeCapabilityDeletionRecheckNotice("");
  releaseRegionContent(output);
  if (htmx) htmx.swap(output, html, { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 });
  else output.innerHTML = html;

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
 * What a deletion reply says to the user, read out of the out-of-band notice it
 * carries. Parsed into an inert template, so nothing in it runs or loads.
 * @param {string} html
 * @returns {string}
 */
function noticeIn(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return (
    template.content.querySelector("#prompt-notice")?.textContent?.trim() ||
    "That’s sorted — the desk is up to date."
  );
}

/** @param {Event} event */
export function recoverSeveredCapabilityDeletion(event) {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  const form = detail?.elt;
  if (!(form instanceof Element)) return;
  const preflightUrl = capabilityDeletionPreflightUrl(form);
  if (preflightUrl === null) return;

  writeCapabilityDeletionRecheckNotice("Something interrupted that. Let me check what happened…");
  void recheckCapabilityDeletion(preflightUrl, 0);
}

/** @param {Event} event */
export function focusCapabilityDeletion(event) {
  const target =
    event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
      ? event.detail.target
      : undefined;
  if (!(target instanceof Element)) return;
  const heading = target.querySelector("[data-capability-deletion-focus]");
  if (!(heading instanceof HTMLElement)) return;
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
    if (detail) configureCapabilityDeletionRestoration(detail);
  });
  root.addEventListener("htmx:sendError", recoverSeveredCapabilityDeletion);
  root.addEventListener("htmx:timeout", recoverSeveredCapabilityDeletion);
  root.addEventListener("htmx:afterSwap", focusCapabilityDeletion);
}

if (typeof document !== "undefined") startCapabilityDeletionRecovery(document);
