// A DOM double for the shell glue's tests: a document, elements, text nodes and a `<template>`, as
// much of each as the rules touch. Events, focus and markup go through the helpers every double
// shares (`dom-events`, `html-parse`), so each answers as the others do. Split from app.shell-double
// so each stays a subject of its own. Not a test file itself (no `*.test.ts`), so bun never runs it.

import {
  assertAttributeName,
  canTakeFocus,
  type DispatchedEvent,
  dispatchAlong,
  type EventNode,
  type ListenerOptions,
  Listeners,
} from "./dom-events.test-support.ts";
import { parseInto, type TreeBuilder } from "./html-parse.test-support.ts";

/**
 * The document a tree stands in: its listeners are the last an event reaches, and it holds the one
 * `activeElement`, which falls back to the body the moment what held focus leaves the page.
 */
export class DomDocument implements EventNode {
  readonly listeners = new Listeners();
  private focusedNode: El | null = null;

  constructor(readonly body: El) {
    body.document = this;
  }

  get activeElement(): El {
    const held = this.focusedNode;
    return held !== null && held.ownerDocument === this ? held : this.body;
  }

  /** Where `focus()` lands once the rules have let it: nothing else writes this. */
  focusOn(node: El | null): void {
    this.focusedNode = node;
  }

  addEventListener(type: string, listener: (event: never) => void, options?: ListenerOptions) {
    this.listeners.add(type, listener, options);
  }

  removeEventListener(type: string, listener: (event: never) => void, options?: ListenerOptions) {
    this.listeners.remove(type, listener, options);
  }

  /** An event sent at the document itself: its own listeners, both phases, and nothing else. */
  dispatchEvent(event: DispatchedEvent): boolean {
    return dispatchAlong([this], event);
  }

  contains(node: unknown): boolean {
    return node instanceof El && node.ownerDocument === this;
  }
}

/** Take a node out of whatever holds it, as `ChildNode.remove()` does. */
function detach(node: El | Text): void {
  const siblings = node.parent?.childNodes;
  if (siblings) siblings.splice(siblings.indexOf(node), 1);
  node.parent = null;
}

/** Words between two tags, held the way the browser holds them: a node of their own, in order. */
export class Text {
  readonly nodeType = 3;
  readonly isFragment = false;
  parent: El | null = null;

  constructor(public textContent: string) {}

  remove(): void {
    detach(this);
  }
}

export class El implements EventNode {
  readonly childNodes: Array<El | Text> = [];
  parent: El | null = null;
  readonly attributes = new Map<string, string>();
  readonly dispatched: string[] = [];
  readonly nodeType = 1;
  isFragment = false;
  raw = "";
  value = "";
  /** Set on the top of a tree that stands in a page, which is how every node in it finds one. */
  document: DomDocument | null = null;
  /** This node's own words, with its children's held by the children. */
  ownText = "";

