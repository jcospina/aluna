// @ts-check

/**
 * The glyphs a drawn listbox carries, and the broken-link mark a card carries, as
 * `design/controls.html` draws them, written once for the markup the server renders and the
 * markup the browser draws around a field once it is linked.
 */

/** The caret at the end of a select shell. */
export const CHEVRON =
  `<span class="listbox__chevron">` +
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"` +
  ` stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M6 9l6 6 6-6"></path>` +
  `</svg></span>`;

/** The chain inside a field that can be connected. */
export const CHAIN =
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"` +
  ` stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M10 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.15 1.15"></path>` +
  `<path d="M14 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.15-1.15"></path></svg>`;

const BROKEN_CHAIN_PATHS =
  `<path d="M15.6 12.9l2.9-2.9a4 4 0 1 0-5.66-5.66l-1.15 1.15"></path>` +
  `<path d="M8.4 11.1L5.5 14a4 4 0 1 0 5.66 5.66l1.15-1.15"></path>` +
  `<path d="M8 3v2.5M3 8h2.5M16 21v-2.5M21 16h-2.5"></path>`;

/** The broken chain inside a connected field, which disconnects it. */
export const BROKEN_CHAIN =
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"` +
  ` stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `${BROKEN_CHAIN_PATHS}</svg>`;

/** The same chain in the broken-link mark a card carries, smaller and heavier. */
export const LINK_MARK_CHAIN =
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"` +
  ` stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `${BROKEN_CHAIN_PATHS}</svg>`;
