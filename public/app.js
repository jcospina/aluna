// @ts-check
//
// Authored shell glue — runs in the browser, so it is plain JavaScript served
// verbatim from /static/app.js (no transpile, no build step; the no-build rule).
// Type safety without a build: `// @ts-check` + JSDoc means the repo's existing
// `tsc --noEmit` typechecks this file with zero runtime change.
//
// Today it does three things, all presentation-only (no product logic — the shell
// is dumb on purpose, ARCH §6.1):
//   1. Registers the `shell` Alpine component (prompt courtesy state).
//   2. Hands developer-preview SSE payloads to the developer panel's window.
//   3. Promotes a build's terminal presentation once its stream closes.
//
// The tile an admitted build stands on the desk is `desk-logos.js`, a module of its own
// beside `region-scope.js` and `swap-target.js`.

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} promptBusy - Courtesy presentation state while a build stream is open.
 * @property {() => void} init - Alpine lifecycle hook; wires the stream courtesy state.
 */

// Register on `alpine:init` (dispatched at the start of Alpine.start()). This
// file is loaded before alpine.min.js precisely so this listener is in place
// when Alpine starts. `Alpine` is a global from the vendored build.
document.addEventListener("alpine:init", () => {
  // @ts-expect-error - Alpine is a runtime global, not a typed import.
  window.Alpine.data("shell", shell);
});

/**
 * Factory for the `shell` Alpine component.
 * @returns {ShellState}
 */
function shell() {
  return {
    // Courtesy prompt-bar state only — Alpine mirrors HTMX SSE open/close events in
    // the UI and decides nothing. It is not a lock: the build queue admits every job
    // it is handed, and the one-subscriber guard below is what actually holds a
    // second build off while one is running.
    promptBusy: false,

    init() {
      /** @param {boolean} clear */
      const wakePrompt = (clear) => {
        this.promptBusy = false;
        requestAnimationFrame(() => {
          const promptField = document.getElementById("spec-build-prompt");
          if (clear && promptField instanceof HTMLInputElement) promptField.value = "";
          promptField?.focus();
        });
      };

      document.addEventListener("htmx:sseOpen", () => {
        this.promptBusy = true;
      });
      document.addEventListener("htmx:sseClose", () => wakePrompt(true));
      // `htmx:sseError` fires on every transient drop while the transport is still
      // retrying, so waking on it unlocked the prompt mid-build. Wake only once the
      // connection itself is dead; the field keeps its text either way.
      document.addEventListener("htmx:sseError", (event) => {
        const source = /** @type {{detail?: {source?: {readyState?: number}}}} */ (event).detail
          ?.source;
        if (source?.readyState === EventSource.CLOSED) wakePrompt(false);
      });
    },
  };
}

// Kept in sync with public/region-scope.js (RELEASE_REGION_EVENT); a platform test pins
// that these strings match. A plain string because this classic script cannot import the
// module. Dispatching it on a content region asks that region's scope to release
// everything its current content started — before the content is replaced, so an htmx
// request still in flight can be aborted while it is connected.
const RELEASE_REGION_EVENT = "aluna:release-region";

/** @param {Element} region */
function releaseRegionContent(region) {
  region.dispatchEvent(new CustomEvent(RELEASE_REGION_EVENT, { bubbles: true }));
}

/**
 * The window's content region, and the way this script asks for the window itself to
 * be put away. Both are kept in sync with public/desk-window.js (WINDOW_CONTENT_ID and
 * PUT_WINDOW_AWAY_EVENT); a platform test pins that these strings match. Plain strings
 * because this classic script cannot import the module.
 */
const WINDOW_REGION_ID = "spec-build-output";
const PUT_WINDOW_AWAY_EVENT = "aluna:put-window-away";

/**
 * The two ways this script reaches the developer panel's window, kept in sync with
 * public/desk-dev-panel.js (STAGE_PAYLOAD_EVENT and STAGES_CLEARED_EVENT) and pinned by
 * the same platform test. One stage's payload, and a new build starting from an empty
 * panel rather than the last build's leavings.
 */
const STAGE_PAYLOAD_EVENT = "aluna:stage-payload";
const STAGES_CLEARED_EVENT = "aluna:stages-cleared";

/** One build's subscriber — the node the run's id is written on. */
const BUILD_SUBSCRIBER_SELECTOR = "[data-build-job-id]";

