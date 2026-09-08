// The runtime allow-list enforcer. The presentation adapter applies this to the inner markup of
// every rendered record, so a dynamic field value can never become executable markup even after
// build-time validation passes. The design-lint gate rung is the build-time catch; this is the
// last line at render time.
//
// It parses with Bun's native `HTMLRewriter` (lol-html) — deterministic, dependency-free, and
// parsing the final rendered HTML the way a browser would, so a hostile field value that broke
// out of its interpolation is seen as the elements it really forms. It neutralizes rather than
// throws: a record that slipped past the gate must still render inertly, never crash a live view.
// Conforming markup passes through unchanged.

import { sanitizeStyle } from "./style-discipline.ts";
import {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  isOffOriginUrl,
  isSafeAttr,
  REMOVED_ELEMENTS,
  URL_ATTRS,
} from "./vocabulary.ts";

/**
 * Return the allow-listed, inert form of one record's generated inner markup. Pure and
 * synchronous — safe to call on every record render inside the adapter.
 */
export function enforceItemMarkup(innerHtml: string): string {
  return new HTMLRewriter()
    .on("*", { element: enforceElement })
    .onDocument({ comments: dropComment })
    .transform(innerHtml);
}

function enforceElement(element: HTMLRewriterTypes.Element): void {
  const tag = element.tagName.toLowerCase();
  if (REMOVED_ELEMENTS.has(tag)) {
    element.remove(); // drops the element and its (code / non-data) content
  } else if (!ALLOWED_ELEMENTS.has(tag)) {
    element.removeAndKeepContent(); // unwrap interactive/unknown; keep the record text
  } else {
    cleanAttributes(element, tag);
  }
}

function cleanAttributes(element: HTMLRewriterTypes.Element, tag: string): void {
  const attributes = dedupeFirstWins([...element.attributes], element);
  for (const [lower, value] of attributes) {
    if (lower === "class") filterClass(element, value);
    else if (lower === "style") filterStyle(element, value);
    else if (!isSafeAttr(tag, lower)) element.removeAttribute(lower);
    else if (URL_ATTRS.has(lower) && isOffOriginUrl(value)) element.removeAttribute(lower);
  }
}

/**
 * Collapse a repeated attribute to the one a browser honours — the first — before anything else
 * is cleaned. lol-html addresses only the first, so a hostile second copy used to delete it.
 */
function dedupeFirstWins(
  attributes: readonly (readonly [string, string])[],
  element: HTMLRewriterTypes.Element,
): readonly (readonly [string, string])[] {
  const first = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const [name, value] of attributes) {
    const lower = name.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
    if (!first.has(lower)) first.set(lower, value);
  }
  for (const [lower, count] of counts) {
    if (count === 1) continue;
    // Each call removes one occurrence, so drop them all and restate the winner once.
    for (let i = 0; i < count; i += 1) element.removeAttribute(lower);
    element.setAttribute(lower, first.get(lower) ?? "");
  }
  return [...first];
}

/** Keep only allow-listed class tokens; leave a fully-conforming attribute untouched. */
function filterClass(element: HTMLRewriterTypes.Element, value: string): void {
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  const kept = tokens.filter((token) => ALLOWED_CLASSES.has(token));
  if (kept.length === tokens.length) return;
  if (kept.length === 0) element.removeAttribute("class");
  else element.setAttribute("class", kept.join(" "));
}

/** Sanitize `style` to token discipline; leave a fully-conforming attribute untouched. */
function filterStyle(element: HTMLRewriterTypes.Element, value: string): void {
  const safe = sanitizeStyle(value);
  if (safe === value) return;
  if (safe.length === 0) element.removeAttribute("style");
  else element.setAttribute("style", safe);
}

function dropComment(comment: HTMLRewriterTypes.Comment): void {
  comment.remove();
}
