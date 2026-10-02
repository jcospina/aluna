// A document small enough to run the drawn choice controls in Bun, and no smaller.
//
// The scene is built by parsing the markup the field renderer actually emits rather than by
// hand-assembling nodes: the picker's whole contract is that a script finds what the server
// wrote, so a double whose shape was typed out separately would prove the module against a
// second author's idea of the markup.
//
// Everything here is the operation the browser performs — `append` moves a node out of wherever
// it was, `focus` lands only where the browser would let it and is what `activeElement` then
// answers, `closest` walks the real parent chain, and an event travels the capture and bubble
// phases the shared dispatcher (`src/server/dom-double/dom-events.test-support.ts`) runs for every double.

import {
  assertAttributeName,
  canTakeFocus,
  type DispatchedEvent,
  dispatchAlong,
  type EventNode,
  type ListenerOptions,
  Listeners,
} from "../../../server/dom-double/dom-events.test-support.ts";
import { parseInto, type TreeBuilder } from "../../../server/dom-double/html-parse.test-support.ts";
import { parseSelector, type Step } from "./choice-picker.selectors.test-support.ts";
import { formElements, withNamedAccess } from "./form-named-access.test-support.ts";
import { LaidOut } from "./layout-box.test-support.ts";

type Listener = (event: Record<string, unknown>) => void;

/** The tags each DOM constructor the module tests against stands for. */
export const ELEMENT_CLASSES = {
  HTMLInputElement: ["input"],
  HTMLTextAreaElement: ["textarea"],
  HTMLButtonElement: ["button"],
  HTMLFormElement: ["form"],
  HTMLMediaElement: ["video", "audio"],
} as const;

/**
 * The input types whose `value` IDL property reflects the content attribute rather than shadowing
 * it. It is why a hidden input cannot be cleared by `form.reset()` once written through.
 */
const REFLECTED_VALUE_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);

export class El extends LaidOut implements EventNode {
  readonly children: El[] = [];
  parent: El | null = null;
  ownText = "";
  /** The raw value, and the dirty flag with it: `null` until something writes through. */
  private ownValue: string | null = null;