/**
 * Whether the window is left holding nothing. Whitespace between swapped nodes is not
 * content; nothing else in there is invisible, because the region is the one surface
 * inside the window the ink system deliberately does not draw.
 * @param {Element} region
 * @returns {boolean}
 */
function regionHoldsNothing(region) {
  for (const node of region.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "") continue;
    return false;
  }
  return true;
}

/**
 * A window that holds nothing does not exist.
 *
 * Stated as that invariant rather than as a list of the flows that reach it, because
 * the list is longer than it looks and every entry wants the same answer. Every one
 * of them is a deletion whose restoration is neutral — nothing to go back to:
 * a capability deleted, one that turned out to be already gone, a deletion refused,
 * one that failed before commit, and **Keep it** pressed with nothing behind it. In
 * all five the window is left empty and the prompt bar carries the explanation, and
 * an empty drawn frame on the desk says less than no frame at all.
 *
 * A rule keyed on emptiness has one hazard: a swap that empties the region and then
 * refills it. That is why this is asked at settle — htmx's own "I am finished with
 * this target" — rather than the moment the first content lands.
 *
 * @param {Element | null | undefined} region
 */
function putAwayEmptyWindow(region) {
  if (!(region instanceof HTMLElement) || !regionHoldsNothing(region)) return;
  document.dispatchEvent(new CustomEvent(PUT_WINDOW_AWAY_EVENT));
}

/** @param {HTMLElement} surface @returns {boolean} */
function activeViewIsCanonical(surface) {
  const collection = surface.querySelector("[data-search-state]");
  const searchInput = surface.querySelector("[data-capability-search-input]");
  const createPanel = surface.querySelector(".capability-collection__create");
  const modal = document.getElementById("aluna-detail-modal");
  const searchIsIdle =
    collection instanceof HTMLElement && collection.dataset.searchState === "idle";
  const searchIsEmpty = searchInput instanceof HTMLInputElement && searchInput.value === "";
  const createIsClosed =
    !(createPanel instanceof HTMLElement) ||
    window.getComputedStyle(createPanel).display === "none";
  const modalIsClosed = !(modal instanceof HTMLDialogElement) || !modal.open;
  return searchIsIdle && searchIsEmpty && createIsClosed && modalIsClosed;
}

/**
 * The region is not drawn — the window's own frame is the only line around it — so
 * there are no ink layers in here to look past, the way there were while the shell
 * had a content area of its own.
 * @param {HTMLElement} output @param {HTMLElement} subscriber @returns {boolean}
 */
function outputHasOnlyDormantSubscriber(output, subscriber) {
  for (const node of output.childNodes) {
    if (node === subscriber) continue;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "") continue;
    return false;
  }
  return true;
}

/**
 * @param {string | undefined} restorationKind
 * @param {{ id?: string, incarnation?: string, version?: string } | null} current
 * @param {{ id?: string, incarnation?: string, version?: string } | null} restored
 * @param {boolean} currentIsCanonical
 * @param {boolean} neutralOutput
 */
function shouldPreserveRestoration(
  restorationKind,
  current,
  restored,
  currentIsCanonical,
  neutralOutput,
) {
  if (restorationKind === "neutral") return current === null && neutralOutput;
  return (
    restorationKind === "capability" &&
    current !== null &&
    restored !== null &&
    current.id !== undefined &&
    current.incarnation !== undefined &&
    current.version !== undefined &&
    current.id === restored.id &&
    current.incarnation === restored.incarnation &&
    current.version === restored.version &&
    currentIsCanonical
  );
}

/**
 * A deterministic duplicate is a true no-op: keep the exact active View node in
 * place, surface only its product explanation, and let stream close remove the
 * dormant subscriber. Other terminal fragments retain canonical restoration.
 * @param {HTMLElement} listener
 * @param {string} raw
 * @returns {boolean}
 */
