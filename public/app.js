// @ts-check
//
// Authored shell glue — runs in the browser, so it is plain JavaScript served
// verbatim from /static/app.js (no transpile, no build step; the no-build rule).
// Type safety without a build: `// @ts-check` + JSDoc means the repo's existing
// `tsc --noEmit` typechecks this file with zero runtime change.
//
// Today it does two things, both presentation-only (no product logic — the shell
// is dumb on purpose, ARCH §6.1):
//   1. Registers the `shell` Alpine component (sidebar collapse / mobile drawer).
//   2. Renders developer-preview SSE payloads as plain text after HTMX receives them.

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} open - Capability toolbar shown: expanded (desktop) / drawer in (mobile).
 * @property {boolean} devbarOpen - Developer panel shown: expanded (desktop) / drawer in (mobile).
 * @property {boolean} hasCapabilities - Whether any capability exists yet.
 * @property {boolean} promptBusy - Courtesy presentation state while a build stream is open.
 * @property {() => void} init - Alpine lifecycle hook; sets the responsive defaults.
 */

/**
 * The tiny slice of Alpine's runtime API this authored file uses outside the
 * component registration path.
 * @typedef {Object} AlpineGlobal
 * @property {(el: Element) => unknown} $data
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
    // Capability toolbar shown. The default is responsive (set in init); the
    // user's toggle then stands until the next breakpoint crossing. Persistence
    // is deferred.
    open: true,

    // Developer panel shown. Starts closed on every viewport — the panel is a
    // developer surface, not the default view. Stages stream into it whether it
    // is open or not (the handlers write unconditionally), so opening it mid-build
    // reveals the full latest state; nothing is missed by starting closed.
    devbarOpen: false,

    // No capabilities at cold-start, so the toolbar stays hidden. A later epic
    // flips this when the registry rehydrates the toolbar with entries.
    hasCapabilities: false,

    // Courtesy prompt-bar state only. The server is still the single-flight
    // authority; Alpine just mirrors HTMX SSE open/close events in the UI.
    promptBusy: false,

    init() {
      this.hasCapabilities = document.querySelector("[data-capability-entry]") !== null;

      // Desktop opens the capability toolbar expanded; mobile starts with its
      // drawer closed. Re-sync on breakpoint crossings so a resized window lands
      // on the sensible default for its size (collapse chrome only — no product
      // state). The developer panel is left out: it starts closed everywhere and
      // only opens when the user toggles it.
      const desktop = window.matchMedia("(min-width: 768px)");
      this.open = desktop.matches;
      desktop.addEventListener("change", (event) => {
        this.open = event.matches;
      });

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
      document.addEventListener("htmx:sseError", () => wakePrompt(false));
    },
  };
}

/**
 * Pretty-print a structured developer-preview payload, falling back to the raw
 * string if a future event sends non-JSON text.
 * @param {string} raw
 * @returns {string}
 */
