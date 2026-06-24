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
//   2. Wires the prompt bar to the spec-generation verification stream.

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

/**
 * Read the string payload from an SSE message event. EventSource types listeners
 * for custom event names as the base Event, so narrow to MessageEvent for `.data`.
 * @param {Event} event
 * @returns {string}
 */
function sseData(event) {
  return /** @type {MessageEvent<string>} */ (event).data;
}

// ── Spec-generation verification stream (Module 2 §2.5b+) ───────────────────
// The real prompt bar now sends its text to /demo/spec-build (src/app.ts), where
// the current builder stage runs against the AI provider. Product-voice narration
// renders into the content area, while the raw streamed spec remains visible as a
// developer verification surface until the production build stream replaces it.

function initSpecBuildDemo() {
  const form = document.getElementById("spec-build-form");
  const trigger = document.getElementById("spec-build-trigger");
  const input = document.getElementById("spec-build-prompt");
  const output = document.getElementById("spec-build-output");
  const preview = document.getElementById("spec-build-preview");
  const migrationPreview = document.getElementById("spec-migration-preview");
  const unitsPreview = document.getElementById("spec-units-preview");
  const gatePreview = document.getElementById("spec-gate-preview");
  if (
    !(form instanceof HTMLFormElement) ||
    !(trigger instanceof HTMLButtonElement) ||
    !(input instanceof HTMLInputElement) ||
    output === null ||
    preview === null ||
    migrationPreview === null ||
    unitsPreview === null ||
    gatePreview === null
  ) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const idleLabel = trigger.textContent;
    output.replaceChildren(); // clear any prior run
    preview.textContent = "";
    migrationPreview.textContent = "";
    unitsPreview.textContent = "";
    gatePreview.textContent = "";
    trigger.disabled = true;
    input.disabled = true;
    trigger.textContent = "Making";

    // EventSource is GET-only, so the typed prompt rides a query param. An empty
    // field lets the server fall back to its default demo prompt.
    const prompt = input.value.trim();
    const query = prompt.length > 0 ? `?prompt=${encodeURIComponent(prompt)}` : "";
    const source = new EventSource(`/demo/spec-build${query}`);

    const finish = () => {
      source.close();
      trigger.disabled = false;
      input.disabled = false;
      trigger.textContent = idleLabel;
      input.focus();
    };

    source.addEventListener("narration", (event) => {
      output.append(document.createTextNode(sseData(event)));
    });
    // Demo-only: each snapshot is the spec so far (more complete each time), shown
    // pretty-printed as plain text (never as markup — it's untrusted model output).
    source.addEventListener("spec-preview", (event) => {
      const raw = sseData(event);
      try {
        preview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        preview.textContent = raw;
      }
    });
    source.addEventListener("migration-preview", (event) => {
      const raw = sseData(event);
      try {
        migrationPreview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        migrationPreview.textContent = raw;
      }
    });
    source.addEventListener("units-preview", (event) => {
      const raw = sseData(event);
      try {
        unitsPreview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        unitsPreview.textContent = raw;
      }
    });
    source.addEventListener("gate-preview", (event) => {
      const raw = sseData(event);
      try {
        gatePreview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        gatePreview.textContent = raw;
      }
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
initSpecBuildDemo();
