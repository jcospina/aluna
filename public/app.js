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
//   2. Wires the provider liveness stream into the content area (Epic 1.5).

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} open - Sidebar shown: expanded (desktop) / drawer in (mobile).
 * @property {boolean} hasCapabilities - Whether any capability exists yet.
 * @property {() => void} init - Alpine lifecycle hook; sets the responsive default.
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
    // Sidebar shown. The default is responsive (set in init); the user's toggle
    // then stands until the next breakpoint crossing. Persistence is deferred.
    open: true,

    // No capabilities at cold-start, so the sidebar stays hidden. A later epic
    // flips this when the registry rehydrates the toolbar with entries.
    hasCapabilities: false,

    init() {
      // Desktop opens with the sidebar expanded; mobile starts with the drawer
      // closed. Re-sync on breakpoint crossings so a resized window lands on the
      // sensible default for its size (collapse chrome only — no product state).
      const desktop = window.matchMedia("(min-width: 768px)");
      this.open = desktop.matches;
      desktop.addEventListener("change", (event) => {
        this.open = event.matches;
      });
    },
  };
}

// ── Provider liveness stream (Epic 1.5 — Module 1 finalized) ──────────────────
// The trigger opens /stream (src/app.ts), where the real AI provider answers with
// a short greeting; its chunks render into the content area live — narration tokens
// append as text so the greeting assembles itself, the trailing HTML fragment (the
// invitation) appends as markup. The connection closes on the server's `done` event
// so EventSource treats the end as final and does NOT reconnect (a clean close, no
// console errors). Module 2 swaps this raw-EventSource path for the HTMX-driven one
// (ADR-0002) and the trigger for the real prompt-bar build flow.

/**
 * Read the string payload from an SSE message event. EventSource types listeners
 * for custom event names as the base Event, so narrow to MessageEvent for `.data`.
 * @param {Event} event
 * @returns {string}
 */
function sseData(event) {
  return /** @type {MessageEvent<string>} */ (event).data;
}

function initIntroStream() {
  const trigger = document.getElementById("intro-trigger");
  const output = document.getElementById("intro-output");
  if (!(trigger instanceof HTMLButtonElement) || output === null) return;

  trigger.addEventListener("click", () => {
    // Capture the idle label so teardown restores it without duplicating copy.
    const idleLabel = trigger.textContent;
    output.replaceChildren(); // clear any prior run
    trigger.disabled = true;
    trigger.textContent = "Saying hello…";

    const source = new EventSource("/stream");

    // Idempotent teardown: close the stream and return the trigger to idle. Used
    // for both the clean end (`done`) and a real transport error.
    const finish = () => {
      source.close();
      trigger.disabled = false;
      trigger.textContent = idleLabel;
    };

    source.addEventListener("narration", (event) => {
      output.append(document.createTextNode(sseData(event)));
    });
    source.addEventListener("fragment", (event) => {
      output.insertAdjacentHTML("beforeend", sseData(event));
    });
    source.addEventListener("done", finish);
    source.addEventListener("error", finish);
  });
}

// This file is deferred, so the DOM is fully parsed by the time it runs — the
// trigger/output elements already exist and can be wired directly.
initIntroStream();
