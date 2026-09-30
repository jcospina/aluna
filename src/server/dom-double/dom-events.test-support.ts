// The browser's event dispatch and focus rules, shared by every DOM double so each one answers the
// same way: capture from the top down, the target, then — only for an event that bubbles — back
// up. A leaf: it imports nothing, so any double can stand on it. Not a test file itself.

/** What `addEventListener` takes as its third argument, as far as the shipped scripts use it. */
export type ListenerOptions =
  | boolean
  | {
      readonly capture?: boolean;
      readonly once?: boolean;
      readonly passive?: boolean;
      readonly signal?: AbortSignal;
    }
  | undefined;

/** Any listener at all: each double hands its listeners the event shape it builds. */
type Listener = (event: never) => void;

interface Registration {
  readonly type: string;
  readonly run: Listener;
  readonly capture: boolean;
  readonly once: boolean;
  removed: boolean;
}

const UNDERSTOOD_OPTIONS = new Set(["capture", "once", "passive", "signal"]);

function optionsOf(options: ListenerOptions): { capture: boolean; once: boolean } {
  if (options === undefined || typeof options === "boolean") {
    return { capture: options === true, once: false };
  }
  for (const key of Object.keys(options)) {
    if (!UNDERSTOOD_OPTIONS.has(key)) throw new Error(`the double does not model \`${key}\``);
  }
  return { capture: options.capture === true, once: options.once === true };
}

/** One node's listeners: keyed by type, phase and function, the way the browser dedupes them. */
export class Listeners {
  private readonly held: Registration[] = [];

  /** A `signal` already aborted adds nothing, and one that aborts later removes the listener. */
  add(type: string, run: Listener, options?: ListenerOptions): void {
    const { capture, once } = optionsOf(options);
    const signal = typeof options === "object" ? options.signal : undefined;
    if (signal?.aborted || this.find(type, run, capture) >= 0) return;
    const registration = { type, run, capture, once, removed: false };
    this.held.push(registration);
    signal?.addEventListener("abort", () => this.drop(registration), { once: true });
  }

  /** Matched on the capture flag too: a listener added captured is removed only captured. */
  remove(type: string, run: Listener, options?: ListenerOptions): void {
    const at = this.find(type, run, optionsOf(options).capture);
    if (at < 0) return;
    const [gone] = this.held.splice(at, 1);
    if (gone) gone.removed = true;
  }

  private drop(registration: Registration): void {
    const at = this.held.indexOf(registration);
    if (at >= 0) this.held.splice(at, 1);
    registration.removed = true;
  }

  /** How many are bound for `type`, in either phase. */
  count(type: string): number {
    return this.held.filter((one) => one.type === type).length;
  }

  /** The types anything is bound for, in the order they were first bound. */
  types(): string[] {
    return [...new Set(this.held.map((one) => one.type))];
  }

  /** A snapshot, as the browser takes one when the event reaches the node. */
  of(type: string, capture: boolean): Registration[] {
    return this.held.filter((one) => one.type === type && one.capture === capture);
  }

  private find(type: string, run: Listener, capture: boolean): number {
    return this.held.findIndex(
      (one) => one.type === type && one.run === run && one.capture === capture,
    );
  }
}

/** Events the browser itself sends without bubbling; anything else a user agent sends bubbles. */
export const NON_BUBBLING = new Set([
  "invalid",
  "focus",
  "blur",
  "load",
  "scroll",
  "mouseenter",
  "mouseleave",
  "pointerenter",
  "pointerleave",
]);

/**
 * Whether `event` bubbles. A script-built `Event` says so itself and defaults to no; a plain object
 * stands for the user agent's own event, which bubbles unless its type never does.
 */
export function bubbles(event: { type: string; bubbles?: unknown }): boolean {
  if (event instanceof Event) return event.bubbles;
  if (typeof event.bubbles === "boolean") return event.bubbles;
  return !NON_BUBBLING.has(event.type);
}

/** A browser event, or a plain object standing for one the user agent sends. */
export type DispatchedEvent = Event | { readonly type: string; readonly [extra: string]: unknown };

/** A node an event can pass through. */
export interface EventNode {
  readonly listeners: Listeners;
}

function define(event: object, name: string, value: unknown): void {
  Object.defineProperty(event, name, { value, configurable: true, writable: true });
}

type Stop = { stopped: boolean; immediate: boolean; prevented: () => boolean };

/** Every stop an event makes: a node, which of its phases, and what `eventPhase` reads there. */
function stopsAlong(path: readonly EventNode[], event: { type: string }) {
  const [target, ...above] = path;
  if (target === undefined) throw new Error("an event needs somewhere to go");
  const stop = (node: EventNode, capture: boolean, phase: number) => ({ node, capture, phase });
  return [
    ...[...above].reverse().map((node) => stop(node, true, 1)),
    stop(target, true, 2),
    stop(target, false, 2),
    ...(bubbles(event) ? above.map((node) => stop(node, false, 3)) : []),
  ];
}

/** One node's listeners for one phase, until one of them stops the event outright. */
function runAt(node: EventNode, capture: boolean, event: { type: string }, state: Stop): void {
  for (const one of node.listeners.of(event.type, capture)) {
    if (one.removed) continue;
    if (one.once) node.listeners.remove(one.type, one.run, { capture: one.capture });
    (one.run as (event: unknown) => void)(event);
    if (state.immediate) return;
  }
}

