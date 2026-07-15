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

// ── Developer-preview rendering (Module 2) ──────────────────────────────────
// HTMX owns the EventSource connection. For the developer panel only, hidden
// `sse-swap` listener nodes cancel HTMX's HTML swap and write the event payload as
// text into the target <pre>, preserving the existing liveness surface without
// reopening a raw EventSource path in app.js.
document.addEventListener("htmx:sseBeforeMessage", (event) => {
  const listener = event.target;
  if (!(listener instanceof HTMLElement)) return;

  const previewTargetId = listener.dataset.previewTarget;
  if (!previewTargetId) return;

  event.preventDefault();

  const previewTarget = document.getElementById(previewTargetId);
  if (previewTarget === null) return;

  const message = /** @type {CustomEvent<MessageEvent<string>>} */ (event).detail;
  previewTarget.textContent = formatPreviewPayload(message.data);
});

// HTMX keeps 4xx responses out of the DOM by default. Structured create
// validation is the exception: the router retargets it to the form's aria-live
// error region, while leaving the response marked unsuccessful so the form stays
// open and its values are preserved.
document.addEventListener("htmx:beforeSwap", (event) => {
  const detail = /** @type {CustomEvent<{ xhr: XMLHttpRequest, shouldSwap: boolean }>} */ (event)
    .detail;
  const response = detail?.xhr?.responseText;
  if (detail?.xhr?.status !== 422 || typeof response !== "string") return;
  if (!response.includes('data-error-code="missing_required_fields"')) return;

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

document.addEventListener("aluna:record-created", (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  for (const field of event.target.querySelectorAll("[data-list-field]")) {
    if (!(field instanceof HTMLElement)) continue;
    const rows = [...field.querySelectorAll("[data-list-field-row]")];
    for (const row of rows.slice(1)) row.remove();
    syncListFieldRows(field);
  }
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

  const capabilityId = surface.dataset.activeCapabilityId;
  if (!capabilityId) return;

  const capabilityUrl = `/capability/${encodeURIComponent(capabilityId)}`;
  if (window.location.pathname === capabilityUrl && window.location.search === "") return;

  window.history.replaceState(window.history.state, "", capabilityUrl);
}

document.addEventListener("htmx:oobAfterSwap", syncCapabilityPresentationState);
document.addEventListener("htmx:afterSwap", () => {
  syncCapabilityPresentationState();
  syncActiveCapabilityUrl();
});
