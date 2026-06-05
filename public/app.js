// @ts-check
//
// Authored shell glue — runs in the browser, so it is plain JavaScript served
// verbatim from /static/app.js (no transpile, no build step; the no-build rule).
// Type safety without a build: `// @ts-check` + JSDoc means the repo's existing
// `tsc --noEmit` typechecks this file with zero runtime change.
//
// Today it registers one Alpine component: `shell`, which owns the shell's
// presentation chrome (sidebar collapse / mobile drawer). No product logic lives
// here — the shell is dumb on purpose (ARCH §6.1).

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
