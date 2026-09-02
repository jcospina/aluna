// Fixtures and readers shared by the fragment tests. Not a test file (no `*.test.ts`), so
// bun never runs it; split out when `fragments.test.ts` grew past one file and its logo
// half moved to `fragments.logo.test.ts`.

// A capability born without artwork — the state every one of these fixtures is in, and
// the state the desk's load-triggered attempt is armed by.
export const LOGO_ABSENT = { status: "absent", attempts: 0 } as const;

/** The platform-owned half every logo fixture carries unchanged. */
export const NEVER_RENAMED = { version: 1, display_label_override: null } as const;

// The shell's logo placeholder comment, with the 10-space indent the injection matches
// on. Kept in sync with fragments.ts.
export const LOGO_PLACEHOLDER = "          <!-- Capability logos render here. -->";

// The prompt bar's one live slot, spelled exactly as the shipped shell spells it — a
// page-assembly anchor is only as good as the fixture agreeing with `public/index.html`,
// and the real shell is held to this same string every time `/` renders.
export const NOTICE_SLOT =
  '<div id="prompt-notice" class="prompt__notice" aria-live="polite"></div>';

// A minimal stand-in for the shell file: the one anchor the shell composition keys off —
// the logo-layer placeholder comment, with its 10-space indent — wrapped in just enough
// markup to be inspectable. Neither the window layer nor the record holds an anchor: the
// window is created by the client and a record opens by a view swap inside it, so nothing
// else is composed into the page.
export const SHELL_FIXTURE = [
  '<div class="shell" x-data="shell">',
  '  <div class="desk__logos" id="capability-logos">',
  LOGO_PLACEHOLDER,
  "  </div>",
  '  <div class="desk__windows"></div>',
  `  ${NOTICE_SLOT}`,
  "</div>",
].join("\n");

export function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The logo's own `<button>` — the one that opens the capability — and nothing around it. */
export function logoButton(html: string): string {
  const opened = html.indexOf("<button");
  return opened === -1 ? "" : html.slice(opened, html.indexOf("</button>", opened));
}

/** Just that button's opening tag, where the one verb a press carries has to be. */
export function logoButtonTag(html: string): string {
  const button = logoButton(html);
  return button.slice(0, button.indexOf(">"));
}