function preserveActiveView(listener, raw) {
  if (!listener.classList.contains("build-stream__fragment")) return false;

  const template = document.createElement("template");
  template.innerHTML = raw;
  const restoration = template.content.querySelector(
    '[data-build-restoration-behavior="preserve"]',
  );
  if (!(restoration instanceof HTMLElement)) return false;

  const subscriber = listener.closest("[data-build-job-id]");
  const output = subscriber?.closest(`#${WINDOW_REGION_ID}`);
  if (!(subscriber instanceof HTMLElement) || !(output instanceof HTMLElement)) return false;

  const current = output.querySelector(":scope > [data-active-capability-id]");
  const restored = restoration.querySelector("[data-active-capability-id]");
  const currentIdentity =
    current instanceof HTMLElement
      ? {
          id: current.dataset.activeCapabilityId,
          incarnation: current.dataset.activeCapabilityIncarnation,
          version: current.dataset.activeCapabilityVersion,
        }
      : null;
  const restoredIdentity =
    restored instanceof HTMLElement
      ? {
          id: restored.dataset.activeCapabilityId,
          incarnation: restored.dataset.activeCapabilityIncarnation,
          version: restored.dataset.activeCapabilityVersion,
        }
      : null;
  const shouldPreserve = shouldPreserveRestoration(
    restoration.dataset.buildRestoration,
    currentIdentity,
    restoredIdentity,
    current instanceof HTMLElement && activeViewIsCanonical(current),
    outputHasOnlyDormantSubscriber(output, subscriber),
  );
  if (!shouldPreserve) return false;

  const explanation = template.content.querySelector("#prompt-notice");
  const promptNotice = document.getElementById("prompt-notice");
  if (explanation instanceof HTMLElement && promptNotice instanceof HTMLElement) {
    promptNotice.textContent = explanation.textContent;
  }
  subscriber.dataset.preserveActiveView = "true";
  return true;
}

// ── Developer-preview delivery ──────────────────────────────────────────────
// HTMX owns the EventSource connection. Hidden `sse-swap` listener nodes cancel
// HTMX's HTML swap and hand the raw payload to the developer panel, naming which of
// the eight stages it belongs to.
//
// Handed over rather than written in place, because the panel is a window now: it may
// not be standing when a stage arrives, and a developer who starts a build and *then*
// opens it should still find every stage that has already run. The panel keeps them
// (`public/desk-dev-panel.js`); this only says what came down the wire. The event name
// is the seam a classic script can reach a module across, and a platform test pins the
// string at both ends.
document.addEventListener("htmx:sseBeforeMessage", (event) => {
  const listener = event.target;
  if (!(listener instanceof HTMLElement)) return;

  const message = /** @type {CustomEvent<MessageEvent<string>>} */ (event).detail;
  if (preserveActiveView(listener, message.data)) {
    event.preventDefault();
    return;
  }

  const stage = listener.dataset.previewStage;
  if (!stage) return;

  event.preventDefault();
  document.dispatchEvent(
    new CustomEvent(STAGE_PAYLOAD_EVENT, { detail: { stage, payload: message.data } }),
  );
});

/**
 * The surface of the capability standing in the window: a direct child of the region,
 * never a descendant. A build narrates beside what it displaced and carries a copy of that
 * surface inside its own subscriber; only the one standing beside it is what the window is
 * showing, and only that one may name what a build displaces
 * (public/desk-window.js `capabilityInWindow` owns the rule).
 * @returns {HTMLElement | null}
 */
function activeCapabilitySurface() {
  const output = document.getElementById(WINDOW_REGION_ID);
  const surface = output?.querySelector(":scope > [data-active-capability-id]");
  return surface instanceof HTMLElement ? surface : null;
}

// Capture the exact active registry identity before POST /prompt appends its dormant
// subscriber. The server validates both hints and stores only this data-free
// descriptor on the ephemeral job.
/**
 * @param {{ elt?: Element, parameters?: Record<string, unknown> }} detail
 * @returns {boolean}
 */
function configureCapabilityDeletionRestoration(detail) {
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

document.addEventListener("htmx:configRequest", (event) => {
  const detail =
    /** @type {CustomEvent<{ elt?: Element, parameters?: Record<string, unknown> }>} */ (event)
      .detail;
  if (configureCapabilityDeletionRestoration(detail)) return;
  const trigger = detail?.elt;
  if (!(trigger instanceof HTMLFormElement) || trigger.id !== "spec-build-form") return;
  const surface = activeCapabilitySurface();
  if (surface === null || !detail.parameters) return;
  const capabilityId = surface.dataset.activeCapabilityId;
  const incarnationId = surface.dataset.activeCapabilityIncarnation;
  if (!capabilityId || !incarnationId) return;
  detail.parameters.__aluna_restore_capability_id = capabilityId;
  detail.parameters.__aluna_restore_incarnation_id = incarnationId;
});

// Appending keeps the active View stable while intent is still unknown. Enforce one
// subscriber at admission so HTMX's queued-submit window cannot create siblings,
// and retire any explanation from the preceding request.
//
// The subscriber lives inside the window, so a window that has been put away leaves no
// subscriber to find — which is correct rather than a hole: putting the window away
// cancels the run it was narrating (desk-window.js), so there is nothing left to be
// the second of.
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  if (!(detail?.elt instanceof HTMLFormElement) || detail.elt.id !== "spec-build-form") return;
  const output = document.getElementById(WINDOW_REGION_ID);
  if (output?.querySelector("[data-build-job-id]")) {
    event.preventDefault();
    return;
  }
  document.getElementById("prompt-notice")?.replaceChildren();
});

