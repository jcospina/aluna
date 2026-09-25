// The executable-surface scrub for a generated Handler's returned fragment.
//
// The enforcer runs on the item renderer's output inside `present()`, and the design-lint rung
// judges that same surface. Neither sees the markup a Handler composes around those items: it is
// returned by `c.html(...)` exactly as written and htmx swaps it into a live page.
//
// It is deliberately not the enforcer's allow-list. ADR-0005 closes the item surface; a Handler's
// fragment is ADR-0004's free string, carrying `present()`'s wrapper and the declared error
// markers. So it removes whole classes, never members: what carries code (`on*`, Alpine, htmx's
// evaluating attributes — the CSP keeps `unsafe-eval` for Alpine), what opens a document of its
// own (a frame, `srcdoc`, a plugin), what re-roots the page, SVG animation that rewrites an
// attribute after it was judged, and the out-of-band swaps that write into any element on the desk
// by id. htmx reads every attribute under a `data-` prefix too, so each rule judges the name
// without it. `neutralized` reports a removal, never a normalization like an escaped `<`.

import { decodeAttributeValue, isDangerousUrl } from "./attribute-urls.ts";
import { rewriteAttributes } from "./attribute-verdicts.ts";
import { escapeCdataOpeners } from "./cdata.ts";
import {
  escapeCommentOpeners,
  escapeValueOpeners,
  styleAwareTextOpeners,
} from "./stray-openers.ts";
import { closeTrailingTag } from "./trailing-tag.ts";
import { URL_ATTRS } from "./vocabulary.ts";

/** Elements removed with their content. */
export const FRAGMENT_REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  // A document or plugin of its own; `srcdoc` is never fetched, so `frame-src` never judges it.
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "fencedframe",
  // Document-level: re-root every relative URL, refresh the page away, pull a resource in.
  "base",
  "meta",
  "link",
  // SVG animation sets an attribute after it was judged: an `href` to `javascript:`.
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);

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

/**
 * Reaches past the target — platform machinery, never a Handler's: a swap elsewhere, a desk element
 * taken by id into the swap (`hx-preserve`), or the desk's address rewritten.
 */
const OUT_OF_BAND_ATTRS: ReadonlySet<string> = new Set([
  "hx-swap-oob",
  "hx-select-oob",
  "hx-preserve",
  "hx-push-url",
  "hx-replace-url",
]);

/** An htmx extension and its stream wiring: the build narration's, never a Handler's. */
const HTMX_EXTENSION = /^(hx-ext$|sse-|ws-)/;

/**
 * The prefix htmx reads every one of its attributes under as well. Every rule reads past it, so a
 * `data-on*` or `data-x-*` no browser or Alpine runs goes too: over-removal, kept on purpose.
 */
const DATA_PREFIX = "data-";

/** Alpine's directives and the two shorthands it reads as `x-on` and `x-bind`. */
const ALPINE_DIRECTIVE = /^(x-|@|:)/;

/** htmx attributes that are only ever code: the `hx-on` handlers and `hx-vars`. */
const HTMX_CODE = /^hx-(on([:-]|$)|vars$)/;

/** htmx attributes it evaluates when the value opens with `js:` or `javascript:`. */
const HTMX_SCRIPTABLE: ReadonlySet<string> = new Set(["hx-vals", "hx-headers", "hx-request"]);
const SCRIPT_PREFIX = /^\s*(js|javascript):/i;

/**
 * Only a parse error starts an attribute name with `=` (`<a href/=x>`). lol-html writes a changed
 * tag back as `href =x`, which a browser reads as `href`'s value: an unjudged URL, or a quote that
 * turns the text after the tag into attributes.
 */
const DISGUISED_VALUE = /^=/;

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
  let neutralized = false;
  const removed = (): void => {
    neutralized = true;
  };
  const openers = styleAwareTextOpeners();
  const html = new HTMLRewriter()
    .on("*", {
      element(element) {
        scrubElement(element, removed);
        if (!element.removed) openers.element(element);
      },
    })
    .onDocument({ comments: escapeCommentOpeners, text: openers.text })
    .transform(closeTrailingTag(escapeCdataOpeners(fragment)));
  return { html, neutralized };
}

function scrubElement(element: HTMLRewriterTypes.Element, removed: () => void): void {
  if (FRAGMENT_REMOVED_ELEMENTS.has(element.tagName.toLowerCase())) {
    element.remove();
    removed();
    return;
  }
  const count = rewriteAttributes(element, (lower, value) =>
    isRemovedAttribute(lower, value) ? null : escapeValueOpeners(value),
  );
  if (count === undefined) element.removeAndKeepContent();
  if (count !== 0) removed();
}

function isRemovedAttribute(lower: string, value: string): boolean {
  const name = lower.startsWith(DATA_PREFIX) ? lower.slice(DATA_PREFIX.length) : lower;
  return DISGUISED_VALUE.test(lower) || carriesCode(name, value) || reachesOut(name, value);
}

function carriesCode(name: string, value: string): boolean {
  // `on*` is the whole event-handler family, and no `on`-prefixed attribute sits outside it,
  // so the prefix closes the family rather than the members someone thought of.
  if (name.startsWith("on") || ALPINE_DIRECTIVE.test(name) || HTMX_CODE.test(name)) return true;
  const decoded = decodeAttributeValue(value);
  if (name === "hx-trigger") return decoded.includes("["); // a `click[expression]` filter
  return HTMX_SCRIPTABLE.has(name) && SCRIPT_PREFIX.test(decoded);
}

/** A swap past the target, a document of its own, or a script URL — `xlink:href` read as `href`. */
function reachesOut(name: string, value: string): boolean {
  const local = name.slice(name.lastIndexOf(":") + 1);
  return (
    OUT_OF_BAND_ATTRS.has(name) ||
    HTMX_EXTENSION.test(name) ||
    local === "srcdoc" ||
    (HANDLER_URL_ATTRS.has(local) && isDangerousUrl(value, local))
  );
}
