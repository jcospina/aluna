// A capability's collection as a page runs it: parsed into the DOM double, with the inline Alpine
// the renderer wrote started on it, and the controls found the way a person finds them — by name.

import { bound, shown, startAlpine } from "../../controls/double/alpine.test-support.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import {
  capabilityRecordsRegionId,
  type RenderableCapability,
} from "../../fields/field-renderer.ts";
import { renderCollection } from "./list-container.ts";

export { bound, shown };

/** The one element of `tag` whose accessible name is `name`: its label, else its words. */
export function named(root: El, tag: string, name: string): El {
  const found = root
    .querySelectorAll(tag)
    .filter((node) => (node.getAttribute("aria-label") ?? node.textContent.trim()) === name);
  if (found.length !== 1) throw new Error(`expected one <${tag}> named ${name}, ${found.length}`);
  return found[0] as El;
}

/** Where each node stands in document order under `root`. */
export const inOrder = (root: El, ...nodes: El[]): number[] => {
  const all = [...root.descendants()];
  return nodes.map((node) => all.indexOf(node));
};

/** The collection `html` renders for `capability`, with its create form and New button. */
export function collectionPage(
  capability: RenderableCapability,
  html = renderCollection({ capability }),
) {
  const doc = new Doc();
  parseHtml(html, doc);
  startAlpine(doc);
  const form = named(doc, "form", `Add to ${capability.label}`);
  return {
    doc,
    form,
    region: doc.getElementById(capabilityRecordsRegionId(capability.id)) as El,
    newButton: named(doc, "button", `New ${capability.label}`),
    field: (name: string) => form.querySelector(`[name="${name}"]`) as El,
    press: (on: El) => doc.fire("click", on),
    /** Everything Alpine queued: `x-show` drawing what changed, then each `$nextTick`. */
    settled: () => new Promise<void>((done) => setTimeout(done, 0)),
  };
}
