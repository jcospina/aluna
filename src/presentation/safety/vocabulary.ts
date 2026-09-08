// The closed allow-list the runtime enforcer keys on — the data half of the closed-value design
// contract. It mirrors the vocabulary whose single source of truth is design/design-system.md
// (classes) and design/styles/layout-kit.css (their CSS). The enforcer and the design-lint gate
// rung both key on these sets, and vocabulary.test.ts cross-checks `ALLOWED_CLASSES` against the
// layout kit so the two cannot silently drift.
//
// Closed values, open composition: the closed thing is the design-value space and the executable
// surface, never how an item arranges one record's own fields.

/**
 * The closed set of semantic/primitive classes generated item markup may use; any other `class`
 * token is dropped. Class names are case-sensitive, so these are the CSS's exact lowercase form.
 */
export const ALLOWED_CLASSES: ReadonlySet<string> = new Set([
  // Intra-item composition
  "stack",
  "cluster",
  // Layout — display / direction
  "flex",
  "grid",
  "flex-col",
  "flex-wrap",
  // Layout — alignment
  "items-start",
  "items-center",
  "items-end",
  "items-baseline",
  "justify-start",
  "justify-center",
  "justify-between",
  "justify-end",
  // Layout — gap (maps 1:1 onto the spacing tokens)
  "gap-0_5",
  "gap-1",
  "gap-2",
  "gap-3",
  // Layout — grid tracks / sizing
  "grid-cols-2",
  "grid-cols-3",
  "grow",
  "w-full",
  // Type scale + emphasis
  "text-xs",
  "text-sm",
  "text-lg",
  "text-xl",
  "text-bold",
  "text-muted",
  "text-subtle",
  // Truncation
  "truncate",
  "line-clamp-2",
  "line-clamp-3",
  // Media frame
  "media-frame",
  "media-frame--square",
  "media-frame--wide",
]);

/**
 * Presentational, non-interactive, same-namespace elements item markup may use. `<hr>` is absent
 * because a user agent draws it with no declaration, where a property-keyed ban cannot see it.
 */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  // Flow containers + blocks
  "div",
  "span",
  "p",
  "section",
  "article",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "hgroup",
  "address",
  "blockquote",
  "pre",
  "br",
  // Headings
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // Lists
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // Inline text semantics
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "small",
  "mark",
  "sub",
  "sup",
  "abbr",
  "time",
  "code",
  "kbd",
  "samp",
  "var",
  "q",
  "cite",
  "wbr",
  "bdi",
  "bdo",
  "data",
  "ins",
  "del",
  "ruby",
  "rt",
  "rp",
  // Media (the .media-frame surface + companions)
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  // Tables
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
]);

/**
 * Elements dropped with their content: code, raw non-HTML text, or a foreign/embedding context.
 * `<svg>`/`<math>`/`<template>`/raw-text elements are the classic mutation-XSS vectors.
 */
export const REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "template",
  "textarea",
  "noscript",
  "noframes",
  "noembed",
  "iframe",
  "object",
  "embed",
  "param",
  "applet",
  "frame",
  "frameset",
  "base",
  "meta",
  "link",
  "title",
  "head",
  "svg",
  "math",
  "canvas",
  "xmp",
  "plaintext",
  "listing",
  "slot",
  "portal",
]);

/**
 * Attributes safe on any allowed element (plus most `aria-*`, handled in `isSafeAttr`). `role` is
 * absent because it makes the item lie: `role="link"` announces a destination that does not exist.
 */
const GLOBAL_SAFE_ATTRS: ReadonlySet<string> = new Set([
  "title",
  "lang",
  "dir",
  "translate",
  "hidden",
]);

/**
 * The one `aria-*` attribute a record may not carry. Every other describes the content to a
 * reader; this one takes it away, hiding a record's text while it still shows on screen.
 */
const REMOVED_ARIA_ATTRS: ReadonlySet<string> = new Set(["aria-hidden"]);