/**
 * A new build starts from an empty panel — and only a build that was actually
 * admitted.
 *
 * The old clear was an out-of-band swap inside the subscriber fragment, so it landed
 * only when the server returned one. Clearing on the *request* instead would let
 * every refusal — a blank prompt, a queued sibling, a 500 — wipe the panel, including
 * the lifecycle history the page seeded, which nothing restores until a reload. So
 * this waits for the subscriber to arrive and keys off its job id, which also means a
 * re-swap of the same subscriber cannot clear a build's own stages out from under it.
 */
let clearedForJob = "";
document.addEventListener("htmx:afterSwap", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const subscriber =
    target.closest(BUILD_SUBSCRIBER_SELECTOR) ?? target.querySelector(BUILD_SUBSCRIBER_SELECTOR);
  const jobId = subscriber instanceof HTMLElement ? subscriber.dataset.buildJobId : undefined;
  if (!jobId || jobId === clearedForJob) return;
  clearedForJob = jobId;
  document.dispatchEvent(new CustomEvent(STAGES_CLEARED_EVENT));
});

// HTMX keeps error responses out of the DOM by default. Structured form refusals are
// the exception: the router retargets them to the active create/edit/delete aria-live error
// region, while leaving the response unsuccessful so values and modal state survive.
document.addEventListener("htmx:beforeSwap", (event) => {
  const detail = /** @type {CustomEvent<{ xhr: XMLHttpRequest, shouldSwap: boolean }>} */ (event)
    .detail;
  const response = detail?.xhr?.responseText;
  // 409 is the read-gate refusal while a deletion drains: the capability is briefly
  // unreadable, not broken. It has to be listed here or htmx drops it and the click
  // looks like it did nothing.
  if (![404, 409, 422, 500].includes(detail?.xhr?.status) || typeof response !== "string") return;
  const isStructuredFormRefusal = [
    "missing_required_fields",
    "mutation_busy",
    "read_unavailable",
    "record_not_found",
    "mutation_failed",
  ].some((code) => response.includes(`data-error-code="${code}"`));
  if (!isStructuredFormRefusal) return;

  detail.shouldSwap = true;
});

// Repeated-value controls are platform presentation. Event delegation keeps them
// working in forms HTMX swaps in after page load without per-form script tags.
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;

  const button = event.target.closest("[data-list-field-add], [data-list-field-remove]");
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.hasAttribute("data-list-field-add")) addListFieldRow(button);
  else removeListFieldRow(button);
});

/** @param {HTMLButtonElement} button */
function addListFieldRow(button) {
  const field = button.closest("[data-list-field]");
  const values = field?.querySelector("[data-list-field-values]");
  const firstRow = values?.querySelector("[data-list-field-row]");
  if (!(field instanceof HTMLElement) || !(values instanceof HTMLElement) || !firstRow) return;

  const row = firstRow.cloneNode(true);
  if (!(row instanceof HTMLElement)) return;
  const input = row.querySelector("input");
  if (input instanceof HTMLInputElement) input.value = "";
  values.append(row);
  syncListFieldRows(field);
  input?.focus();
}

/** @param {HTMLButtonElement} button */
function removeListFieldRow(button) {
  const field = button.closest("[data-list-field]");
  const row = button.closest("[data-list-field-row]");
  if (!(field instanceof HTMLElement) || !(row instanceof HTMLElement)) return;

  const rows = field.querySelectorAll("[data-list-field-row]");
  if (rows.length === 1) {
    const input = row.querySelector("input");
    if (input instanceof HTMLInputElement) input.value = "";
    input?.focus();
    return;
  }
  row.remove();
  syncListFieldRows(field);
}

