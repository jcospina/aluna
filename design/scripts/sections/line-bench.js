// @ts-check
/**
 * The line bench: one control redraws every boundary on the page by a fresh hand under the same
 * specification, so no two results are the same.
 */

import { reseedInk } from "../ink/ink.js";

/** @param {HTMLElement} root */
export function mountLineBench(root) {
  root.querySelector("[data-line-reink]")?.addEventListener("click", () => reseedInk());
}
