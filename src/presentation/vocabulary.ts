// The closed allow-list the runtime enforcer keys on — the *data* half of the
// closed-value design contract (ADR-0005 §3 & §4; PLAN decision 4). It mirrors the
// vocabulary authored in epic 3.1/01 whose single source of truth is
// docs/design-system.md (classes) and public/css/primitives.css (their CSS). The
// enforcer (enforcer.ts) and the design-lint gate rung (3.6) both key on these sets;
// vocabulary.test.ts cross-checks ALLOWED_CLASSES against primitives.css so the two
// can never silently drift.
//
// *Closed values, open composition.* The closed thing is the design-value space (the
// classes/tokens) and the executable surface (which elements/attributes may appear),
// never how an item arranges one record's own fields.

/**
 * The closed set of semantic/primitive classes generated item markup may use. Any
 * `class` token outside this set is fabricated and gets dropped. Kept in the exact
 * lowercase form the CSS authored — class names are case-sensitive, so a mismatched
 * casing would not resolve against the primitives anyway.
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
 * Presentational, non-interactive, same-namespace elements generated item markup may
 * use. An allowed element is kept and its attributes are cleaned; anything not here is
 * either removed with its content (REMOVED_ELEMENTS) or unwrapped (everything else —
 * interactive controls, `<html>`/`<body>` framing, and unknown/custom elements — so
 * their inner record text survives while the tag and its handlers do not).
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
  "hr",
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
 * Elements dropped *with their content* — their content is code, raw non-HTML text, or
 * a foreign/embedding context, never record data worth keeping. Scripts and styles are
 * the executable-surface bans; `<svg>`/`<math>`/`<template>`/raw-text elements are the
 * classic mutation-XSS vectors, so they leave with everything inside them.
 */
export const REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "noframes",
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

/** Attributes safe on any allowed element (plus `aria-*`, handled in `isSafeAttr`). */
const GLOBAL_SAFE_ATTRS: ReadonlySet<string> = new Set([
  "title",
  "lang",
  "dir",
  "role",
  "translate",
  "hidden",
]);

/**
 * Per-element attribute allow-list. Everything not listed here (and not global/`aria-*`,
 * `class`, or `style`) is dropped by default-deny — which is what neutralizes every
 * `on*=` handler, `href`, `srcdoc`, `id`/`name` (DOM-clobbering), `data-*`, `is=`, and
 * so on without having to enumerate them.
 */
const ELEMENT_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"]),
  source: new Set(["src", "srcset", "sizes", "type", "media", "width", "height"]),
  video: new Set([
    "src",
    "poster",
    "width",
    "height",
    "controls",
    "muted",
    "loop",
    "autoplay",
    "playsinline",
    "preload",
  ]),
  audio: new Set(["src", "controls", "muted", "loop", "autoplay", "preload"]),
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
  if (name.startsWith("aria-")) return true;
  return ELEMENT_ATTRS[tag]?.has(name) ?? false;
}

/**
 * Whether a URL-attribute value carries a script-executing or HTML-smuggling scheme.
 * C0 control characters and whitespace are stripped first so `java\tscript:` cannot
 * slip through; inline `data:image/*` stays allowed (legitimate for an image field),
 * while every other `data:` payload and the script schemes are rejected.
 */
export function isDangerousUrl(value: string): boolean {
  let stripped = "";
  for (const ch of value) {
    if (ch.charCodeAt(0) > 0x20) stripped += ch; // drop C0 controls + spaces (java\tscript:)
  }
  const v = stripped.toLowerCase();
  if (v.includes("javascript:") || v.includes("vbscript:")) return true;
  return v.startsWith("data:") && !v.startsWith("data:image/");
}
