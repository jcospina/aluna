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
//   2. Wires the prompt bar to the build-job stream.

/**
 * The shell's presentation state.
 * @typedef {Object} ShellState
 * @property {boolean} open - Capability toolbar shown: expanded (desktop) / drawer in (mobile).
 * @property {boolean} devbarOpen - Developer panel shown: expanded (desktop) / drawer in (mobile).
 * @property {boolean} hasCapabilities - Whether any capability exists yet.
 * @property {() => void} init - Alpine lifecycle hook; sets the responsive defaults.
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

    init() {
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

// ── Build-job stream (Module 2) ─────────────────────────────────────────────
// The prompt bar submits to POST /prompt. That POST only admits the job and returns
// the per-build stream address; classification and any builder work happen on
// GET /build/:id/stream. Product-voice narration renders into the content area;
// raw streamed stage previews stay visible as a developer surface.

function initSpecBuildDemo() {
  const form = document.getElementById("spec-build-form");
  const trigger = document.getElementById("spec-build-trigger");
  const input = document.getElementById("spec-build-prompt");
  const output = document.getElementById("spec-build-output");
  const preview = document.getElementById("spec-build-preview");
  const migrationPreview = document.getElementById("spec-migration-preview");
  const unitsPreview = document.getElementById("spec-units-preview");
  const gatePreview = document.getElementById("spec-gate-preview");
  const commitPreview = document.getElementById("spec-commit-preview");
  const notice = document.getElementById("prompt-notice");
  if (
    !(form instanceof HTMLFormElement) ||
    !(trigger instanceof HTMLButtonElement) ||
    !(input instanceof HTMLInputElement) ||
    output === null ||
    preview === null ||
    migrationPreview === null ||
    unitsPreview === null ||
    gatePreview === null ||
    commitPreview === null ||
    notice === null
  ) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const idleLabel = trigger.textContent;
    /** @type {EventSource | undefined} */
    let source;
    output.replaceChildren(); // clear any prior run
    notice.replaceChildren();
    preview.textContent = "";
    migrationPreview.textContent = "";
    unitsPreview.textContent = "";
    gatePreview.textContent = "";
    commitPreview.textContent = "";
    trigger.disabled = true;
    input.disabled = true;
    trigger.textContent = "Making";

    const finish = () => {
      source?.close();
      trigger.disabled = false;
      input.disabled = false;
      trigger.textContent = idleLabel;
      input.focus();
    };

    const prompt = input.value.trim();
    try {
      const response = await fetch("/prompt", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ prompt }),
      });
      const fragment = await response.text();
      const template = document.createElement("template");
      template.innerHTML = fragment;
      const subscriber = template.content.querySelector("[data-build-job-id]");
      const streamPath = subscriber?.getAttribute("sse-connect");

      if (!streamPath) {
        notice.replaceChildren();
        notice.textContent = template.content.textContent ?? fragment;
        finish();
        return;
      }

      source = new EventSource(streamPath);
    } catch {
      output.append(document.createTextNode("Hmm, that didn't work. Mind trying again?"));
      finish();
      return;
    }

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
    source.addEventListener("build-error-preview", (event) => {
      const raw = sseData(event);
      try {
        gatePreview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        gatePreview.textContent = raw;
      }
    });
    // Demo-only: the terminal commit stage (issue 07) — the committed capability,
    // its version, the artifacts pointer, and the files written. The client-side
    // content/toolbar swap is Epic 2.6; here we just surface that it committed.
    source.addEventListener("commit-preview", (event) => {
      const raw = sseData(event);
      try {
        commitPreview.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        commitPreview.textContent = raw;
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