/** @param {HTMLFormElement} form */
function collapseListFieldRows(form) {
  for (const field of Element.prototype.querySelectorAll.call(form, "[data-list-field]")) {
    if (!(field instanceof HTMLElement)) continue;
    const rows = [...field.querySelectorAll("[data-list-field-row]")];
    for (const row of rows.slice(1)) row.remove();
    syncListFieldRows(field);
  }
}

document.addEventListener("aluna:record-created", (event) => {
  if (event.target instanceof HTMLFormElement) collapseListFieldRows(event.target);
});

document.addEventListener("aluna:create-cancelled", (event) => {
  const trigger = event.target;
  const form = trigger instanceof Element ? Element.prototype.closest.call(trigger, "form") : null;
  if (form instanceof HTMLFormElement) collapseListFieldRows(form);
});

/** @param {HTMLElement} field */
function syncListFieldRows(field) {
  const label = field.dataset.listFieldLabel ?? "Value";
  const inputId = field.dataset.listInputId ?? "list-value";
  const rows = field.querySelectorAll("[data-list-field-row]");

  rows.forEach((row, index) => {
    const input = row.querySelector("input");
    const remove = row.querySelector("[data-list-field-remove]");
    if (input instanceof HTMLInputElement) {
      input.id = `${inputId}-${index + 1}`;
      input.setAttribute("aria-label", `${label} ${index + 1}`);
    }
    if (remove instanceof HTMLButtonElement) {
      remove.setAttribute("aria-label", `Remove ${label} value ${index + 1}`);
    }
  });
}

/**
 * The window's content changed hands. The desk owns what the address does about it — this
 * classic script cannot import the module that owns it, so it says what happened rather
 * than deciding (ARCH §6.1: the shell presents, it never decides).
 *
 * `navigated` is true only where a capability *took* the window: a build's successful v1
 * activation, whose canonical collection is standing somewhere for the first time. Kept
 * in sync with public/desk-window.js (WINDOW_TOOK_CAPABILITY_EVENT); a platform test pins
 * that these strings match.
 * @param {boolean} navigated
 */