  /** Reflected, like the real property: `[hidden]` stops matching once it is shown. */
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }

  set hidden(next: boolean) {
    if (next) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  /**
   * A textarea's default value is its content, and its `value` shadows that content the moment
   * anything writes through it: the markup keeps saying what the server rendered.
   */
  get value(): string {
    if (this.reflectsValue) return this.getAttribute("value") ?? "";
    return this.ownValue ?? (this.tag === "textarea" ? this.ownText : "");
  }

  set value(next: string) {
    if (this.reflectsValue) this.setAttribute("value", next);
    else this.ownValue = next;
  }

  private get reflectsValue(): boolean {
    return this.tag === "input" && REFLECTED_VALUE_TYPES.has(this.getAttribute("type") ?? "text");
  }

  /** What `form.reset()` does: a cancellable `reset`, then every control back to its markup's. */
  reset(): void {
    if (!this.dispatchEvent({ type: "reset", bubbles: true, cancelable: true })) return;
    for (const node of this.descendants()) {
      // A textarea's default is the content, not an attribute, so a reset is the dirty
      // flag going out rather than a value being copied in.
      if (node.tag === "textarea") node.ownValue = null;
      if (node.tag !== "input") continue;
      node.value = node.getAttribute("value") ?? "";
      if (node.getAttribute("type") === "radio" || node.getAttribute("type") === "checkbox") {
        node.checked = node.hasAttribute("checked");
      }
    }
  }

  checked = false;
  /** A `<template>`'s inert fragment: parsed apart from the tree, so no query reaches into it. */
  content: El | null = null;
  readonly listeners = new Listeners();

  /**
   * Written through to the `style` attribute, because the browser's is: a test that reads
   * `getAttribute("style")` back was reading `null` however much the module had written.
   */
  private readonly ownStyle: Record<string, string> = {};

  get style(): Record<string, string> {
    return new Proxy(this.ownStyle, {
      set: (target, key: string, value: string) => {
        target[key] = value;
        const written = Object.entries(target)
          .filter(([, one]) => one !== "")
          .map(([name, one]) => `${kebab(name)}: ${one};`)
          .join(" ");
        if (written === "") this.removeAttribute("style");
        else this.setAttribute("style", written);
        return true;
      },
    });
  }
  /** The height the element has been given, which is the floor under what it reports. */
  protected override givenHeight(): number {
    return Number.parseFloat(this.ownStyle.height ?? "");
  }

  constructor(
    readonly tag: string,
    readonly attributes: Record<string, string> = {},
  ) {
    super();
  }

  /* ── the tree ───────────────────────────────────────────────────────────── */

  append(...nodes: El[]): this {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
    this.ownerDoc?.report(nodes);
    return this;
  }

  /** `ChildNode.before`: each node moved out of wherever it was, to just ahead of this one. */
  before(...nodes: El[]): void {
    const host = this.parent;
    if (host === null) return;
    for (const node of nodes) {
      node.remove();
      host.children.splice(host.children.indexOf(this), 0, node);
      node.parent = host;
    }
    host.ownerDoc?.report(nodes);
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /** Deep, like the clone a record view is taken from its template by. */
  cloneNode(deep = false): El {
    const copy = element(this.tag, { ...this.attributes });
    copy.ownText = this.ownText;
    // The raw value and the dirty flag both travel, as the cloning steps for a value-carrying
    // control say: a clone of an untouched control still resets to what its markup declares.
    copy.ownValue = this.ownValue;
    copy.checked = this.checked;
    copy.box = { ...this.box };
    copy.computed = { ...this.computed };
    if (deep) for (const child of this.children) copy.append(child.cloneNode(true));
    if (this.content) copy.content = this.content.cloneNode(true);
    return copy;
  }

  /** What puts a record view where its collection was. */
  replaceWith(incoming: El): void {
    const siblings = this.parent?.children;
    const at = siblings?.indexOf(this) ?? -1;
    if (!siblings || at < 0) return;
    const host = this.parent as El;
    incoming.remove();
    siblings.splice(at, 1, incoming);
    incoming.parent = host;
    this.parent = null;
    host.ownerDoc?.report([incoming]);
  }

  get isConnected(): boolean {
    for (let node: El | null = this; node; node = node.parent) if (node instanceof Doc) return true;
    return false;
  }

  get firstElementChild(): El | null {
    return this.children.find((child) => child.tag !== "#text") ?? null;
  }

  /** Null at the document, exactly as a real element's is. The clipping walk needs it. */
  get parentElement(): El | null {
    return this.parent === null || this.parent instanceof Doc ? null : this.parent;
  }

  /**
   * A control's form owner. Every control the shell renders is inside the form it posts through,
   * so the ancestor walk is the whole of it — no markup this parses uses `form=""`.
   */
  get form(): El | null {
    return this.closest("form");
  }

  get elements() {
    return formElements(this);
  }

  contains(other: El): boolean {
    for (let node: El | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  *descendants(): Generator<El> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  /** The child nodes the picker walks to read an option's label apart from its note. */
  get childNodes(): El[] {
    return this.ownText === "" ? this.children : [textNode(this.ownText), ...this.children];
  }

  /* ── attributes ─────────────────────────────────────────────────────────── */

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    assertAttributeName(name);
    this.attributes[name] = String(value);
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  get id(): string {
    return this.attributes.id ?? "";
  }

  set id(next: string) {
    this.setAttribute("id", next);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(next: boolean) {
    if (next) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get dataset(): Record<string, string | undefined> {
    const own = this.attributes;
    return new Proxy(
      {},
      {
        get: (_target, key: string) => own[`data-${kebab(key)}`],
        set: (_target, key: string, value: string) => {
          own[`data-${kebab(key)}`] = String(value);
          return true;
        },
        has: (_target, key: string) => `data-${kebab(key)}` in own,
        deleteProperty: (_target, key: string) => {
          delete own[`data-${kebab(key)}`];
          return true;
        },
      },
    );
  }

  /** Reflected, like the real property: a script writing `className` writes the attribute. */
  get className(): string {
    return this.attributes.class ?? "";
  }

  set className(next: string) {
    this.setAttribute("class", next);
  }

  get classList() {
    const own = this.attributes;
    const names = () => new Set((own.class ?? "").split(/\s+/).filter(Boolean));
    const write = (set: Set<string>) => {
      own.class = [...set].join(" ");
    };
    return {
      contains: (name: string) => names().has(name),
      add: (name: string) => {
        const set = names();
        set.add(name);
        write(set);
      },
      remove: (name: string) => {
        const set = names();
        set.delete(name);
        write(set);
      },
      toggle: (name: string, force?: boolean) => {
        const set = names();
        if (force ?? !set.has(name)) set.add(name);
        else set.delete(name);
        write(set);
      },
    };
  }

  get textContent(): string {
    return this.children.reduce((text, child) => text + child.textContent, this.ownText);
  }

  set textContent(words: string) {
    for (const child of [...this.children]) child.remove();
    this.ownText = words;
  }

  /** What a control that redraws itself writes, read by the double's own parser. */
  replaceChildren(...nodes: El[]): void {
    this.textContent = "";
    this.append(...nodes);
  }

  /** A `<template>`'s markup is parsed into its inert content, as the browser parses it. */
  set innerHTML(html: string) {
    const into = this.content ?? this;
    into.textContent = "";
    parseHtml(html, into);
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  get parentNode(): El | null {
    return this.parent;
  }

  /** What `x-show` writes to hide a node, and what a script's `style.display` does. */
  get displayNone(): boolean {
    return this.ownStyle.display === "none";
  }

  /* ── matching ───────────────────────────────────────────────────────────── */

  matchesStep(step: Step): boolean {
    if (step.tag && step.tag !== this.tag) return false;
    if (!step.classes.every((name) => this.classList.contains(name))) return false;
    const holds = ([name, value]: readonly [string, string | null]) =>
      this.hasAttribute(name) && (value === null || this.getAttribute(name) === value);
    return step.attributes.every(holds) && !step.refused.some(holds);
  }

  matches(selector: string): boolean {
    // Every alternative parsed before any is tried: `p,` is a syntax error even where `p` matches.
    return selector
      .split(",")
      .map(parseSelector)
      .some((steps) => this.matchesSteps(steps));
  }

  /** The last step must match this; every earlier step must match some ancestor. */
  private matchesSteps(steps: readonly Step[]): boolean {
    const last = steps.at(-1);
    if (!last || !this.matchesStep(last)) return false;
    let node = this.parent;
    for (const step of [...steps.slice(0, -1)].reverse()) {
      while (node && !node.matchesStep(step)) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }

  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent)
      if (matching(node, selector)) return node;
    return null;
  }

  querySelector(selector: string): El | null {
    for (const node of this.scopedTo(selector))
      if (matching(node, childStep(selector))) return node;
    return null;
  }

  querySelectorAll(selector: string): El[] {
    return [...this.scopedTo(selector)].filter((node) => matching(node, childStep(selector)));
  }

  /** `:scope > x` asks only this node's children; anything else asks every descendant. */
  private scopedTo(selector: string): Iterable<El> {
    return SCOPED_CHILD.test(selector) ? this.children : this.descendants();
  }

  /* ── behavior ───────────────────────────────────────────────────────────── */

  /** What the last `focus()` that took was asked with: `focusVisible` is behaviour. */
  focusOptions: unknown;

  /** The browser's rules: a detached, hidden, disabled or unfocusable node refuses in silence. */
  focus(options?: unknown): void {
    const doc = this.ownerDoc;
    if (doc === null || (this as El) === doc || !canTakeFocus(this, true)) return;
    doc.focusOn(this);
    this.focusOptions = options;
  }

  blur(): void {
    const doc = this.ownerDoc;
    if (doc?.activeElement === this) doc.focusOn(null);
  }

  getBoundingClientRect() {
    return { ...this.box };
  }

  addEventListener(type: string, run: Listener, options?: ListenerOptions): void {
    this.listeners.add(type, run, options);
  }

  removeEventListener(type: string, run: Listener, options?: ListenerOptions): void {
    this.listeners.remove(type, run, options);
  }

  /** A script's own press: one click at this node, travelling as a click the person made does. */
  click(): void {
    this.ownerDoc?.fire("click", this);
  }

  /** The target, then every ancestor up to the document, in the phases the event travels. */
  dispatchEvent(event: DispatchedEvent): boolean {
    const path: El[] = [];
    for (let node: El | null = this; node; node = node.parent) path.push(node);
    return dispatchAlong(path, event);
  }

  get ownerDoc(): Doc | null {
    for (let node: El | null = this; node; node = node.parent) if (node instanceof Doc) return node;
    return null;
  }

  get ownerDocument(): Doc | null {
    return this.ownerDoc;
  }
}

/** A child query of one step: `:scope > [attr]`, the one relative form the shell writes. */
const SCOPED_CHILD = /^:scope\s*>\s*(?=\S+$)/;
const childStep = (selector: string) => selector.replace(SCOPED_CHILD, "");

/** The browser's own matching, which no control a form holds can stand in front of. */
const matching = (node: El, selector: string) => El.prototype.matches.call(node, selector);

/** What the double reads off a node to work at all, so no control name may shadow it. */
const DOUBLE_OWN = new Set([
  "parent",
  "tag",
  "children",
  "attributes",
  "listeners",
  "descendants",
  "content",
  "box",
  "computed",
]);

/** An element as the parser, a clone and `createElement` make one: a form answers to its controls. */
export function element(tag: string, attributes: Record<string, string> = {}): El {
  const node = new El(tag, attributes);
  if (tag === "template") node.content = new El("#template");
  return tag === "form" ? withNamedAccess(node, DOUBLE_OWN) : node;
}

function textNode(text: string): El {
  const node = new El("#text");
  node.ownText = text;
  return node;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export class Doc extends El {
  private focusedNode: El | null = null;
  /** Every `change` that reached the document, which is where a consumer of one hears it. */
  readonly changes: { value: unknown }[] = [];
  /** The arrival watches running on this document, and what each one asked to watch. */
  private readonly observers: ((records: { addedNodes: El[] }[]) => void)[] = [];
  readonly watches: { target: El; options: { childList?: boolean; subtree?: boolean } }[] = [];

  constructor() {
    super("#document");
    this.addEventListener("change", (event) => {
      this.changes.push({ value: (event.target as El).value });
    });
  }

  /**
   * The document stands in for its body: a scene parses straight into it, so the node every
   * query starts from is also where focus rests when nothing holds it.
   */
  get body(): El {
    return this;
  }

  /** What `focus()` last landed on while it is still on the page, and the body otherwise. */
  get activeElement(): El {
    const held = this.focusedNode;
    return held !== null && held.ownerDoc === this ? held : this.body;
  }

  /** Where a `focus()` the rules let through lands: nothing else writes it. */
  focusOn(node: El | null): void {
    this.focusedNode = node;
  }

  /** Tell every watch what just entered the tree. */
  report(added: readonly El[]): void {
    if (added.length === 0 || this.observers.length === 0) return;
    const pending = this.pendingRecords.length > 0;
    this.pendingRecords.push({ addedNodes: [...added] });
    if (pending) return;
    // Delivered on a microtask, batched, the way the browser delivers mutation records; a
    // callback that throws is reported, as the browser reports it, and the others still run.
    queueMicrotask(() => {
      const records = this.pendingRecords.splice(0);
      for (const observer of [...this.observers]) {
        try {
          observer(records);
        } catch (error) {
          this.reported.push(error);
        }
      }
    });
  }

  private readonly pendingRecords: { addedNodes: El[] }[] = [];
  /** What a mutation callback threw, which the browser reports rather than hands anyone. */
  readonly reported: unknown[] = [];

  /** Every mutation record queued so far, delivered: the microtask the browser would run. */
  async arrivals(): Promise<void> {
    await Promise.resolve();
  }

  /** Every live box watch, and the fixture's way of telling one its element has a size. */
  readonly resizes: { target: El; run: () => void }[] = [];

  /**
   * Give an element a width and tell every watch on it. Two steps in a browser, one here:
   * the double has no layout, so the size is written and the notification is the same call.
   */
  resize(target: El, width: number): void {
    target.clientWidth = width;
    for (const watch of this.resizes) if (watch.target === target) watch.run();
  }

  /** The window half the placement walk reads: the viewport, computed styles, and the watch. */
  get defaultView() {
    const doc = this;
    return {
      innerWidth: 1200,
      innerHeight: 900,
      /**
       * Delivered on a microtask, as the browser delivers it. `observe` keeps its arguments: a
       * watch that is not `childList` hears nothing.
       */
      MutationObserver: class {
        constructor(private readonly run: (records: { addedNodes: El[] }[]) => void) {}
        observe(target: El, options: { childList?: boolean; subtree?: boolean } = {}): void {
          doc.watches.push({ target, options });
          if (options.childList === true && options.subtree === true) doc.observers.push(this.run);
        }
      },
      /**
       * A box watch. The browser fires on `observe` and again on every box change, including the
       * change from no box at all, which a control inside an unopened panel has.
       */
      ResizeObserver: class {
        constructor(private readonly run: () => void) {}
        observe(target: El): void {
          doc.resizes.push({ target, run: this.run });
          this.run();
        }
        /** The half a watcher that is never released would never call. */
        disconnect(): void {
          for (let index = doc.resizes.length - 1; index >= 0; index -= 1) {
            if (doc.resizes[index]?.run === this.run) doc.resizes.splice(index, 1);
          }
        }
      },
      getComputedStyle: (node: El) => ({ filter: "none", ...node.computed }),
      /** The prototype a control named `reset` cannot shadow, which is why the platform calls it. */
      HTMLFormElement: { prototype: { reset: El.prototype.reset } },
      addEventListener: (type: string, run: Listener) => {
        this.addEventListener(type, run);
      },
    };
  }

  /**
   * The document's one element child — `<html>` in a browser. A module that boots over the whole
   * page starts from this, so a scene parsing straight into the document would mount nothing.
   */
  get documentElement(): El | null {
    return this.children[0] ?? null;
  }

  /** The browser refuses a name no element could have, rather than making one. */
  readonly createElement = (tag: string): El => {
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) {
      throw new DOMException(`"${tag}" is not a valid element name.`, "InvalidCharacterError");
    }
    return element(tag);
  };

  getElementById(id: string): El | null {
    for (const node of this.descendants()) if (node.getAttribute("id") === id) return node;
    return null;
  }

  /**
   * Send one event the way the user agent sends it: capture from the document down, then bubble
   * from the target up, unless its type is one that never bubbles (an inner scroller's `scroll`).
   * @returns whether a listener cancelled it, and whether one stopped it on the way
   */
  fire(type: string, target: El, extra: Record<string, unknown> = {}) {
    let stopped = false;
    const event = {
      type,
      target,
      ...extra,
      stopPropagation: () => {
        stopped = true;
      },
      stopImmediatePropagation: () => {
        stopped = true;
      },
    };
    const prevented = !target.dispatchEvent(event);
    return { prevented, stopped };
  }
}

/* ── the parser ────────────────────────────────────────────────────────────── */

/** How the shared parser makes this double's nodes. */
const BUILDER: TreeBuilder<El> = {
  element(tag, attributes) {
    const node = element(tag);
    for (const [name, value] of attributes) node.attributes[name] = value;
    // An input's `value` attribute is what the browser seeds the property from, and the property
    // is what a form posts. A textarea is seeded from its content, which is not parsed yet.
    if (tag !== "textarea") node.value = node.getAttribute("value") ?? "";
    node.checked = node.hasAttribute("checked");
    return node;
  },
  contentOf(element, tag) {
    if (tag !== "template") return element;
    element.content = new El("#template");
    return element.content;
  },
  append: (holder, node) => {
    holder.append(node);
  },
  text: (holder, words) => appendText(holder, words),
};

/** Parse the renderer's markup into the double, refusing anything a browser would build apart. */
export function parseHtml(html: string, into: El): El {
  parseInto(html, into, BUILDER);
  return into;
}

/** Text before a child becomes the element's own text; text after it becomes a text node. */
function appendText(parent: El, text: string): void {
  if (parent.children.length === 0) parent.ownText += text;
  else parent.append(textNode(text));
}
