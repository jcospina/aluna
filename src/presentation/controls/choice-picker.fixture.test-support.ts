// The fixtures both picker suites are built from: the globals a DOM double needs to be
// instanceof-checkable, the forms the renderer actually emits, and the two scenes every
// behavior test starts from.
//
// Held apart from the double itself (`choice-picker.test-support.ts`) because they are a
// different kind of thing: that file is a browser small enough to run in Bun, and this one
// is what we put inside it.

import { afterAll, beforeAll } from "bun:test";

import type { ChoicePresentation, SpecField } from "../../registry/index.ts";
import { oneField, probeField } from "../fields/field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { El, scene } from "./choice-picker.test-support.ts";

export const OPTIONS = [
  { value: "first", label: "First" },
  { value: "second", label: "Second", note: "closes the record" },
  { value: "third", label: "Third", disabled: true as const },
  { value: "fourth", label: "Fourth" },
];

export function form(
  presentation: ChoicePresentation,
  stored?: string,
  overrides: Partial<SpecField> = {},
) {
  const probe = oneField(
    probeField("choice", { required: false, values: OPTIONS, groups: [], ...overrides }),
    "repeatable",
    presentation,
  );
  const capability = { ...probe, actions: ["create", "read", "update"] as typeof probe.actions };
  return stored === undefined
    ? renderCreateForm(capability)
    : renderEditForm(capability, { id: "probe-1", value: stored });
}

/**
 * Define one global for the length of a suite, and say whether it had to.
 *
 * @returns the name, when this call is the one that installed it
 */
function define(name: string, value: unknown): string | null {
  if (name in globalThis) return null;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return name;
}

/** A constructor that only its own tags are an instance of. */
function onlyTags(base: typeof El, tags: readonly string[]) {
  return {
    [Symbol.hasInstance]: (value: unknown) =>
      value instanceof base && tags.includes((value as El).tag),
  };
}

/**
 * Stand the DOM constructors the module guards with up as globals, for the length of one
 * suite.
 *
 * `Node`, `Element` and `HTMLElement` really do match every element. The three in
 * `ELEMENT_CLASSES` do not, and binding them all to one class would make every
 * `instanceof` in the module a tautology — the picker's own "a picker needs a
 * .listbox__button" refusal could never fire under test. Each gets a constructor that only
 * its own tags are.
 */
export function installDomGlobals(): void {
  const installed: (string | null)[] = [];
  beforeAll(async () => {
    const { El: Element_, ELEMENT_CLASSES } = await import("./choice-picker.test-support.ts");
    for (const name of ["Node", "Element", "HTMLElement"]) {
      installed.push(define(name, Element_));
    }
    for (const [name, tags] of Object.entries(ELEMENT_CLASSES)) {
      installed.push(define(name, onlyTags(Element_, tags)));
    }
    installed.push(define("window", { innerHeight: 800 }));
    installed.push(
      define(
        "Event",
        class {
          constructor(readonly type: string) {}
        },
      ),
    );
  });
  afterAll(() => {
    for (const name of installed) if (name) Reflect.deleteProperty(globalThis, name);
  });
}

export const labelOf = (option: El | undefined) => option?.getAttribute("data-value");
export const activeOf = (button: El | null) => button?.getAttribute("aria-activedescendant");
export const idOf = (picker: Awaited<ReturnType<typeof scene>>, value: string) =>
  picker.options().find((option) => option.getAttribute("data-value") === value)?.id;

export async function openPicker(stored?: string) {
  const picker = await scene(form("picker", stored));
  const button = picker.button as El;
  picker.key("Enter", button);
  return { ...picker, button };
}

/**
 * An open picker whose list is a real scroller: 200px of scrollport over 400px of rows, so
 * there is somewhere to scroll to and a ceiling it cannot pass. `visible` sits inside the
 * scrollport and `hidden` 56px below its bottom edge, which is how far revealing it moves.
 */
export async function longList() {
  const picker = await openPicker();
  const scroll = picker.field.querySelector(".listbox__scroll") as El;
  scroll.box = { top: 100, bottom: 300, left: 0, right: 200, width: 200, height: 200 };
  scroll.scrollHeight = 400;
  const visible = picker.options().find((o) => labelOf(o) === "second") as El;
  const hidden = picker.options().find((o) => labelOf(o) === "fourth") as El;
  visible.box = { ...visible.box, top: 136, bottom: 172 };
  hidden.box = { ...hidden.box, top: 320, bottom: 356 };
  return { ...picker, scroll, visible, hidden };
}

/**
 * The desk chrome a panel hangs inside: a window dragged by `transform` (so it is the
 * containing block), a body that clips and starts below the title bar, and a static
 * scroller between them that the panel is fixed precisely to escape.
 */
export function deskChrome() {
  const chrome = new El("div");
  chrome.computed = { ...chrome.computed, transform: "matrix(1, 0, 0, 1, 40, 90)" };
  chrome.box = { top: 90, bottom: 552, left: 243, right: 1037, width: 794, height: 462 };
  const body = new El("div");
  body.computed = {
    ...body.computed,
    position: "relative",
    overflowX: "hidden",
    overflowY: "hidden",
  };
  body.box = { top: 136, bottom: 552, left: 243, right: 1037, width: 794, height: 416 };
  const scroller = new El("div");
  scroller.computed = { ...scroller.computed, overflowX: "hidden", overflowY: "auto" };
  scroller.box = { top: 205, bottom: 454, left: 275, right: 994, width: 719, height: 249 };
  chrome.append(body);
  body.append(scroller);
  return { chrome, body, scroller };
}
