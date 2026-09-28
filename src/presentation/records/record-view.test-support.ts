// A window holding one capability's collection, with the real `public/record-view.js` (and, when
// asked, `public/record-mutations.js`) started on it. Each starts itself on the `document` it sees,
// so each desk imports its own instances with the globals they reach for standing, and puts every
// global back when the test is over.

import { WINDOW_CONTENT_REGION } from "#shell/desk-window.js";
import { WINDOW_CONTENT_ID } from "#shell/shell-dom.js";

import { cssEscape } from "../../server/dom-events.test-support.ts";
import { renderCapabilitySurface } from "../../server/http/fragments.ts";
import { Doc, ELEMENT_CLASSES, El, parseHtml } from "../controls/choice-picker.test-support.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";

/** The notes capability every record-view suite opens a record of. */
export const CAPABILITY: RenderableCapability = {
  id: "notes",
  label: "Notes",
  noun: "note",
  schema: {
    fields: [
      { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      { name: "due_on", label: "Due on", type: "date", required: false, lifecycle: "active" },
      {
        name: "retired",
        label: "Retired",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
    ],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

export const RECORD = {
  id: "note-1",
  created_at: "2026-08-27T00:00:00.000Z",
  text: "Buy oat milk",
  due_on: null,
  retired: "server only",
};

export const TEMPLATE_ID = "record-notes-note-1";

/** A constructor only its own tags are an instance of, for the module's `instanceof` guards. */
const onlyTags = (tags: readonly string[]) => ({
  [Symbol.hasInstance]: (value: unknown) => value instanceof El && tags.includes(value.tag),
  prototype: El.prototype,
});

let instances = 0;

/** What the desk's htmx was asked to do while the test ran. */
export interface Asked {
  readonly processed: El[];
  readonly requests: { verb: string; path: string; context: Record<string, unknown> }[];
}

/** How the desk is stood up, when the default — a tasks window with only the swap — is not it. */
export interface DeskOptions {
  /** What a read resolves with, and when: a test can land what it brings back first. */
  readonly answer?: (asked: Asked) => Promise<unknown>;
  readonly modules?: readonly string[];
  readonly capabilityId?: string;
}

/** Stand the window up around `collectionHtml` and start the modules on it. */
export async function recordDesk(
  collectionHtml: string,
  {
    answer = () => Promise.resolve(),
    modules = ["record-view.js"],
    capabilityId = "tasks",
  }: DeskOptions = {},
) {
  const doc = new Doc();
  const surface = renderCapabilitySurface(
    { id: capabilityId, incarnation_id: "incarnation-1", version: 1 },
    collectionHtml,
  );
  parseHtml(
    `<div id="${WINDOW_CONTENT_ID}" data-content-region="${WINDOW_CONTENT_REGION}">${surface}</div>`,
    doc,
  );
  const asked: Asked = { processed: [], requests: [] };
  const globals = globalThis as Record<string, unknown>;
  const stood: Record<string, unknown> = {
    document: doc,
    window: {
      htmx: {
        process: (node: El) => asked.processed.push(node),
        ajax: (verb: string, path: string, context: Record<string, unknown>) => {
          asked.requests.push({ verb, path, context });
          return answer(asked);
        },
        trigger: () => {},
      },
      location: { reload: () => {} },
    },
    Element: El,
    HTMLElement: El,
    HTMLTemplateElement: onlyTags(["template"]),
    DocumentFragment: onlyTags(["#template"]),
    HTMLButtonElement: onlyTags(ELEMENT_CLASSES.HTMLButtonElement),
    HTMLFormElement: onlyTags(ELEMENT_CLASSES.HTMLFormElement),
    HTMLInputElement: onlyTags(ELEMENT_CLASSES.HTMLInputElement),
    CSS: { escape: cssEscape },
  };
  // The shared instances first, with no document standing, so only the fresh ones start.
  for (const module of modules) await import(`../../../public/${module}`);
  const displaced = Object.fromEntries(
    Object.keys(stood).map((name) => [name, Reflect.getOwnPropertyDescriptor(globals, name)]),
  );
  for (const [name, value] of Object.entries(stood)) {
    Object.defineProperty(globals, name, { value, configurable: true, writable: true });
  }
  instances += 1;
  for (const module of modules) await import(`../../../public/${module}?desk=${instances}`);
  return {
    doc,
    asked,
    region: doc.getElementById(WINDOW_CONTENT_ID) as El,
    press: (on: El) => doc.fire("click", on),
    /** Everything the module queued: the focus after a swap, and a read's settling. */
    settled: () => new Promise<void>((done) => setTimeout(done, 0)),
    restore() {
      for (const [name, before] of Object.entries(displaced)) {
        if (before) Object.defineProperty(globals, name, before);
        else Reflect.deleteProperty(globals, name);
      }
    },
  };
}

/** The `window` a desk stood up, which a test may take htmx away from or watch reload. */
export const standingWindow = () =>
  (globalThis as unknown as { window: { htmx?: unknown; location: { reload: () => void } } })
    .window;
