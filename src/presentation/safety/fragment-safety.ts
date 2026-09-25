// The executable-surface scrub for a generated Handler's returned fragment.
//
// The enforcer runs on the item renderer's output inside `present()`, and the design-lint rung
// judges that same surface. Neither sees the markup a Handler composes around those items — the
// form, the search chrome, the empty state. That wrapper is returned by `c.html(...)` exactly as
// written and htmx swaps it into a live page, so a `<script>` in it runs on the app origin.
//
// It is deliberately not the enforcer: a Handler legitimately composes forms, buttons, inputs and
// `hx-*`. It removes only what executes, plus `hx-swap-oob`, which is escape rather than
// execution — it writes into any element on the desk by id, and only the platform swaps
// out-of-band. An Alpine directive executes: the page's Alpine evaluates it wherever it lands,
// and htmx's own evaluating attributes are off (`allowEval` in `public/app.js`). Conforming
// markup passes byte-identical, so a caller can log what was removed.

import { isDangerousUrl } from "./attribute-urls.ts";
import { escapeCdataOpeners } from "./cdata.ts";
import { collapseRepeatedAttributes } from "./repeated-attributes.ts";
import { URL_ATTRS } from "./vocabulary.ts";

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

/** Alpine's directives and the two shorthands it reads as `x-on` and `x-bind`. */
const ALPINE_DIRECTIVE = /^(x-|@|:)/;

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
  const html = new HTMLRewriter()
    .on("*", { element: scrubElement })
    .transform(escapeCdataOpeners(fragment));
  return { html, neutralized: html !== fragment };
}

function scrubElement(element: HTMLRewriterTypes.Element): void {
  if (element.tagName.toLowerCase() === "script") {
    element.remove();
    return;
  }
  for (const [lower, value] of collapseRepeatedAttributes(element)) {
    // `on*` is the whole event-handler family, and no `on`-prefixed attribute sits outside it,
    // so the prefix closes the family rather than the members someone thought of.
    if (lower.startsWith("on") || lower === OUT_OF_BAND_ATTR || ALPINE_DIRECTIVE.test(lower)) {
      element.removeAttribute(lower);
    } else if (HANDLER_URL_ATTRS.has(lower) && isDangerousUrl(value, lower)) {
      element.removeAttribute(lower);
    }
  }
}
