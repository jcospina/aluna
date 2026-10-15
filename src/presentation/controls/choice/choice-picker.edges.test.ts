// The drawn picker at its edges, run through the real `public/controls/choice-picker.js` on the markup the
// renderer writes: labels with space around them, keys held with a modifier, a field missing a part,
// and what closes a panel. Placement lives in `choice-picker.placing.test.ts`; the jump to a typed
// letter, which only the Link control's chooser keeps, in `link/link-chooser.keyboard.test.ts`.

import { describe, expect, test } from "bun:test";

import { RECORD_CREATED_EVENT } from "#shell/core/shell-dom.js";
import { startFieldErrors } from "#shell/fields/field-errors.js";
import {
  activeOf,
  form,
  installDomGlobals,
  labelOf,
  longList,
  openPicker,
  scene,
} from "../double/choice-picker.fixture.test-support.ts";
import { El, parseHtml } from "../double/choice-picker.test-support.ts";

installDomGlobals();

const values = (...labels: string[]) =>
  labels.map((label, index) => ({ value: `v${index + 1}`, label }));

/** What a person typing into a field leaves behind: its new text, and the `input` it hears. */
function type(picker: { doc: { fire: (type: string, on: El) => unknown } }, on: El, text: string) {
  on.value = text;
  picker.doc.fire("input", on);
}

describe("what an option is called", () => {
  test("space around a label is not part of it, noted or not", async () => {
    const spaced = await scene(
      form("picker", undefined, {
        values: [
          { value: "a", label: "  Apple  " },
          { value: "p", label: "  Paid  ", note: "settled" },
        ],
      }),
    );
    const input = spaced.button as El;
    spaced.press(input);
    type(spaced, input, "pai");
    expect(activeOf(input)).toBe(spaced.options()[1]?.id);
    spaced.key("Enter", input);
    expect(input.value).toBe("Paid");
    spaced.press(input);
    spaced.press(spaced.options()[0] as El);
    expect(input.value).toBe("Apple");
  });
});

describe("typing, and the keys that are not typing", () => {
  test("a key held with Cmd or Ctrl is a shortcut the field keeps, never a step or a pick", async () => {
    for (const modifier of ["metaKey", "ctrlKey"]) {
      const picker = await openPicker();
      const before = activeOf(picker.button);
      for (const key of ["ArrowDown", "Enter"]) {
        const { prevented } = picker.doc.fire("keydown", picker.button, { key, [modifier]: true });
        expect(prevented).toBe(false);
      }
      expect(activeOf(picker.button)).toBe(before);
      expect(picker.carrier?.value).toBe("");
    }
  });

  test("a list where one option can be chosen opens onto it, wherever it stands", async () => {
    const lone = (choosable: number) =>
      values("One", "Two", "Three").map((one, index) =>
        index === choosable ? one : { ...one, disabled: true as const },
      );
    const last = await scene(form("picker", undefined, { values: lone(2) }));
    last.press(last.button as El);
    expect(activeOf(last.button as El)).toBe(last.options()[2]?.id);
    const first = await scene(form("picker", undefined, { values: lone(0) }));
    first.key("ArrowUp", first.button as El);
    expect(activeOf(first.button as El)).toBe(first.options()[0]?.id);
  });

  test("walking on takes the mark off the row it left", async () => {
    const picker = await openPicker();
    const left = picker.options().find((o) => o.id === activeOf(picker.button)) as El;
    picker.key("ArrowDown", picker.button);
    expect(left.classList.contains("is-active")).toBe(false);
  });

  test("the keys that open and walk keep their browser meaning to themselves, and typing does not", async () => {
    const picker = await scene(form("picker"));
    const input = picker.button as El;
    expect(picker.key("Enter", input).prevented).toBe(true);
    expect(picker.key("ArrowDown", input).prevented).toBe(true);
    expect(picker.key("End", input).prevented).toBe(false);
    expect(picker.key("a", input).prevented).toBe(false);
  });
});

describe("a field missing a part refuses to become a picker, and says which", () => {
  for (const [part, said] of [
    ['[role="combobox"]', /input it searches/],
    [".listbox__panel", /listbox__panel/],
    [".listbox__scroll", /listbox__scroll/],
  ] as const) {
    test(`without its ${part}`, async () => {
      const { mountChoicePickers } = await import("#shell/controls/choice-picker.js");
      const held = parseHtml(form("picker"), new El("div"));
      const field = held.querySelector("[data-choice-presentation]") as El;
      const missing = field.querySelector(part) as El;
      missing.replaceWith(new El("span"));
      expect(() => mountChoicePickers(held as never)).toThrow(said);
    });
  }

  test("drawn as a button, without the .listbox__value that names its choice", async () => {
    const { mountChoicePickers } = await import("#shell/controls/choice-picker.js");
    const held = parseHtml(form("picker"), new El("div"));
    const input = held.querySelector('[role="combobox"]') as El;
    input.replaceWith(
      parseHtml('<button class="listbox__button"></button>', new El("div")).children[0] as El,
    );
    expect(() => mountChoicePickers(held as never)).toThrow(/listbox__value/);
  });
});