/**
 * Send `event` along `path`, the target first and the top last.
 * @returns false once a listener has cancelled it, which is what `dispatchEvent` answers
 */
export function dispatchAlong(path: readonly EventNode[], event: DispatchedEvent): boolean {
  const stops = stopsAlong(path, event);
  const state = watch(event as Record<string, unknown>);
  const fixed = Object.getOwnPropertyDescriptor(event, "target")?.configurable === false;
  if (!fixed && !(event as { target?: unknown }).target) define(event, "target", path[0]);
  for (const { node, capture, phase } of stops) {
    // A stop lets the phase it was called in finish; no later phase or node hears the event.
    if (state.stopped) break;
    define(event, "currentTarget", node);
    define(event, "eventPhase", phase);
    runAt(node, capture, event, state);
  }
  define(event, "currentTarget", null);
  return !state.prevented();
}

/** Watch a dispatch's own controls without taking a real event's away from it. */
function watch(event: Record<string, unknown>): Stop {
  const real = event instanceof Event;
  let prevented = event.defaultPrevented === true;
  const state = {
    stopped: false,
    immediate: false,
    prevented: () => (real ? (event as unknown as Event).defaultPrevented : prevented),
  };
  const own = (name: string) => event[name] as (() => void) | undefined;
  const stop = own("stopPropagation");
  const stopNow = own("stopImmediatePropagation");
  const prevent = own("preventDefault");
  define(event, "stopPropagation", () => {
    state.stopped = true;
    stop?.call(event);
  });
  define(event, "stopImmediatePropagation", () => {
    state.stopped = true;
    state.immediate = true;
    stopNow?.call(event);
  });
  define(event, "preventDefault", () => {
    if (event.cancelable !== false) prevented = true;
    prevent?.call(event);
  });
  if (!real)
    Object.defineProperty(event, "defaultPrevented", { get: () => prevented, configurable: true });
  return state;
}

/** The elements that take focus without a `tabindex`, as the browser lists them. */
const FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea", "iframe", "summary"]);
const DISABLEABLE_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "fieldset",
  "optgroup",
  "option",
]);

/** As much of an element as the focus rules read, one ancestor at a time. */
export interface FocusNode {
  readonly tagName: string;
  readonly parentNode: FocusNode | null;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  /** Whether a `display: none` is written on this node itself, which is what `x-show` writes. */
  readonly displayNone: boolean;
}

function focusableAtAll(node: FocusNode, tag: string): boolean {
  if (node.hasAttribute("tabindex") || node.getAttribute("contenteditable") === "true") return true;
  if (tag === "a") return node.hasAttribute("href");
  return FOCUSABLE_TAGS.has(tag) && !(tag === "input" && node.getAttribute("type") === "hidden");
}

/** A disabled control, or one inside a disabled fieldset, which disables what it holds. */
function disabledControl(node: FocusNode, tag: string): boolean {
  if (!DISABLEABLE_TAGS.has(tag)) return false;
  for (let at: FocusNode | null = node; at; at = at.parentNode) {
    const own = at === node || at.tagName.toLowerCase() === "fieldset";
    if (own && at.hasAttribute("disabled")) return true;
  }
  return false;
}

/** Whether the node and every ancestor is rendered and not inert. */
function rendered(node: FocusNode): boolean {
  for (let at: FocusNode | null = node; at; at = at.parentNode) {
    if (at.hasAttribute("hidden") || at.hasAttribute("inert") || at.displayNone) return false;
  }
  return true;
}

/**
 * Whether `focus()` on `node` would move focus there: it has to be focusable at all, and rendered,
 * enabled and not inert. The browser says nothing when it refuses, so neither does a double.
 */
export function canTakeFocus(node: FocusNode, connected: boolean): boolean {
  const tag = node.tagName.toLowerCase();
  return connected && focusableAtAll(node, tag) && !disabledControl(node, tag) && rendered(node);
}

/** An attribute name `setAttribute` accepts; the browser throws on any other. */
export function assertAttributeName(name: string): void {
  if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) {
    throw new DOMException(`"${name}" is not a valid attribute name.`, "InvalidCharacterError");
  }
}

/** Written as a code point and a space: controls, and a digit where an identifier starts. */
function escapedAsCode(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  const digit = code >= 0x30 && code <= 0x39;
  const leading = index === 0 || (index === 1 && value.charAt(0) === "-");
  return (code >= 0x1 && code <= 0x1f) || code === 0x7f || (digit && leading);
}

/** One code unit of `CSS.escape`, which escapes by position as well as by character. */
function escapedAt(value: string, index: number): string {
  const char = value.charAt(index);
  if (char === "\0") return "\uFFFD";
  if (escapedAsCode(value, index)) return `\\${value.charCodeAt(index).toString(16)} `;
  if (value === "-") return `\\${char}`;
  return /[\w\u0080-\uFFFF-]/.test(char) ? char : `\\${char}`;
}

/** `CSS.escape`, as the CSSOM specifies it. */
export function cssEscape(value: string): string {
  return value
    .split("")
    .map((_, index) => escapedAt(value, index))
    .join("");
}
