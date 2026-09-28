// A desk with real windows standing on it, and a watcher on every way off it.
//
// What 6.5/02 asks for is not settled by a file failing to contain a word: that a whole life of an
// answer window leaves the browser exactly as it found it. So the three surfaces the issue names —
// the server, the browser's store, the address — are all doubled and all recording, and so are the
// two a leak would otherwise take quietly: cookies, and the store reached through `window`.
//
// The desk carries a logo and a prompt bar because a sweep over an empty page proves nothing, and
// installed globals are taken away per suite: Bun loads a whole shard into one process, and a
// `document` standing at import time starts every browser module in it.
//
// Not a test file, so bun never runs it.

import { PROMPT_FORM_ID } from "#shell/desk-window.js";
import { PROMPT_FIELD_ID } from "#shell/shell-dom.js";
import {
  type DispatchedEvent,
  dispatchAlong,
  type ListenerOptions,
  Listeners,
} from "../../../server/dom-events.test-support.ts";
import { El } from "./desk-dom.test-support.ts";

export { DESK, deskTrace, El, everythingSaid } from "./desk-dom.test-support.ts";

/**
 * The browser's store, with every touch of it written down. The claim under test is about writes
 * that never happen, so a double that silently accepted one would prove the opposite of the point.
 */
export class RecordingStore {
  readonly writes: string[] = [];
  readonly reads: string[] = [];
  private readonly held = new Map<string, string>();

  constructor(seed: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(seed)) this.held.set(key, value);
  }

  getItem(key: string): string | null {
    this.reads.push(key);
    return this.held.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(`set ${key}`);
    this.held.set(key, value);
  }

  removeItem(key: string): void {
    this.writes.push(`remove ${key}`);
    this.held.delete(key);
  }

  keys(): string[] {
    return [...this.held.keys()].sort();
  }

  contents(): Record<string, string> {
    return Object.fromEntries([...this.held.entries()].sort());
  }
}

export interface AddressBar {
  pathname: string;
  search: string;
  readonly written: string[];
}

export interface StandingDesk {
  /** The document the window modules are started on, and the ground everything stands in. */
  readonly doc: DeskDocument;
  readonly root: El;
  readonly layer: El;
  readonly logos: El;
  readonly bar: El;
  readonly store: RecordingStore;
  /** The other store a leak reaches for, and the one that survives a tab closing. */
  readonly session: RecordingStore;
  readonly address: AddressBar;
  /** Every request the page made, by any transport the browser offers. */
  readonly sent: string[];
  /** Every cookie written, which is the quietest way a page could remember something. */
  readonly cookies: string[];
  /** Every window standing right now, in the order the layer holds them. */
  windows(): El[];
  /** Every node a `ResizeObserver` is still watching: a window's frame lets go of its own. */
  observed(): El[];
  restore(): void;
}

const OCCUPIED = [
  "HTMLElement",
  "Element",
  "Node",
  "CustomEvent",
  "ResizeObserver",
  "MutationObserver",
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "fetch",
  "XMLHttpRequest",
  "EventSource",
  "WebSocket",
  "navigator",
] as const;

/**
 * Stand a desk up, with a logo on it and a prompt bar under it. What comes back is the layer the
 * windows mount into, plus every way off the page a disposable window is not allowed to take.
 */
export function standingDesk(seed: Readonly<Record<string, string>> = {}): StandingDesk {
  const globals = globalThis as unknown as Record<string, unknown>;
  const displaced = new Map<string, unknown>();
  for (const name of OCCUPIED) displaced.set(name, globals[name]);

  const { root, layer, logos, bar } = buildDesk();
  El.page = root;

  const store = new RecordingStore(seed);
  const session = new RecordingStore();
  const address: AddressBar = { pathname: "/capability/notes", search: "", written: [] };
  const sent: string[] = [];
  const cookies: string[] = [];
  const doc = documentOver(root, cookies);
  El.pageDocument = doc;
  El.active = null;
  const watches = new Set<Set<El>>();

  Object.assign(globals, {
    ...frameGlobals(watches),
    document: doc,
    window: {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      addEventListener: () => {},
      location: address,
      history: {
        state: null,
        pushState: (_s: unknown, _t: string, next: string) => rewrite(address, next, "push"),
        replaceState: (_s: unknown, _t: string, next: string) => rewrite(address, next, "replace"),
      },
      localStorage: store,
      sessionStorage: session,
      fetch: (input: unknown) => record(sent, "fetch", input),
    },
    localStorage: store,
    sessionStorage: session,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    ...transports(sent),
  });

  return {
    doc,
    root,
    layer,
    logos,
    bar,
    store,
    session,
    address,
    sent,
    cookies,
    windows: () => [...layer.children],
    observed: () => [...watches].flatMap((targets) => [...targets]),
    restore: () => {
      El.page = null;
      El.pageDocument = null;
      El.active = null;
      for (const name of OCCUPIED) {
        if (displaced.get(name) === undefined) delete globals[name];
        else globals[name] = displaced.get(name);
      }
    },
  };
}