describe("the open panel's own marks", () => {
  test("open is marked on the field and on the active row, and closing takes both off", async () => {
    const picker = await openPicker();
    const active = picker.options().find((o) => o.id === activeOf(picker.button)) as El;
    expect([
      picker.field.classList.contains("is-open"),
      active.classList.contains("is-active"),
    ]).toEqual([true, true]);
    picker.key("Escape", picker.button);
    expect([
      picker.field.classList.contains("is-open"),
      active.classList.contains("is-active"),
    ]).toEqual([false, false]);
  });

  test("a list with nothing choosable opens with no active row, and closes cleanly", async () => {
    const picker = await scene(
      form("picker", undefined, {
        values: values("One", "Two").map((one) => ({ ...one, disabled: true as const })),
      }),
    );
    picker.press(picker.button as El);
    expect(activeOf(picker.button as El)).toBeNull();
    expect(() => picker.key("Escape", picker.button as El)).not.toThrow();
  });

  test("a press on the panel between rows chooses nothing and closes nothing", async () => {
    const picker = await openPicker();
    picker.press(picker.field.querySelector(".listbox__scroll") as El);
    expect(picker.panel?.hidden).toBe(false);
  });
});

describe("the list moving under a still pointer", () => {
  test("a hover brings nothing into view, even a row the list has half hidden", async () => {
    const picker = await longList();
    picker.hidden.box = { ...picker.hidden.box, top: 280, bottom: 316 };
    picker.doc.fire("pointerover", picker.hidden);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);
    expect(picker.scroll.scrollTop).toBe(0);
  });

  test("the list's own scroll disarms the pointer until it moves", async () => {
    const picker = await longList();
    picker.doc.fire("scroll", picker.scroll);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).not.toBe(picker.visible.id);
  });

  test("a keyboard move that scrolls the list sideways only disarms the pointer too", async () => {
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.hidden.box = { ...picker.hidden.box, top: 136, bottom: 172, left: 40, right: 340 };
    picker.key("ArrowUp", picker.button);
    expect(picker.scroll.scrollLeft).toBeGreaterThan(0);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);
  });
});

describe("bringing a row into the list", () => {
  test("a row above the scrollport comes down by exactly its overhang", async () => {
    const picker = await longList();
    picker.scroll.scrollTop = 100;
    picker.visible.box = { ...picker.visible.box, top: 80, bottom: 116 };
    picker.key("ArrowDown", picker.button);
    expect(picker.scroll.scrollTop).toBe(80);
  });

  test("sideways both ways, measured from the scrollport's own left edge", async () => {
    // The scrollport starts 10px in, past a left border: 10..210 across a 200px list.
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.scroll.clientLeft = 10;
    picker.scroll.scrollLeft = 50;
    picker.visible.box = { ...picker.visible.box, left: -30, right: 10 };
    picker.key("ArrowDown", picker.button);
    expect(picker.scroll.scrollLeft).toBe(10);
    picker.scroll.scrollLeft = 0;
    picker.hidden.box = { ...picker.hidden.box, top: 136, bottom: 172, left: 150, right: 260 };
    picker.key("ArrowDown", picker.button);
    expect(picker.scroll.scrollLeft).toBe(50);
  });

  test("a row already inside, sideways, moves nothing sideways", async () => {
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.scroll.scrollLeft = 30;
    picker.hidden.box = { ...picker.hidden.box, left: 20, right: 120 };
    picker.key("ArrowUp", picker.button);
    expect(picker.scroll.scrollLeft).toBe(30);
  });
});

describe("what closes an open panel, and where focus is left", () => {
  test("the window resizing measures a search again rather than closing it and dropping the typing", async () => {
    // A phone's keyboard rising under the field resizes the page the moment the field is pressed.
    const picker = await openPicker();
    picker.button.focus();
    type(picker, picker.button, "fo");
    (picker.panel as El).style.top = "-9999px";
    picker.doc.fire("resize", picker.doc);
    expect(picker.panel?.hidden).toBe(false);
    expect(picker.panel?.style.top).not.toBe("-9999px");
    expect([picker.button.value, picker.doc.activeElement]).toEqual(["fo", picker.button]);
  });

  test("a field taken off the page closes its panel on the next scroll", async () => {
    const picker = await openPicker();
    picker.field.remove();
    picker.doc.fire("scroll", picker.doc);
    expect(picker.button.getAttribute("aria-expanded")).toBe("false");
  });

  test("a finished form closes its open panel without taking focus", async () => {
    const picker = await openPicker();
    const elsewhere = parseHtml("<button>elsewhere</button>", picker.doc).querySelector(
      "button:not([aria-haspopup])",
    ) as El;
    elsewhere.focus();
    picker.doc.fire(RECORD_CREATED_EVENT, picker.form);
    expect([picker.panel?.hidden, picker.doc.activeElement]).toEqual([true, elsewhere]);
  });
});

