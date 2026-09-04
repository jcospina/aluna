// The executable-surface scrub for a *generated Handler's* returned fragment.
//
// The enforcer (enforcer.ts) runs on the item renderer's output inside `present()`, and
// the design-lint rung judges that same surface. Neither sees the markup a Handler
// composes *around* those items — the form, the search chrome, the empty state, the
// validation copy. That wrapper is returned by `c.html(...)` exactly as written, and htmx
// swaps it into a live page, so a `<script>` or an `on*=` attribute in it runs on the app
// origin. The handler prompt invites raw markup, and whether any given generation escapes
// what it interpolates is a coin flip.
//
// So this is the render-time last line for the wrapper, the way the enforcer is for the
// item. It is deliberately *not* the enforcer: a Handler legitimately composes forms,
// buttons, inputs, `hx-*` attributes and the `<template>` the adapter emits beside each
// record, and holding it to the item vocabulary would refuse the platform's own chrome.
// What it removes is only what executes:
//
//   • `<script>` elements, with their content (their content is code, never copy),
//   • every `on*=` event-handler attribute,
//   • `javascript:` / `vbscript:` / HTML-smuggling `data:` values on URL attributes,
//   • `hx-swap-oob`, which is not execution but escape: it writes into any element on the
//     desk by id, outside the region the swap was aimed at and outside anything this
//     Handler owns. Only the platform performs out-of-band swaps (`src/server/http/
//     fragments.ts`, `src/lifecycle/deletion/presentation.ts`); no generation contract
//     asks a Handler for one, so a fragment carrying it is reaching for the shell.
//
// Conforming markup passes through byte-identical, which is what lets a caller notice that
// something *was* removed and say so in the log.

import { isDangerousUrl, URL_ATTRS } from "./vocabulary.ts";

/** The URL-bearing attributes a Handler's own chrome can carry, beyond the item set. */
const HANDLER_URL_ATTRS: ReadonlySet<string> = new Set([
  ...URL_ATTRS,
  "href",
  "action",
  "formaction",
  "background",
  "data",
  "srcset",
]);

/** The one attribute that swaps outside the target — platform machinery, never a Handler's. */
const OUT_OF_BAND_ATTR = "hx-swap-oob";

export interface SafeFragment {
  readonly html: string;
  /** True when something executable was removed — a Handler contract violation worth logging. */
  readonly neutralized: boolean;
}

/**
 * Return the inert form of one Handler's returned fragment, and whether anything had to be
 * taken out of it.
 */
export function enforceHandlerFragment(fragment: string): SafeFragment {
  const html = new HTMLRewriter().on("*", { element: scrubElement }).transform(fragment);
  return { html, neutralized: html !== fragment };
}

function scrubElement(element: HTMLRewriterTypes.Element): void {
  if (element.tagName.toLowerCase() === "script") {
    element.remove();
    return;
  }
  for (const [name, value] of element.attributes) {
    const lower = name.toLowerCase();
    // `on*` is the whole event-handler family, and there is no `on`-prefixed attribute
    // outside it — checking the prefix closes the family rather than the members someone
    // thought of.
    if (lower.startsWith("on") || lower === OUT_OF_BAND_ATTR) element.removeAttribute(lower);
    else if (HANDLER_URL_ATTRS.has(lower) && isDangerousUrl(value)) element.removeAttribute(lower);
  }
}