/**
 * Per-element attribute allow-list. Everything unlisted (and not global/`aria-*`, `class` or
 * `style`) is dropped by default-deny, which neutralizes `on*=`, `href`, `srcdoc`, `id`, `is=`.
 */
const ELEMENT_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"]),
  source: new Set(["src", "srcset", "sizes", "type", "media", "width", "height"]),
  // `controls` is the one media attribute the item wrapper cannot honour: a record is a
  // `<button>`, so a transport control inside one is unreachable and invalid markup besides.
  video: new Set([
    "src",
    "poster",
    "width",
    "height",
    "muted",
    "loop",
    "autoplay",
    "playsinline",
    "preload",
  ]),
  audio: new Set(["src", "muted", "loop", "autoplay", "preload"]),
  track: new Set(["src", "kind", "srclang", "label", "default"]),
  time: new Set(["datetime"]),
  data: new Set(["value"]),
  ol: new Set(["start", "reversed", "type"]),
  li: new Set(["value"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  th: new Set(["colspan", "rowspan", "headers", "scope", "abbr"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  blockquote: new Set(["cite"]),
  q: new Set(["cite"]),
  ins: new Set(["datetime", "cite"]),
  del: new Set(["datetime", "cite"]),
  bdo: new Set(["dir"]),
};

/** URL-bearing attributes whose value is scheme-checked before it is kept. */
export const URL_ATTRS: ReadonlySet<string> = new Set(["src", "srcset", "poster", "cite"]);

/** Whether `name` is a keepable attribute on an allowed `tag` (lowercased inputs). */
export function isSafeAttr(tag: string, name: string): boolean {
  if (GLOBAL_SAFE_ATTRS.has(name)) return true;
  if (name.startsWith("aria-")) return !REMOVED_ARIA_ATTRS.has(name);
  return ELEMENT_ATTRS[tag]?.has(name) ?? false;
}

/**
 * Whether a URL value carries a script-executing or smuggling scheme; C0 controls are stripped
 * first, so `java\tscript:` cannot pass. Item markup takes the stricter {@link isOffOriginUrl}.
 */
export function isDangerousUrl(value: string): boolean {
  return urlCandidates(value).some(isDangerousUrlCandidate);
}

/**
 * Whether a URL value in item markup is off-limits: everything but an inline `data:image/*`
 * and a same-origin path. A remote 1×1 `<img src>` exfiltrated every record it rendered.
 */
export function isOffOriginUrl(value: string): boolean {
  return urlCandidates(value).some(
    (candidate) => isDangerousUrlCandidate(candidate) || isRemoteCandidate(candidate),
  );
}

/**
 * The addresses one attribute value names. `srcset` is a comma-separated candidate list, so
 * reading it as one URL sees neither address in `a.png 1x, https://evil.example/b.png 2x`.
 */
function urlCandidates(value: string): string[] {
  const stripped = stripControls(value);
  if (!stripped.includes(",")) return [stripped];
  return stripped
    .split(",")
    .map((part) => part.trim().split(/\s+/, 1)[0] ?? "")
    .filter((part) => part.length > 0);
}

/** Drop C0 controls and spaces, so `java\tscript:` reads as what a browser will read. */
function stripControls(value: string): string {
  let stripped = "";
  for (const ch of value) {
    if (ch.charCodeAt(0) > 0x20) stripped += ch;
  }
  return stripped;
}

function isDangerousUrlCandidate(candidate: string): boolean {
  const v = candidate.toLowerCase();
  if (v.includes("javascript:") || v.includes("vbscript:")) return true;
  return v.startsWith("data:") && !v.startsWith("data:image/");
}

/** A scheme of any kind, or a protocol-relative authority — both leave this origin. */
function isRemoteCandidate(candidate: string): boolean {
  const v = candidate.toLowerCase();
  if (v.startsWith("data:image/")) return false;
  if (v.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/.test(v);
}
