// @ts-check
/**
 * The line bench. Deliberately not a settings panel — the hands are transcriptions
 * from the spec, not judgements this page makes. The one control is Re-ink, which
 * redraws every boundary on the page by a different hand under the same
 * specification, showing that no two are ever the same.
 */

import { CAPABILITIES } from "../data/capabilities.js";
import { reseedInk } from "../ink.js";
import { renderCollection, renderRecordForm } from "../patterns.js";

/** @param {HTMLElement} root */
export function mountLineBench(root) {
  const stage = root.querySelector("[data-line-stage]");
  if (!stage) return;

  /*
   * The tasting log by preference — it is the fixture with the fullest form,
   * so the bench shows the line on the most control types. The first fixture
   * otherwise, and nothing if there is neither.
   */
  const capability = CAPABILITIES.find((c) => c.id === "coffee-tasting-log") ?? CAPABILITIES[0];
  if (!capability) return;
  stage.append(renderCollection(capability), renderRecordForm(capability));

  wireReink(root);
}

/**
 * The spread, on demand.
 *
 * @param {HTMLElement} root
 */
function wireReink(root) {
  root.querySelector("[data-line-reink]")?.addEventListener("click", () => {
    reseedInk();
  });
}
