// As much of an HTML parser as the DOM doubles ask for, shared so every double builds the tree a
// browser would: nested elements with their attributes, text in document order, comments dropped.
// Whatever a browser would build differently — an implied end tag, a table, an entity it does not
// decode, a stray close — throws, so a rule is never tested against a tree no browser would hand
// it. Each double supplies the nodes; this decides the shape. Not a test file itself.

import { unescapeHtml } from "./http/html.ts";

/** How a double makes and places its own nodes while the parser walks the markup. */
export interface TreeBuilder<N> {
  element(tag: string, attributes: ReadonlyArray<readonly [string, string]>): N;
  /** Where an element's content goes: the element itself, or a `<template>`'s inert fragment. */
  contentOf(element: N, tag: string): N;
  append(holder: N, node: N): void;
  text(holder: N, words: string): void;
}

/** Parse `raw` into `into`, with `builder` making the nodes. */
export function parseInto<N>(raw: string, into: N, builder: TreeBuilder<N>): void {
  new MarkupParser(raw, into, builder).parse();
}

class MarkupParser<N> {
  private readonly open: Array<{ tag: string; holder: N; fresh: boolean }> = [];
  private at = 0;

  constructor(
    private readonly raw: string,
    private readonly into: N,
    private readonly builder: TreeBuilder<N>,
  ) {}

  parse(): void {
    while (this.at < this.raw.length) {
      const step = MARKUP_STEP.exec(this.raw.slice(this.at));
      if (step === null) throw new Error(`the double cannot parse: ${this.raw.slice(this.at)}`);
      this.at += step[0].length;
      this.take(step);
    }
    const unclosed = this.open.at(-1);
    if (unclosed) throw new Error(`the double left <${unclosed.tag}> open: ${this.raw}`);
  }

  private take([whole, comment, closing, opening, attributes = "", slash, text]: RegExpExecArray) {
    if (text !== undefined) this.placeText(decoded(text));
    else if (closing !== undefined) this.close(closing);
    else if (opening !== undefined) this.openElement(opening, attributes, slash === "/");
    else if (comment === undefined) throw new Error(`unreachable step: ${whole}`);
  }

  /** Inside `<svg>` names keep their case and `/>` closes, as foreign content does. */
  private get foreign(): boolean {
    return this.open.some((element) => element.tag === "svg");
  }

  private get holder(): N {
    return this.open.at(-1)?.holder ?? this.into;
  }

  /** A `<pre>`'s first newline is the markup's, not the content's, as the parser reads it. */
  private placeText(words: string): void {
    const innermost = this.open.at(-1);
    const first = innermost?.fresh === true && innermost.tag === "pre";
    if (innermost) innermost.fresh = false;
    const kept = first ? words.replace(/^\n/, "") : words;
    if (kept !== "") this.builder.text(this.holder, kept);
  }

  private openElement(written: string, attributes: string, selfClosing: boolean): void {
    const foreign = this.foreign || written.toLowerCase() === "svg";
    const tag = this.foreign ? written : written.toLowerCase();
    refuseImpliedStructure(tag, this.open.at(-1)?.tag);
    const innermost = this.open.at(-1);
    if (innermost) innermost.fresh = false;
    const node = this.builder.element(tag, attributesOf(attributes, foreign));
    this.builder.append(this.holder, node);
    if (VOID_TAGS.has(tag) || (selfClosing && foreign)) return;
    if (selfClosing) throw new Error(`a browser leaves <${tag}/> open: ${this.raw}`);
    const holder = this.builder.contentOf(node, tag);
    if (RAW_TEXT_TAGS.has(tag)) this.at = this.rawText(tag, holder);
    else this.open.push({ tag, holder, fresh: true });
  }

  /** Words a raw-text element holds up to its own end tag, never parsed as markup. */
  private rawText(tag: string, holder: N): number {
    const end = this.raw.toLowerCase().indexOf(`</${tag}`, this.at);
    if (end < 0) throw new Error(`<${tag}> is never closed: ${this.raw}`);
    const words = this.raw.slice(this.at, end);
    const escapable = tag === "textarea" || tag === "title";
    // A textarea drops one leading newline, the way HTML's tree construction does.
    const kept = tag === "textarea" ? words.replace(/^\n/, "") : words;
    if (kept) this.builder.text(holder, escapable ? decoded(kept) : kept);
    const close = /^<\/[A-Za-z]+\s*>/.exec(this.raw.slice(end));
    if (close === null) throw new Error(`<${tag}> is not closed cleanly: ${this.raw}`);
    return end + close[0].length;
  }

  private close(written: string): void {
    const innermost = this.open.at(-1)?.tag;
    const tag = this.foreign ? written : written.toLowerCase();
    if (innermost !== tag) {
      throw new Error(`</${tag}> does not close <${innermost ?? "nothing"}>: ${this.raw}`);
    }
    this.open.pop();
  }
}

/** A comment, a closing tag, an opening tag with its attributes, or the text between two. */
const MARKUP_STEP =
  /^(?:<!--([\s\S]*?)-->|<\/([A-Za-z][\w-]*)\s*>|<([A-Za-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+))/;

/** One attribute in each of the three ways HTML writes one, or bare. */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Outside foreign content an attribute's name is lowercased, as the browser's parser does. */
function attributesOf(written: string, foreign: boolean): Array<[string, string]> {
  const seen = new Set<string>();
  const kept: Array<[string, string]> = [];
  for (const [, name = "", double, single, bare] of written.matchAll(ATTRIBUTE)) {
    const key = foreign ? name : name.toLowerCase();
    // The first of two same-named attributes wins; the parser drops the rest.
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push([key, decoded(double ?? single ?? bare ?? "")]);
  }
  return kept;
}

/** A browser decodes every entity; the double knows the five this desk escapes, and no others. */
export function decoded(text: string): string {
  for (const [entity] of text.matchAll(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/gi)) {
    if (unescapeHtml(entity) === entity) throw new Error(`the double cannot decode ${entity}`);
  }
  return unescapeHtml(text);
}

/**
 * Where the browser would close or move an element the markup never did. Modelling each is a
 * parser; refusing them keeps the double's tree the one a browser builds for what it accepts.
 */
function refuseImpliedStructure(tag: string, inside: string | undefined): void {
  const implied =
    (inside === "p" && CLOSES_A_PARAGRAPH.has(tag)) ||
    (inside === tag && ["li", "option", "dt", "dd", "a", "form", "button"].includes(tag)) ||
    (inside === "select" && !["option", "optgroup", "hr"].includes(tag)) ||
    TABLE_TAGS.has(tag);
  if (implied) throw new Error(`the double does not model <${tag}> inside <${inside}>`);
}

/** HTML's void elements, which never hold content and never take an end tag. */
export const VOID_TAGS = new Set(
  "area base br col embed hr img input link meta source track wbr".split(" "),
);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
const TABLE_TAGS = new Set(["table", "caption", "colgroup", "tbody", "thead", "tfoot", "tr", "td"]);
const CLOSES_A_PARAGRAPH = new Set(
  "address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre search section table ul".split(
    " ",
  ),
);