  constructor(
    readonly tag: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  get classList() {
    const classes = (this.attributes.get("class") ?? "").split(/\s+/).filter(Boolean);
    const write = () => this.attributes.set("class", classes.join(" "));
    return {
      contains: (name: string) => classes.includes(name),
      add: (name: string) => {
        if (!classes.includes(name)) classes.push(name);
        write();
      },
      remove: (name: string) => {
        const at = classes.indexOf(name);
        if (at >= 0) classes.splice(at, 1);
        write();
      },
    };
  }

  /** What the browser exposes for `id="…"`, and the empty string when there is none. */
  get id(): string {
    return this.attributes.get("id") ?? "";
  }

  get firstChild(): El | Text | null {
    return this.childNodes[0] ?? null;
  }

  /**
   * A live view over `data-*`, which is what the browser's `dataset` is. A plain object was a
   * second, empty store: a node built with `data-active-capability-id` read back as having none.
   */
  get dataset(): Record<string, string | undefined> {
    const attributes = this.attributes;
    const attributeFor = (key: string) =>
      `data-${key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`;
    return new Proxy(
      {},
      {
        get: (_target, key) =>
          typeof key === "string" ? attributes.get(attributeFor(key)) : undefined,
        set: (_target, key, value) => {
          if (typeof key === "string") attributes.set(attributeFor(key), String(value));
          return true;
        },
        has: (_target, key) => typeof key === "string" && attributes.has(attributeFor(key)),
        deleteProperty: (_target, key) => {
          if (typeof key === "string") attributes.delete(attributeFor(key));
          return true;
        },
      },
    );
  }

  /**
   * Read through the tree and written by replacing it, the two halves of the browser's own
   * `textContent`. As a field, the setter left the children it was meant to remove standing.
   */
  get textContent(): string {
    return this.childNodes.reduce((text, child) => text + child.textContent, this.ownText);
  }

  set textContent(words: string) {
    for (const child of [...this.childNodes]) child.remove();
    this.ownText = words;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    assertAttributeName(name);
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  matches(selector: string): boolean {
    // One compound selector only. A descendant selector would match on its first bracket group
    // and quietly answer about the wrong node, which a double is not allowed to do.
    if (/\s/.test(selector.trim())) throw new Error(`not a compound selector: ${selector}`);
    if (selector.startsWith("#")) return this.attributes.get("id") === selector.slice(1);
    const negated = this.negationIn(selector);
    if (negated !== null) return negated;
    const tagged = /^([a-z]+)\[/.exec(selector);
    if (tagged && this.tag !== tagged[1]) return false;
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (attributes.length > 0) return this.holdsAll(attributes);
    return selector.startsWith(".") && this.classList.contains(selector.slice(1));
  }

  /**
   * `:not([attr])`, the one negation the shell's own selectors use — a run that is not a question.
   * Answered before the attribute walk, which would otherwise read the negated name as a
   * requirement and say yes to exactly the node the selector excludes. Any other negation is
   * refused rather than answered: `:not(.class)` would come out as "no", which is a double
   * quietly deciding a rule under test.
   *
   * @returns the answer, or `null` when the selector negates nothing
   */
  private negationIn(selector: string): boolean | null {
    const negated = /:not\(\[([\w-]+)\]\)/.exec(selector);
    if (!negated) {
      if (selector.includes(":not(")) {
        throw new Error(`only \`:not([attribute])\` is understood here: ${selector}`);
      }
      return null;
    }
    return !this.attributes.has(negated[1] ?? "") && this.matches(selector.replace(negated[0], ""));
  }

  /**
   * Every attribute the selector names, not just the first: `[a][b]` asks for both, and a double
   * that answered about `[a]` alone would say yes to a node the browser passes over.
   */
  private holdsAll(asked: readonly RegExpExecArray[]): boolean {
    return asked.every(([, name, value]) => {
      const held = this.attributes.get(name ?? "");
      return held !== undefined && (value === undefined || held === value);
    });
  }

  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  /** The first descendant this selector reaches, one compound step at a time. */
  querySelector(selector: string): El | null {
    // `:scope > x` asks about this node's own children and nothing deeper. The walk below would
    // reach a grandchild and say yes, and the rule asking this wants a direct child.
    const scoped = /^:scope\s*>\s*(.+)$/.exec(selector.trim());
    if (scoped) {
      const step = scoped[1] ?? "";
      if (/\s/.test(step)) throw new Error(`not a compound selector after :scope: ${step}`);
      return this.children.find((child) => child.matches(step)) ?? null;
    }
    const [head, ...rest] = selector.trim().split(/\s+/);
    for (const child of this.children) {
      const found = child.reachedBy(head ?? selector, rest) ?? child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  /** The element children, which is all a selector can reach. */
  get children(): El[] {
    return this.childNodes.filter((child) => child instanceof El);
  }

  /** This node if the step ends here, or whatever the remaining steps reach inside it. */
  private reachedBy(step: string, rest: readonly string[]): El | null {
    if (!this.matches(step)) return null;
    return rest.length === 0 ? this : this.querySelector(rest.join(" "));
  }

  append(...nodes: Array<El | Text>): void {
    for (const node of nodes) {
      if (node instanceof El && node.isFragment) {
        this.append(...[...node.childNodes]);
        continue;
      }
      node.remove();
      node.parent = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes: Array<El | Text>): void {
    for (const child of [...this.childNodes]) child.remove();
    // This node's own text is a child too, and a `replaceChildren()` that left it standing would
    // go on answering for a slot it had just emptied.
    this.ownText = "";
    this.append(...nodes);
  }

  remove(): void {
    detach(this);
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  get parentNode(): El | null {
    return this.parent;
  }

  /** What `x-show` or a script's `style.display` leaves written on the node. */
  get displayNone(): boolean {
    return /(^|;)\s*display\s*:\s*none/.test(this.attributes.get("style") ?? "");
  }

  /** The document this node stands in, or null once nothing above it does. */
  get ownerDocument(): DomDocument | null {
    let top: El = this;
    while (top.parent) top = top.parent;
    return top.document;
  }

  get isConnected(): boolean {
    return this.ownerDocument !== null;
  }

  /** What the last `focus()` that took was asked with: `focusVisible` is behaviour, not decoration. */
  focusOptions: unknown;

  /** Whether the keyboard is here: the document's one `activeElement`, not a flag of its own. */
  get focused(): boolean {
    return this.ownerDocument?.activeElement === this;
  }

  /** The browser's rules: a detached, hidden, disabled or unfocusable node refuses in silence. */
  focus(options?: unknown): void {
    const owner = this.ownerDocument;
    if (owner === null || !canTakeFocus(this, true)) return;
    owner.focusOn(this);
    this.focusOptions = options;
  }

  blur(): void {
    if (this.focused) this.ownerDocument?.focusOn(null);
  }

  /** Listeners bound to this node, which is where htmx dispatches a swap's own events. */
  readonly listeners = new Listeners();

  addEventListener(name: string, listener: (event: never) => void, options?: ListenerOptions) {
    this.listeners.add(name, listener, options);
  }

  removeEventListener(name: string, listener: (event: never) => void, options?: ListenerOptions) {
    this.listeners.remove(name, listener, options);
  }

  /**
   * The browser runs a node's own listeners whether or not the node is still in the document, so
   * a rule that must hear about a swap into a detached region binds here rather than to it. The
   * path runs up the parents to the document, when the tree stands in one.
   */
  dispatchEvent(event: DispatchedEvent): boolean {
    this.dispatched.push(event.type);
    const path: EventNode[] = [];
    let top: El = this;
    for (let node: El | null = this; node; node = node.parent) {
      path.push(node);
      top = node;
    }
    if (top.document) path.push(top.document);
    return dispatchAlong(path, event);
  }
}

/**
 * The one thing a `<template>` is for here: the parked restoration, inert and unsearchable until
 * it is asked for. Read the way the browser reads it — the outer attributes, and what it wraps.
 */
export class Template extends El {
  readonly content = new El("#fragment");

  constructor() {
    super("template");
    this.content.isFragment = true;
  }

  set innerHTML(raw: string) {
    this.raw = raw;
    this.content.replaceChildren();
    parseInto(raw, this.content, BUILDER);
  }
}

/** How the shared parser makes this double's nodes. */
const BUILDER: TreeBuilder<El | Text> = {
  element(tag, attributes) {
    const node = tag === "template" ? new Template() : new El(tag);
    for (const [name, value] of attributes) node.attributes.set(name, value);
    return node;
  },
  contentOf: (element) => (element instanceof Template ? element.content : (element as El)),
  append: (holder, node) => (holder as El).append(node),
  text: (holder, words) => (holder as El).append(new Text(words)),
};
