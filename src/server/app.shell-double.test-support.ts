import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { startPromptBar } from "#shell/prompt-bar.js";

// The shell's glue, run rather than grepped. `public/app.js` is a classic script that
// imports nothing, so it is evaluated with the handful of DOM globals its rules actually
// touch — the double below is as much of the DOM as those rules reach for and no more. A
// rule proved against a double that has stopped resembling the DOM is proved against
// nothing, so every operation here is the one the browser performs.
//
// Shared because the shell has more than one subject standing on the same desk: the run
// that ends with something to tell you (`app.build-ending.test.ts`) and where the desk's
// messages are spoken (`app.prompt-bar-messages.test.ts`) are the same window, the same
// prompt bar and the same script.

export const WINDOW_REGION_ID = "spec-build-output";

/** As much of the shell's Alpine component as these rules touch. */
interface ShellState {
  promptBusy: boolean;
  init(): void;
}

export class El {
  readonly childNodes: El[] = [];
  parent: El | null = null;
  readonly attributes = new Map<string, string>();
  readonly dispatched: string[] = [];
  readonly nodeType = 1;
  isFragment = false;
  raw = "";
  value = "";
  focused = false;
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

  get firstChild(): El | null {
    return this.childNodes[0] ?? null;
  }

  /**
   * A live view over `data-*`, which is what the browser's `dataset` is. Held as a plain
   * object it was a second, empty store beside the attributes — so a node built with
   * `data-active-capability-id` read back as having no capability at all, and every rule
   * that identifies the surface in the window by its dataset was proved against nothing.
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
   * Read through the tree and written by replacing it — the two halves of the browser's
   * own `textContent`. Written as a field, the setter silently left the children it was
   * supposed to remove standing behind the new words, and every rule that replaces one
   * sentence with another would have proved itself against a slot that never emptied.
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  matches(selector: string): boolean {
    // One compound selector only. A descendant selector reaching this would match on its
    // first bracket group and quietly answer about the wrong node, which is exactly the
    // kind of lie a double is not allowed to tell.
    if (/\s/.test(selector.trim())) throw new Error(`not a compound selector: ${selector}`);
    if (selector.startsWith("#")) return this.attributes.get("id") === selector.slice(1);
    const tagged = /^([a-z]+)\[/.exec(selector);
    if (tagged && this.tag !== tagged[1]) return false;
    const attribute = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(selector);
    if (attribute) {
      const held = this.attributes.get(attribute[1] ?? "");
      return held !== undefined && (attribute[2] === undefined || held === attribute[2]);
    }
    return selector.startsWith(".") && this.classList.contains(selector.slice(1));
  }

  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  /** The first descendant this selector reaches, one compound step at a time. */
  querySelector(selector: string): El | null {
    // `:scope > x` asks about this node's own children and nothing deeper. Answered here
    // rather than left to the walk below, which would reach a grandchild and say yes —
    // and the rule that asks this is the one deciding whether the window is holding a
    // capability *directly*, where a grandchild is a different answer.
    const scoped = /^:scope\s*>\s*(.+)$/.exec(selector.trim());
    if (scoped) {
      const step = scoped[1] ?? "";
      if (/\s/.test(step)) throw new Error(`not a compound selector after :scope: ${step}`);
      return this.childNodes.find((child) => child.matches(step)) ?? null;
    }
    const [head, ...rest] = selector.trim().split(/\s+/);
    for (const child of this.childNodes) {
      const found = child.reachedBy(head ?? selector, rest) ?? child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  /** This node if the step ends here, or whatever the remaining steps reach inside it. */
  private reachedBy(step: string, rest: readonly string[]): El | null {
    if (!this.matches(step)) return null;
    return rest.length === 0 ? this : this.querySelector(rest.join(" "));
  }

  append(...nodes: El[]): void {
    for (const node of nodes) {
      if (node.isFragment) {
        this.append(...[...node.childNodes]);
        continue;
      }
      node.remove();
      node.parent = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes: El[]): void {
    for (const child of [...this.childNodes]) child.remove();
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  focus(): void {
    this.focused = true;
  }

  /** Listeners bound to this node, which is where htmx dispatches a swap's own events. */
  private readonly handlers = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), listener]);
  }

  removeEventListener(name: string, listener: (event: unknown) => void): void {
    const bound = this.handlers.get(name) ?? [];
    const at = bound.indexOf(listener);
    if (at >= 0) bound.splice(at, 1);
  }

  /**
   * The browser runs a node's own listeners whether or not the node is still in the
   * document — which is the whole reason a rule that has to hear about a swap into a
   * detached region binds itself here rather than to the document.
   */
  dispatchEvent(event: { type: string }): boolean {
    this.dispatched.push(event.type);
    for (const listener of [...(this.handlers.get(event.type) ?? [])]) listener(event);
    return true;
  }
}

