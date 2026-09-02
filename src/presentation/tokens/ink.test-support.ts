// A DOM small enough to run the ink system in Bun.
//
// `design/scripts/ink.js` is browser code and the repo carries no DOM harness, which
// is why the parts of it that decide things — how many resize observations a list
// costs, whether a redrawn element keeps its hand, what happens to an element that
// cannot hold the layers — would otherwise be verifiable only by eye. This is the
// smallest surface that runs it honestly: real elements with a settable measured box,
// a real container tree, and observers the test drives itself so a frame is a call
// rather than a wait.
//
// Nothing here is a general DOM. It implements exactly what the ink system touches.

interface Box {
  w: number;
  h: number;
}

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly properties: Record<string, string> = {};
  readonly classes = new Set<string>();
  parentElement: FakeElement | null = null;
  innerHTML = "";
  box: Box = { w: 0, h: 0 };
  borderWidth = 0;
  radius = 0;
  position = "static";
  connected = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get offsetWidth(): number {
    return this.box.w;
  }

  get offsetHeight(): number {
    return this.box.h;
  }

  get isConnected(): boolean {
    for (let el: FakeElement | null = this; el; el = el.parentElement) {
      if (el.connected) return true;
    }
    return false;
  }

  get classList() {
    return {
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name),
      contains: (name: string) => this.classes.has(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name !== "class") return;
    this.classes.clear();
    for (const token of value.split(/\s+/).filter(Boolean)) this.classes.add(token);
  }

  matches(selector: string): boolean {
    return selector.split(",").some((simple) => matchesOne(this, simple.trim()));
  }

  closest(selector: string): FakeElement | null {
    for (let el: FakeElement | null = this; el; el = el.parentElement) {
      if (el.matches(selector)) return el;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => el.matches(selector));
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  prepend(node: FakeElement): void {
    node.detach();
    node.parentElement = this;
    this.children.unshift(node);
  }

  append(node: FakeElement): void {
    node.detach();
    node.parentElement = this;
    this.children.push(node);
  }

  remove(): void {
    this.detach();
  }

  private detach(): void {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
}

function matchesOne(el: FakeElement, selector: string): boolean {
  if (!selector) return false;
  if (selector.startsWith(".")) return el.classes.has(selector.slice(1));
  if (selector.startsWith("[")) return el.attributes.has(selector.slice(1, -1));
  return el.tagName === selector.toUpperCase();
}

class FakeHTMLElement extends FakeElement {}
class FakeSVGElement extends FakeElement {}

/**
 * The world the ink system runs in. `frame()` is one animation frame; `resize()` and
 * `mutate()` are what the browser would have reported.
 */
export interface FakeDom {
  /** Hand the globals back, so a later test file meets the environment it expected. */
  restore(): void;
  element(tagName: string, className?: string): FakeElement;
  body: FakeElement;
  frame(): void;
  resizeObservations(): FakeElement[];
  resize(...targets: FakeElement[]): void;
  mutate(record: {
    type: string;
    target: FakeElement;
    added?: FakeElement[];
    removed?: FakeElement[];
  }): void;
}

/** The globals this fake occupies, so they can be handed back. */
const OCCUPIED = [
  "Element",
  "HTMLElement",
  "document",
  "getComputedStyle",
  "requestAnimationFrame",
  "ResizeObserver",
  "MutationObserver",
] as const;

export function installFakeDom(): FakeDom {
  const frames: (() => void)[] = [];
  const resize = observerHandle<FakeElement>();
  const mutation = observerHandle<FakeElement>();
  const globals = globalThis as unknown as Record<string, unknown>;
  const displaced = Object.fromEntries(OCCUPIED.map((name) => [name, globals[name]]));

  const body = new FakeHTMLElement("body");
  body.connected = true;

  Object.assign(globalThis as unknown as Record<string, unknown>, {
    Element: FakeElement,
    HTMLElement: FakeHTMLElement,
    document: {
      body,
      readyState: "complete",
      createElementNS: () => new FakeSVGElement("svg"),
      querySelectorAll: (selector: string) => body.querySelectorAll(selector),
      /*
       * Browser modules elsewhere in this repo install themselves behind a
       * `typeof document !== "undefined"` guard. Bun has no `document`, so they stay
       * dormant — until this fake answers that question for them. These two are what
       * they reach for on the way in.
       */
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    // A detached element has no computed style at all: the browser answers every
    // property with the empty string, `position` included. That is not a detail — a
    // guard reading `=== "static"` silently declines on it — so the fake answers the
    // way a browser does rather than the way it is convenient to.
    getComputedStyle: (el: FakeElement) => ({
      getPropertyValue: (name: string) => (el.isConnected ? (el.properties[name] ?? "") : ""),
      borderLeftWidth: el.isConnected ? `${el.borderWidth}px` : "",
      borderTopWidth: el.isConnected ? `${el.borderWidth}px` : "",
      borderTopLeftRadius: el.isConnected ? `${el.radius}px` : "",
      position: el.isConnected ? el.position : "",
    }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    ResizeObserver: observerClass(resize),
    MutationObserver: observerClass(mutation),
  });

  return {
    restore: () => {
      for (const name of OCCUPIED) {
        if (displaced[name] === undefined) delete globals[name];
        else globals[name] = displaced[name];
      }
    },
    body,
    element: (tagName, className) => {
      const el = new FakeHTMLElement(tagName);
      if (className) el.setAttribute("class", className);
      body.append(el);
      return el;
    },
    frame: () => {
      const work = frames.splice(0, frames.length);
      for (const run of work) run();
    },
    resizeObservations: () => [...resize.observed],
    resize: (...targets) => resize.fire(...targets),
    mutate: (record) =>
      mutation.callback?.([
        {
          type: record.type,
          target: record.target,
          addedNodes: record.added ?? [],
          removedNodes: record.removed ?? [],
        },
      ]),
  };
}

interface Handle<T> {
  readonly observed: T[];
  callback: ((records: unknown[]) => void) | null;
  fire(...targets: T[]): void;
}

function observerHandle<T>(): Handle<T> {
  const handle: Handle<T> = {
    observed: [],
    callback: null,
    fire: (...targets) => handle.callback?.(targets.map((target) => ({ target }))),
  };
  return handle;
}

function observerClass<T>(handle: Handle<T>) {
  return class {
    constructor(callback: (records: unknown[]) => void) {
      handle.callback = callback;
    }
    observe(target: T) {
      handle.observed.push(target);
    }
    unobserve(target: T) {
      handle.observed.splice(handle.observed.indexOf(target), 1);
    }
    disconnect() {}
  };
}
