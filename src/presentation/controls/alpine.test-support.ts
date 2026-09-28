// The inline Alpine a server renderer writes, run over the choice-picker double rather than read.
//
// Only what the platform's markup uses: `x-data`, `@event` (with `.window`), `x-ref`, `x-show`,
// `:attr`, and the magics `$el`, `$refs`, `$event`, `$nextTick` and `$dispatch`. An expression is
// evaluated the way Alpine evaluates one, against the component's state with the page's globals
// behind it, so a renamed ref or a mistyped property fails here the way it would in a browser.
// As in Alpine, what a handler changes reaches the page a microtask later: `x-show` writes its
// `display: none` then, and `$nextTick` runs after it. Any modifier but `.window` throws.

import type { Doc, El } from "./choice-picker.test-support.ts";

const states = new WeakMap<El, Record<string, unknown>>();

/** The documents with a render queued, so a burst of handlers flushes once. */
const queued = new WeakSet<Doc>();

/** Write every `x-show` under `doc` as Alpine does: `display: none` while it evaluates false. */
function render(doc: Doc): void {
  queued.delete(doc);
  for (const node of doc.querySelectorAll("[x-show]")) {
    const show = Boolean(run(node, node.getAttribute("x-show") as string, undefined, true));
    node.style.display = show ? "" : "none";
  }
}

/** Queue the render the way Alpine's reactivity does: once, on a microtask. */
function scheduleRender(doc: Doc): void {
  if (queued.has(doc)) return;
  queued.add(doc);
  queueMicrotask(() => {
    if (queued.has(doc)) render(doc);
  });
}

function componentOf(el: El): { root: El; state: Record<string, unknown> } {
  const root = el.closest("[x-data]");
  if (root === null) throw new Error(`no x-data around <${el.tag}>`);
  let state = states.get(root);
  if (state === undefined) {
    state = Function(`return (${root.getAttribute("x-data")});`)() as Record<string, unknown>;
    states.set(root, state);
  }
  return { root, state };
}

function refsOf(root: El): Record<string, El> {
  const refs: Record<string, El> = {};
  for (const node of root.querySelectorAll("[x-ref]")) {
    if (node.parent?.closest("[x-data]") === root || node === root) {
      refs[node.getAttribute("x-ref") as string] = node;
    }
  }
  return refs;
}

/** Run `expression` on `el`, as a statement or for its value. */
function run(el: El, expression: string, event: unknown, value: boolean): unknown {
  const { root, state } = componentOf(el);
  const doc = el.ownerDoc as Doc;
  const magics: Record<string, unknown> = {
    $el: el,
    $refs: refsOf(root),
    $event: event,
    $nextTick: (then: () => void) =>
      queueMicrotask(() => {
        if (queued.has(doc)) render(doc);
        then();
      }),
    $dispatch: (type: string, detail?: unknown) => doc.fire(type, el, { detail }),
  };
  const scope = new Proxy(state, {
    has: (target, key) => key in magics || key in target,
    get: (target, key: string) => (key in magics ? magics[key] : target[key]),
    set: (target, key: string, next) => {
      target[key] = next;
      scheduleRender(doc);
      return true;
    },
  });
  const body = value ? `return (${expression});` : expression;
  return Function("scope", `with (scope) { ${body} }`)(scope);
}

/** The one modifier the platform's markup writes; any other would be a behaviour unmodelled. */
const MODELLED_MODIFIERS = new Set(["window"]);

/** Bind one `@event` attribute, refusing any modifier or name the double does not model. */
function bindHandler(doc: Doc, node: El, name: string, expression: string): void {
  const [type = "", ...modifiers] = name.replace(/^(?:@|x-on:)/, "").split(".");
  const unmodelled = modifiers.find((modifier) => !MODELLED_MODIFIERS.has(modifier));
  if (unmodelled !== undefined || !/^[a-z][a-z:-]*$/.test(type)) {
    throw new Error(`the Alpine double does not model ${name}`);
  }
  const on = modifiers.includes("window") ? doc : node;
  on.addEventListener(type, (event) => run(node, expression, event, false));
}

/**
 * Bind every `@event` handler under `doc`, the way Alpine does when it starts, and draw every
 * `x-show` once. A `.window` listener is bound on the document, the last node before the window.
 */
export function startAlpine(doc: Doc): void {
  for (const node of doc.querySelectorAll("[x-data]")) componentOf(node);
  for (const node of [doc, ...doc.descendants()]) {
    for (const [name, expression] of Object.entries(node.attributes)) {
      if (/^(?:@|x-on:)/.test(name)) bindHandler(doc, node, name, expression);
    }
  }
  render(doc);
}

/** Whether Alpine is showing `el`: every `x-show` from it up to the page holds. */
export function shown(el: El): boolean {
  for (let node: El | null = el; node; node = node.parent) {
    const show = node.getAttribute("x-show");
    if (show !== null && !run(node, show, undefined, true)) return false;
  }
  return true;
}

/** What Alpine binds `:attribute` to on `el` right now. */
export function bound(el: El, attribute: string): unknown {
  const expression = el.getAttribute(`:${attribute}`);
  if (expression === null) throw new Error(`<${el.tag}> binds no :${attribute}`);
  return run(el, expression, undefined, true);
}