/**
 * The one thing a `<template>` is for here: the parked restoration, inert and
 * unsearchable from the document until it is asked for. Its content is read exactly the
 * way the browser reads it — the outer element's attributes, and whatever it wraps.
 */
export class Template extends El {
  readonly content = new El("#fragment");

  constructor() {
    super("template");
    this.content.isFragment = true;
  }

  set innerHTML(raw: string) {
    this.raw = raw;
    this.content.replaceChildren(...parseFragment(raw));
  }
}

/**
 * As much of an HTML parser as the shell's rules ask a `<template>` for: elements with
 * their attributes, nested, carrying their text. Small, but not a stub — the rules under
 * test read a marker off a *child* of the element they found (a refusal's span inside the
 * prompt notice), and a parser that flattened everything into one node would answer
 * "no marker" to every one of them and let the rule ship broken.
 */
function parseFragment(raw: string): El[] {
  const roots: El[] = [];
  const open: El[] = [];
  for (const step of raw.matchAll(FRAGMENT_STEP)) takeStep(step, roots, open);
  return roots;
}

/** One tag — opening or closing, with its attributes — or the text between two. */
const FRAGMENT_STEP = /<(\/?)([\w-]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;

function takeStep(step: RegExpExecArray, roots: El[], open: El[]): void {
  const [, closing, tag = "div", attributes = "", selfClosing, text] = step;
  const holder = open.at(-1);
  if (text !== undefined) {
    if (holder) holder.ownText += text.trim();
    return;
  }
  if (closing === "/") {
    open.pop();
    return;
  }
  const node = elementFrom(tag, attributes);
  if (holder) holder.append(node);
  else roots.push(node);
  if (selfClosing !== "/" && !VOID_TAGS.has(tag)) open.push(node);
}

function elementFrom(tag: string, attributes: string): El {
  const node = new El(tag);
  for (const [, name, value] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
    if (name) node.setAttribute(name, value ?? "");
  }
  return node;
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/**
 * Note where a rule stops an event at the document. A capture-phase refusal keeps a
 * submission off the wire by stopping it before it can reach the form htmx listens on,
 * so the stop *is* the behaviour and has to be observable.
 */
function watchForStop(event: unknown, stopped: string[]): void {
  if (!(event instanceof Event)) return;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => {
    stopped.push(event.type);
    stop();
  };
}

/**
 * As much of a document as the shell's rules reach for, over the nodes standing on the
 * page. Its own function rather than another twenty lines inside `desk()`: what a
 * document answers is a subject, and the desk is already at the file's line ceiling.
 */
function documentOver(
  page: { page: El; region: El; notice: El; promptForm: El; promptField: El },
  listeners: Map<string, Array<(event: unknown) => void>>,
  dispatched: Array<{ type: string; detail: unknown }>,
) {
  return {
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    querySelector: (selector: string) => page.region.querySelector(selector),
    getElementById: (id: string) => {
      if (id === WINDOW_REGION_ID) return page.region;
      if (id === "prompt-notice") return page.notice;
      if (id === "spec-build-form") return page.promptForm;
      return id === "spec-build-prompt" ? page.promptField : null;
    },
    createElement: (tag: string) => (tag === "template" ? new Template() : new El(tag)),
    /**
     * What the browser answers for a node that is still in the page, and for one that has
     * been taken out of it — which is how a rule tells an answer that still has somewhere
     * to land from one that does not.
     */
    contains: (node: unknown) => {
      for (let at = node as El | null; at; at = at.parent) if (at === page.page) return true;
      return false;
    },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      dispatched.push({ type: event.type, detail: event.detail });
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
}

/** One run standing in the window, with the surface it displaced beside it. */
export function desk() {
  const region = new El("div", { id: WINDOW_REGION_ID });
  const displaced = new El("div", { "data-active-capability-id": "tasks" });
  const subscriber = new El("section", {
    class: "build-stream",
    "data-build-job-id": "build-1",
  });
  const narration = new El("div", { class: "build-stream__narration" });
  const surface = new El("div", { class: "build-stream__fragment" });
  subscriber.append(narration, surface);
  region.append(displaced, subscriber);

  const listeners = new Map<string, Array<(event: unknown) => void>>();
  /** Every event a rule stopped at the document — how a capture-phase refusal is seen. */
  const propagationStopped: string[] = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const processed: El[] = [];
  const notice = new El("div", { id: "prompt-notice" });
  const promptField = new El("input", { id: "spec-build-prompt" });
  const frames: Array<() => void> = [];
  /**
   * The bar itself — the form a prompt is submitted from, and what the 400ms refusal cue
   * is put on and taken off again. An element rather than a bare stand-in, because the
   * desk-action guard steps around this form by its id and could only be proved to do so
   * against something that reaches that check: in a browser the bar *is* an element, and
   * it names the window in its own `hx-target` exactly like the desk furniture the guard
   * is for.
   */
  class FormStub extends El {
    constructor() {
      super("form", {
        id: "spec-build-form",
        class: "prompt",
        "hx-target": `#${WINDOW_REGION_ID}`,
      });
    }
  }
  const promptForm = new FormStub();
  // The field is inside the bar, the way it is in the shell: the blank-prompt rule reads
  // what was typed off the form that was submitted, not off the document.
  promptForm.append(promptField);
  /* The page everything stands on. Without one, nothing in here can have *left* the
   * document, and a rule that asks whether its answer still has somewhere to land could
   * only ever be proved in a browser. */
  const page = new El("body");
  page.append(region, notice, promptForm);
  const documentStub = documentOver(
    { page, region, notice, promptForm, promptField },
    listeners,
    dispatched,
  );
  /** The `shell` component, so the courtesy state can be driven the way Alpine drives it. */
  let shellFactory: (() => ShellState) | null = null;
  const windowStub = {
    Alpine: {
      data(_name: string, factory: () => ShellState) {
        shellFactory = factory;
      },
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    location: { pathname: "/capability/tasks", search: "" },
    history: { state: null, replaceState() {} },
    htmx: {
      // The real bundle's mutable config object. The shell turns two of its defaults off
      // (`public/app.js`), so a double without one would let that statement be deleted
      // under a green suite.
      config: {} as Record<string, unknown>,
      process(node: El) {
        processed.push(node);
      },
    },
  };

  // The prompt bar is a module of the desk, started on this document the way the page
  // starts it — the glue only ever tells it things, so the two halves have to both be
  // standing for a sentence to reach the slot at all.
  startPromptBar(documentStub as never);

  const appScript = readFileSync(resolve("public/app.js"), "utf8");
  Function(
    "document",
    "window",
    "requestAnimationFrame",
    "HTMLInputElement",
    "HTMLFormElement",
    "HTMLElement",
    "Element",
    "HTMLTemplateElement",
    "Node",
    appScript,
  )(
    documentStub,
    windowStub,
    (frame: () => void) => frames.push(frame),
    El,
    FormStub,
    El,
    El,
    Template,
    { TEXT_NODE: 3 },
  );

  /** Every rule listening for one event, in the order the document would run them. */
  const fire = (name: string, event: unknown) => {
    watchForStop(event, propagationStopped);
    for (const listener of listeners.get(name) ?? []) listener(event);
  };

  /** Start the shell component the way Alpine does, and hand back its state. */
  const startShell = () => {
    fire("alpine:init", new CustomEvent("alpine:init"));
    const state = shellFactory?.();
    state?.init();
    return state;
  };

  return {
    /** The document the shell was started on, for a module started on it beside them. */
    root: documentStub,
    /** The window stub, for the two htmx defaults the shell turns off on it. */
    windowStub,
    region,
    displaced,
    subscriber,
    narration,
    surface,
    notice,
    promptField,
    promptForm,
    listeners,
    fire,
    dispatched,
    processed,
    propagationStopped,
    frames,
    FormStub,
    startShell,
  };
}

export const RESTORATION = '<div data-build-restoration="capability"><p>collection</p></div>';

/** The ending arriving on the narration, exactly as the presenter streams it. */
export function narrateEnding(scene: ReturnType<typeof desk>) {
  scene.narration.append(new El("p", { "data-build-ending": "" }));
}

/**
 * A real event, aimed at a node of the double. The glue asks `event instanceof
 * CustomEvent` before it trusts a close, so a plain object would be waved through every
 * rule under test without running any of them.
 */
export function eventAt(type: string, target: El, detail: unknown) {
  const event = new CustomEvent(type, { detail, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

/** The restoration arriving on the fragment, exactly as the presenter streams it. */
export function streamRestoration(scene: ReturnType<typeof desk>, raw = RESTORATION) {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, { data: raw });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/** The stream closing the way the server closes it. */
export function closeStream(scene: ReturnType<typeof desk>) {
  scene.fire("htmx:sseClose", eventAt("htmx:sseClose", scene.surface, { type: "message" }));
}

/** The press that ends the wait. */
export function dismiss(scene: ReturnType<typeof desk>) {
  const button = new El("button", { "data-build-dismiss": "" });
  scene.subscriber.append(button);
  scene.fire("click", eventAt("click", button, null));
}
