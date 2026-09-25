// The runtime allow-list enforcer. The presentation adapter applies this to the inner markup of
// every rendered record, so a dynamic field value can never become executable markup even after
// build-time validation passes. The design-lint gate rung is the build-time catch; this is the
// last line at render time.
//
// It parses with Bun's native `HTMLRewriter` (lol-html) — deterministic, dependency-free, and
// parsing the final rendered HTML the way a browser would, so a hostile field value that broke
// out of its interpolation is seen as the elements it really forms. It neutralizes rather than
// throws: a record that slipped past the gate must still render inertly, never crash a live view.
// Conforming markup passes through unchanged, but for the loading attributes a served file's image
// is given.

import { isOffOriginUrl, namesServedFile } from "./attribute-urls.ts";
import { rewriteAttributes } from "./attribute-verdicts.ts";
import { escapeCdataOpeners } from "./cdata.ts";
import { escapeTextOpeners } from "./stray-openers.ts";
import { sanitizeStyle } from "./style-discipline.ts";
import { closeTrailingTag } from "./trailing-tag.ts";
import {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  isSafeAttr,
  REMOVED_ELEMENTS,
  URL_ATTRS,
} from "./vocabulary.ts";

/**
 * Return the allow-listed, inert form of one record's generated inner markup, with the attributes
 * a served file's image always carries. Pure and synchronous, and a second pass changes nothing.
 */
export function enforceItemMarkup(innerHtml: string): string {
  return completeServedImages(neutralizeItemMarkup(innerHtml));
}

/**
 * The enforcer without the image attributes it adds (Module 7 PLAN decision 28). Design lint diffs
 * a renderer against this: an attribute the platform supplies is not one the renderer got wrong.
 */
export function neutralizeItemMarkup(innerHtml: string): string {
  const endTags = impliedEndTags();
  return new HTMLRewriter()
    .on("*", { element: (element) => enforceElement(element, endTags) })
    .onDocument({ comments: dropComment, text: escapeTextOpeners })
    .transform(closeTrailingTag(escapeCdataOpeners(innerHtml)));
}

function enforceElement(element: HTMLRewriterTypes.Element, endTags: ImpliedEndTags): void {
  const tag = element.tagName.toLowerCase();
  if (REMOVED_ELEMENTS.has(tag)) {
    element.remove(); // drops the element and its (code / non-data) content
  } else if (!ALLOWED_ELEMENTS.has(tag)) {
    endTags.unwrap(element, tag); // unwrap interactive/unknown; keep the record text
  } else if (
    rewriteAttributes(element, (lower, value) => keptValue(tag, lower, value)) === undefined
  ) {
    endTags.unwrap(element, tag);
  } else {
    endTags.keep(element, tag);
  }
}

interface ImpliedEndTags {
  keep(element: HTMLRewriterTypes.Element, tag: string): void;
  unwrap(element: HTMLRewriterTypes.Element, tag: string): void;
}

/**
 * lol-html hands an unwrapped element the end tag that implicitly closed it, so unwrapping `<a>`
 * in `<div><a></div>` dropped the `</div>`. The unwrapped element marks the kept element that tag
 * closes, and that element, whose own handler runs last, writes it back once. No end tag the
 * markup never had is written.
 */
function impliedEndTags(): ImpliedEndTags {
  // Kept elements still open, per name, innermost last. A closed one is only marked, and popped
  // once it surfaces, so every lookup and close is amortized constant time.
  const open = new Map<string, { taken: boolean; closed: boolean }[]>();
  const stackOf = (name: string): { taken: boolean; closed: boolean }[] => {
    const stack = open.get(name) ?? [];
    open.set(name, stack);
    while (stack.at(-1)?.closed) stack.pop();
    return stack;
  };
  return {
    keep(element, tag) {
      if (!element.canHaveContent) return;
      const entry = { taken: false, closed: false };
      stackOf(tag).push(entry);
      element.onEndTag((end) => {
        entry.closed = true;
        if (entry.taken) end.after(`</${tag}>`, { html: true });
      });
    },
    unwrap(element, tag) {
      if (element.canHaveContent) {
        element.onEndTag((end) => {
          const name = end.name.toLowerCase();
          const owner = name === tag ? undefined : stackOf(name).at(-1);
          if (owner) owner.taken = true;
        });
      }
      element.removeAndKeepContent();
    },
  };
}

/**
 * A served file's image loads lazily and decodes off the main thread, whatever its template said.
 * A pass of its own over neutralized markup, so a second enforcement sees the same structure. An
 * `<img>` names the file itself, or through a `<source>` of the `<picture>` it sits in.
 */
function completeServedImages(markup: string): string {
  const frames: MediaFrame[] = [];
  return new HTMLRewriter()
    .on("*", { element: (element) => completeServedImage(element, frames) })
    .transform(markup);
}

/** An open picture or player, innermost last: a source counts only toward the picture it is in. */
interface MediaFrame {
  readonly picture: boolean;
  served: boolean;
}

function completeServedImage(element: HTMLRewriterTypes.Element, frames: MediaFrame[]): void {
  const tag = element.tagName.toLowerCase();
  if (MEDIA_FRAMES.has(tag)) {
    openMediaFrame(element, tag, frames);
    return;
  }
  const top = frames.at(-1);
  const picture = top?.picture ? top : undefined;
  if (tag === "source" && picture && namesServedSource(element)) picture.served = true;
  if (tag === "img" && (picture?.served || namesServedSource(element))) {
    setIfDifferent(element, "loading", "lazy");
    setIfDifferent(element, "decoding", "async");
  }
}

function openMediaFrame(
  element: HTMLRewriterTypes.Element,
  tag: string,
  frames: MediaFrame[],
): void {
  if (!element.canHaveContent) return;
  frames.push({ picture: tag === "picture", served: false });
  element.onEndTag(() => void frames.pop());
}

const MEDIA_FRAMES: ReadonlySet<string> = new Set(["picture", "video", "audio"]);

/** Set only a value that differs, so markup already carrying it passes byte-identical. */
function setIfDifferent(element: HTMLRewriterTypes.Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function namesServedSource(element: HTMLRewriterTypes.Element): boolean {
  return ["src", "srcset"].some((attribute) => {
    const value = element.getAttribute(attribute);
    return value !== null && namesServedFile(value, attribute);
  });
}

/** The value an allowed element keeps for one attribute, or `null` to remove it. */
function keptValue(tag: string, lower: string, value: string): string | null {
  if (lower === "class") return keptClass(value);
  if (lower === "style") return keptStyle(value);
  if (!isSafeAttr(tag, lower)) return null;
  return URL_ATTRS.has(lower) && isOffOriginUrl(value, lower) ? null : value;
}

/** Keep only allow-listed class tokens; a fully-conforming attribute is kept as written. */
function keptClass(value: string): string | null {
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  const kept = tokens.filter((token) => ALLOWED_CLASSES.has(token));
  if (kept.length === tokens.length) return value;
  return kept.length === 0 ? null : kept.join(" ");
}

/** Sanitize `style` to token discipline; a fully-conforming attribute is kept as written. */
function keptStyle(value: string): string | null {
  const safe = sanitizeStyle(value);
  if (safe === value) return value;
  return safe.length === 0 ? null : safe;
}

function dropComment(comment: HTMLRewriterTypes.Comment): void {
  comment.remove();
}