function formatPreviewPayload(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
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

/** @param {HTMLElement} output @param {HTMLElement} subscriber @returns {boolean} */
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
  const output = subscriber?.closest("#spec-build-output");
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

// ── Developer-preview rendering (Module 2) ──────────────────────────────────
// HTMX owns the EventSource connection. For the developer panel only, hidden
// `sse-swap` listener nodes cancel HTMX's HTML swap and write the event payload as
// text into the target <pre>, preserving the existing liveness surface without
// reopening a raw EventSource path in app.js.
document.addEventListener("htmx:sseBeforeMessage", (event) => {
  const listener = event.target;
  if (!(listener instanceof HTMLElement)) return;

  const message = /** @type {CustomEvent<MessageEvent<string>>} */ (event).detail;
  if (preserveActiveView(listener, message.data)) {
    event.preventDefault();
    return;
  }

  const previewTargetId = listener.dataset.previewTarget;
  if (!previewTargetId) return;

  event.preventDefault();

  const previewTarget = document.getElementById(previewTargetId);
  if (previewTarget === null) return;

  previewTarget.textContent = formatPreviewPayload(message.data);
});

// Capture the exact active registry identity before POST /prompt appends its dormant
// subscriber. The server validates both hints and stores only this data-free
// descriptor on the ephemeral job.
document.addEventListener("htmx:configRequest", (event) => {
  const detail =
    /** @type {CustomEvent<{ elt?: Element, parameters?: Record<string, unknown> }>} */ (event)
      .detail;
  if (!(detail?.elt instanceof HTMLFormElement) || detail.elt.id !== "spec-build-form") return;
  const surface = document.querySelector("[data-active-capability-id]");
  if (!(surface instanceof HTMLElement) || !detail.parameters) return;
  const capabilityId = surface.dataset.activeCapabilityId;
  const incarnationId = surface.dataset.activeCapabilityIncarnation;
  if (!capabilityId || !incarnationId) return;
  detail.parameters.__aluna_restore_capability_id = capabilityId;
  detail.parameters.__aluna_restore_incarnation_id = incarnationId;
});

// Appending keeps the active View stable while intent is still unknown. Enforce one
// subscriber at admission so HTMX's queued-submit window cannot create siblings,
// and retire any explanation from the preceding request.
document.addEventListener("htmx:beforeRequest", (event) => {
  const detail = /** @type {CustomEvent<{ elt?: Element }>} */ (event).detail;
  if (!(detail?.elt instanceof HTMLFormElement) || detail.elt.id !== "spec-build-form") return;
  const output = document.querySelector("#spec-build-output");
  if (output?.querySelector("[data-build-job-id]")) {
    event.preventDefault();
    return;
  }
  document.getElementById("prompt-notice")?.replaceChildren();
});

// HTMX keeps error responses out of the DOM by default. Structured form refusals are
// the exception: the router retargets them to the active create/edit/delete aria-live error
// region, while leaving the response unsuccessful so values and modal state survive.
document.addEventListener("htmx:beforeSwap", (event) => {
  const detail = /** @type {CustomEvent<{ xhr: XMLHttpRequest, shouldSwap: boolean }>} */ (event)
    .detail;
  const response = detail?.xhr?.responseText;
  if (![404, 422, 500].includes(detail?.xhr?.status) || typeof response !== "string") return;
  const isStructuredFormRefusal = [
    "missing_required_fields",
    "mutation_busy",
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
 * Find the shell component's Alpine state. This is presentation-only glue: HTMX
 * swaps the toolbar entry, and Alpine mirrors whether the sidebar chrome should be
 * visible.
 * @returns {ShellState | null}
 */
function getShellPresentationState() {
  const root = document.querySelector(".shell");
  const alpine = /** @type {Window & { Alpine?: AlpineGlobal }} */ (window).Alpine;
  if (!(root instanceof Element) || typeof alpine?.$data !== "function") return null;

  const state = alpine.$data(root);
  if (typeof state !== "object" || state === null) return null;
  return /** @type {ShellState} */ (state);
}

function syncCapabilityPresentationState() {
  const state = getShellPresentationState();
  if (state === null) return;

  state.hasCapabilities = document.querySelector("[data-capability-entry]") !== null;
}

function syncActiveCapabilityUrl() {
  const surface = document.querySelector("[data-active-capability-id]");
  if (!(surface instanceof HTMLElement)) return;
  if (surface.closest("[data-build-restoration]")) return;

  const capabilityId = surface.dataset.activeCapabilityId;
  if (!capabilityId) return;

  const capabilityUrl = `/capability/${encodeURIComponent(capabilityId)}`;
  if (window.location.pathname === capabilityUrl && window.location.search === "") return;

  window.history.replaceState(window.history.state, "", capabilityUrl);
}

/** @param {HTMLElement} subscriber */
function terminalPresentationContent(subscriber) {
  const restoration = subscriber.querySelector("[data-build-restoration]");
  if (restoration instanceof HTMLElement) {
    return {
      element: restoration,
      promoteElement: false,
      restorationKind: restoration.dataset.buildRestoration,
    };
  }
  const commit = subscriber.querySelector(".build-stream__commit");
  if (commit instanceof HTMLElement && commit.childNodes.length > 0) {
    return { element: commit, promoteElement: false, restorationKind: undefined };
  }
  const narration = subscriber.querySelector(".build-stream__narration");
  return narration instanceof HTMLElement && narration.childNodes.length > 0
    ? { element: narration, promoteElement: true, restorationKind: undefined }
    : null;
}

/** @param {HTMLElement} output @param {string | undefined} restorationKind */
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
    if (terminal.promoteElement) output.replaceChildren(terminal.element);
    else output.replaceChildren(...terminal.element.childNodes);
    reloadRestoredRecords(output, terminal.restorationKind);
  } else {
    subscriber.remove();
  }
  return terminal?.restorationKind;
}

/** @param {EventTarget | null} eventTarget */
function finishTerminalPresentation(eventTarget) {
  if (!(eventTarget instanceof Element)) return;
  const subscriber = eventTarget.closest("[data-build-job-id]");
  const output = subscriber?.closest("#spec-build-output");
  if (!(subscriber instanceof HTMLElement) || !(output instanceof HTMLElement)) return;

  if (subscriber.dataset.preserveActiveView === "true") {
    subscriber.remove();
    return;
  }

  const restorationKind = promoteTerminalPresentation(subscriber, output);

  const modal = document.getElementById("aluna-detail-modal");
  if (modal instanceof HTMLDialogElement && modal.open) modal.close();

  if (
    restorationKind === "neutral" &&
    (window.location.pathname !== "/" || window.location.search !== "")
  ) {
    window.history.replaceState(window.history.state, "", "/");
  }
}

document.addEventListener("htmx:oobAfterSwap", syncCapabilityPresentationState);
document.addEventListener("htmx:afterSwap", () => {
  syncCapabilityPresentationState();
  syncActiveCapabilityUrl();
});
document.addEventListener("htmx:sseClose", (event) => {
  const closeType =
    event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
      ? event.detail.type
      : undefined;
  if (closeType !== "message") return;
  finishTerminalPresentation(event.target);
  syncCapabilityPresentationState();
  syncActiveCapabilityUrl();
});