describe("putting a finished form back", () => {
  test("only the form that finished is put back; another form's choice stands", async () => {
    const picker = await scene(form("picker"));
    const other = parseHtml(form("picker"), new El("div")).querySelector("form") as El;
    picker.doc.append(other);
    await picker.doc.arrivals();
    const theirs = other.querySelector('[role="combobox"]') as El;
    picker.press(theirs);
    picker.press(other.querySelectorAll('[role="option"]')[0] as El);
    const kept = theirs.value;
    picker.doc.fire(RECORD_CREATED_EVENT, picker.form);
    expect(theirs.value).toBe(kept);
    expect(kept).not.toBe("");
  });

  test("a picker still on the page after other arrivals is still put back", async () => {
    const picker = await openPicker();
    picker.press(picker.options().find((o) => labelOf(o) === "fourth") as El);
    picker.doc.append(new El("div"));
    await picker.doc.arrivals();
    picker.doc.fire(RECORD_CREATED_EVENT, picker.form);
    expect(picker.carrier?.value).toBe("");
  });

  test("an edit form's segmented row goes back to the record's own value", async () => {
    const row = await scene(form("segmented", "v2", { values: values("First", "Second") }));
    const segments = row.field.querySelectorAll("button[data-value]");
    row.press(segments[0] as El);
    row.doc.fire(RECORD_CREATED_EVENT, row.form);
    expect(row.carrier?.value).toBe("v2");
    expect(segments.map((s) => s.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  test("pressing the segment already pressed announces nothing", async () => {
    const row = await scene(form("segmented", undefined, { values: values("First", "Second") }));
    const [first] = row.field.querySelectorAll("button[data-value]") as [El];
    row.press(first);
    row.press(first);
    expect(row.doc.changes).toEqual([{ value: "v1" }]);
  });
});

describe("searching, at its edges", () => {
  test("a required picker's error stands while a search finds nothing, and a pick clears it", async () => {
    const one = await scene(form("picker", undefined, { required: true }));
    startFieldErrors(one.doc as never);
    expect(one.doc.fire("submit", one.form).prevented).toBe(true);
    expect(one.field.classList.contains("is-invalid")).toBe(true);
    const input = one.button as El;
    type(one, input, "zzz");
    one.key("Escape", input);
    expect(one.field.classList.contains("is-invalid")).toBe(true);
    type(one, input, "fou");
    one.key("Enter", input);
    expect(one.field.classList.contains("is-invalid")).toBe(false);
  });

  test("the Enter that ends an input method's composition picks nothing", async () => {
    const one = await scene(form("picker"));
    const input = one.button as El;
    type(one, input, "fou");
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(one.doc.fire("keydown", input, { key: "Enter", ...extra }).prevented).toBe(false);
    }
    expect(one.carrier?.value).toBe("");
  });

  test("a field outside the box that paints it does not open, and leaves no active row behind", async () => {
    const one = await scene(form("picker", "first"));
    const input = one.button as El;
    (one.shell as El).box = { top: 950, bottom: 980, left: 10, right: 210, width: 200, height: 30 };
    type(one, input, "fou");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(input.value).toBe("First");
  });

  test("an optional picker emptied and left chooses nothing; Escape puts the choice back", async () => {
    const one = await scene(form("picker", "second"));
    const input = one.button as El;
    type(one, input, "");
    one.key("Tab", input);
    expect(one.carrier?.value).toBe("");
    expect(input.value).toBe("");
    expect(one.options().every((option) => option.getAttribute("aria-selected") === "false")).toBe(
      true,
    );
    expect(one.doc.changes).toEqual([{ value: "" }]);

    const kept = await scene(form("picker", "second"));
    const field = kept.button as El;
    type(kept, field, "");
    kept.key("Escape", field);
    expect(kept.carrier?.value).toBe("second");
  });

  test("a required picker emptied and left keeps its choice", async () => {
    const one = await scene(form("picker", "second", { required: true }));
    const input = one.button as El;
    type(one, input, "");
    one.doc.fire("pointerdown", one.form);
    expect(one.carrier?.value).toBe("second");
    expect(input.value).toBe("Second");
  });
});
