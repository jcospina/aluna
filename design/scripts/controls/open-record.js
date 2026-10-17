// @ts-check

/**
 * The open icon inside a linked field, as this page and the desk draw it: the file field's
 * square with an arrow leaving it, and the name a reader hears.
 */

import { G } from "../files/file-parts.js";

export const OPEN_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"' +
  ` stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G.open}</svg>`;

/** The icon's accessible name, around the field's text: "Open Brandon Sanderson". */
export function openRecordName(/** @type {string} */ name) {
  return `Open ${name}`;
}