/** A desk with something on it: a capability's logo, the window layer, and the prompt bar. */
function buildDesk() {
  const root = new El("body");
  const logos = new El("div");
  logos.className = "desk__logos";
  const logo = new El("button");
  logo.setAttribute("data-capability-logo", "notes");
  logo.textContent = "Notes";
  logos.append(logo);

  const layer = new El("div");
  layer.className = "desk__windows";

  const bar = new El("form");
  bar.id = PROMPT_FORM_ID;
  const field = new El("input");
  field.id = PROMPT_FIELD_ID;
  bar.append(field);

  root.append(logos, layer, bar);
  return { root, layer, logos, bar };
}

/** The globals the shared window frame reaches for while it mounts, watches kept in `watches`. */
function frameGlobals(watches: Set<Set<El>>) {
  return {
    HTMLElement: El,
    Element: El,
    Node: El,
    ResizeObserver: class {
      readonly targets = new Set<El>();
      constructor() {
        watches.add(this.targets);
      }
      observe(target: El) {
        this.targets.add(target);
      }
      unobserve(target: El) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
}

/** Every transport a page could reach the server with, each one recording rather than refusing. */
function transports(sent: string[]) {
  return {
    fetch: (input: unknown) => record(sent, "fetch", input),
    XMLHttpRequest: class {
      open(method: string, url: string) {
        sent.push(`xhr ${method} ${url}`);
      }
      setRequestHeader() {}
      send() {}
    },
    EventSource: class {
      constructor(url: string) {
        sent.push(`eventsource ${url}`);
      }
      addEventListener() {}
      close() {}
    },
    WebSocket: class {
      constructor(url: string) {
        sent.push(`websocket ${url}`);
      }
      addEventListener() {}
      send() {}
      close() {}
    },
    navigator: {
      sendBeacon: (url: string) => {
        sent.push(`beacon ${url}`);
        return true;
      },
    },
  };
}

function record(sent: string[], how: string, input: unknown): Promise<unknown> {
  sent.push(`${how} ${String(input)}`);
  return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
}

/** Drag a window by its bar, the whole gesture: the press, a move, and letting go. */
export function dragBy(bar: El, dx: number, dy: number): void {
  bar.dispatchEvent({
    type: "pointerdown",
    target: bar,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as never);
  bar.dispatchEvent({ type: "pointermove", pointerId: 1, clientX: dx, clientY: dy } as never);
  bar.dispatchEvent({ type: "pointerup", pointerId: 1, clientX: dx, clientY: dy } as never);
}

/**
 * Press a window's lamp the way a person does — on the button. The frame delegates a click on its
 * lamp row into the `window:lamp` every window listens for, so starting anywhere else would leave
 * the control that actually dismisses an answer unproved.
 */
export function pressLamp(el: El, action: string): void {
  const lamp = el.querySelector(`.lamp[data-action="${action}"]`);
  if (lamp === null) throw new Error(`No \`${action}\` lamp on this window.`);
  lamp.dispatchEvent({ type: "click", target: lamp, stopPropagation: () => {} } as never);
}

function rewrite(address: AddressBar, next: string, how: string): void {
  address.written.push(`${how} ${next}`);
  const [pathname = "", search = ""] = next.split("?");
  address.pathname = pathname;
  address.search = search === "" ? "" : `?${search}`;
}

/** The document double, as much of one as a window module is handed when the page starts it. */
export type DeskDocument = ReturnType<typeof documentOver>;

function documentOver(root: El, cookies: string[]) {
  const listeners = new Listeners();
  return {
    listeners,
    documentElement: new El("html"),
    body: root,
    /** The page's one focus: what `focus()` last landed on, or the body once that has gone. */
    get activeElement(): El {
      return El.active?.isConnected === true ? El.active : root;
    },
    get cookie(): string {
      return cookies.join("; ");
    },
    set cookie(written: string) {
      cookies.push(written);
    },
    createElement: (tag: string) => new El(tag),
    createElementNS: (_namespace: string, tag: string) => new El(tag),
    createDocumentFragment: () => new El("#fragment"),
    getElementById: (id: string) => root.querySelector(`#${id}`),
    querySelector: (selector: string) => root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    contains: (node: unknown) => node === root || root.descendants().includes(node as El),
    addEventListener: (type: string, run: (event: never) => void, options?: ListenerOptions) =>
      listeners.add(type, run, options),
    removeEventListener: (type: string, run: (event: never) => void, options?: ListenerOptions) =>
      listeners.remove(type, run, options),
    /** An event sent at the document itself: its own listeners, and nothing else. */
    dispatchEvent(event: DispatchedEvent): boolean {
      return dispatchAlong([this], event);
    },
  };
}