function tellDeskTheWindowTookCapability(navigated) {
  document.dispatchEvent(
    new CustomEvent("aluna:window-took-capability", { detail: { navigated } }),
  );
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
function capabilityDeletionPreflightUrl(form) {
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
function recoverSeveredCapabilityDeletion(event) {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  const form = detail?.elt;
  if (!(form instanceof Element)) return;
  const preflightUrl = capabilityDeletionPreflightUrl(form);
  if (preflightUrl === null) return;

  writeCapabilityDeletionRecheckNotice("Something interrupted that. Let me check what happened…");
  void recheckCapabilityDeletion(preflightUrl, 0);
}

/** @param {Event} event */
function focusCapabilityDeletion(event) {
  const target =
    event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
      ? event.detail.target
      : undefined;
  if (!(target instanceof Element)) return;
  const heading = target.querySelector("[data-capability-deletion-focus]");
  if (!(heading instanceof HTMLElement)) return;
  requestAnimationFrame(() => heading.focus());
}

/** @param {HTMLElement} subscriber */
// `activated` is the one thing the address cares about: a `commit` is a real pointer
// activation, and its capability's canonical collection is taking the window. Every
// restoration puts back what the build displaced and navigated nowhere, so it may not
// leave an entry behind — not even when it lands after the user has opened something
// else and the address has moved on without it.
function terminalPresentationContent(subscriber) {
  const restoration = subscriber.querySelector("[data-build-restoration]");
  if (restoration instanceof HTMLElement) {
    return {
      element: restoration,
      promoteElement: false,
      restorationKind: restoration.dataset.buildRestoration,
      activated: false,
    };
  }
  const commit = subscriber.querySelector(".build-stream__commit");
  if (commit instanceof HTMLElement && commit.childNodes.length > 0) {
    return { element: commit, promoteElement: false, restorationKind: undefined, activated: true };
  }
  const narration = subscriber.querySelector(".build-stream__narration");
  return narration instanceof HTMLElement && narration.childNodes.length > 0
    ? { element: narration, promoteElement: true, restorationKind: undefined, activated: false }
    : null;
}

/**
 * Re-load a restored capability's records after promotion. Commit promotions are
 * left alone: HTMX already processed the commit content inside the subscriber (the
 * records region's `load` trigger fired there), so re-fetching would only re-render
 * records that are already live — a visible flicker on every successful build.
 * @param {HTMLElement} output
 * @param {string | undefined} restorationKind
 */
function reloadRestoredRecords(output, restorationKind) {
  if (restorationKind !== "capability") return;
  const records = output.querySelector('[hx-get][hx-trigger~="load"]');
  if (!(records instanceof HTMLElement)) return;
  const readUrl = records.getAttribute("hx-get");
  const htmx =
    /** @type {Window & { htmx?: { ajax(method: string, url: string, context: { source: Element, target: Element, swap: string }): Promise<unknown>, trigger(node: Element, eventName: string): void } }} */ (
      window
    ).htmx;
  if (!htmx || !readUrl) return;
  htmx.trigger(records, "htmx:abort");
  records.removeAttribute("hx-get");
  records.removeAttribute("hx-trigger");
  void htmx
    .ajax("GET", readUrl, { source: records, target: records, swap: "innerHTML" })
    .catch(() => undefined);
}

/** @param {HTMLElement} subscriber @param {HTMLElement} output */
function promoteTerminalPresentation(subscriber, output) {
  const terminal = terminalPresentationContent(subscriber);
  if (terminal !== null) {
    releaseRegionContent(output);
    if (terminal.promoteElement) output.replaceChildren(terminal.element);
    else output.replaceChildren(...terminal.element.childNodes);
    reloadRestoredRecords(output, terminal.restorationKind);
  } else {
    releaseRegionContent(subscriber);
    subscriber.remove();
  }
  return { restorationKind: terminal?.restorationKind, activated: terminal?.activated === true };
}

/**
 * @param {EventTarget | null} eventTarget
 * @returns {boolean} whether a real pointer activation took the window
 */
function finishTerminalPresentation(eventTarget) {
  if (!(eventTarget instanceof Element)) return false;
  const subscriber = eventTarget.closest("[data-build-job-id]");
  const output = subscriber?.closest(`#${WINDOW_REGION_ID}`);
  if (!(subscriber instanceof HTMLElement) || !(output instanceof HTMLElement)) return false;

  if (subscriber.dataset.preserveActiveView === "true") {
    // Scoped to the subscriber, not the region: the preserved active view stays. Dispatched
    // before the detach because `abortTransportIn` can only abort a connected node's
    // request — the observer sweep behind it cannot.
    releaseRegionContent(subscriber);
    subscriber.remove();
    return false;
  }

  const { restorationKind, activated } = promoteTerminalPresentation(subscriber, output);
  putAwayEmptyWindow(output);

  const modal = document.getElementById("aluna-detail-modal");
  if (modal instanceof HTMLDialogElement && modal.open) modal.close();

  if (
    restorationKind === "neutral" &&
    (window.location.pathname !== "/" || window.location.search !== "")
  ) {
    window.history.replaceState(window.history.state, "", "/");
  }
  return activated;
}

document.addEventListener("htmx:sendError", recoverSeveredCapabilityDeletion);
document.addEventListener("htmx:timeout", recoverSeveredCapabilityDeletion);
document.addEventListener("htmx:afterSwap", (event) => {
  // A swap is not a navigation: whatever navigated pushed its own address before the
  // request went out, so this only ever catches the address up with a window that
  // changed hands underneath it — a cancelled deletion putting the previous capability
  // back is the one that does.
  tellDeskTheWindowTookCapability(false);
  focusCapabilityDeletion(event);
});
document.addEventListener("htmx:afterSettle", (event) => {
  const target = /** @type {CustomEvent<{ target?: unknown }>} */ (event).detail?.target;
  // Only a swap of the region itself can have emptied it; a swap into something inside
  // it — the records region reloading — never leaves the window with nothing in it.
  if (target instanceof HTMLElement && target.id === WINDOW_REGION_ID) {
    putAwayEmptyWindow(target);
  }
});
document.addEventListener("htmx:sseClose", (event) => {
  const closeType =
    event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
      ? event.detail.type
      : undefined;
  if (closeType !== "message") return;
  // Only a real pointer activation navigated: its capability's canonical collection is
  // standing somewhere for the first time. A restoration puts back what the build
  // displaced and is owed no entry — least of all when it lands after the user has opened
  // something else and the address has already moved on without it.
  tellDeskTheWindowTookCapability(finishTerminalPresentation(event.target));
});
