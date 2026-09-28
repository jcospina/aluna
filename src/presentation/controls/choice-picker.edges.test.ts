// The drawn picker at its edges, run through the real `public/choice-picker.js` on the markup the
// renderer writes: labels with space around them, keys held with a modifier, the typing clock, a
// field missing a part, and what closes a panel. Placement lives in `choice-picker.placing.test.ts`.

import { describe, expect, test } from "bun:test";

import { RECORD_CREATED_EVENT } from "#shell/shell-dom.js";
import {
  activeOf,
  form,
  idOf,
  installDomGlobals,
  labelOf,
  longList,
  openPicker,
  scene,
} from "./choice-picker.fixture.test-support.ts";
import { El, parseHtml } from "./choice-picker.test-support.ts";

installDomGlobals();

/** `run` with `Date.now` reading `clock`, put back exactly as it was afterwards. */
async function atTimes(run: (at: (ms: number) => void) => Promise<void> | void) {
  const standing = Reflect.getOwnPropertyDescriptor(Date, "now") as PropertyDescriptor;
  let clock = 1_000_000;
  Object.defineProperty(Date, "now", { value: () => clock, configurable: true, writable: true });
  try {
    await run((ms) => {
      clock += ms;
    });
  } finally {
    Object.defineProperty(Date, "now", standing);
  }
}

const values = (...labels: string[]) =>
  labels.map((label, index) => ({ value: `v${index + 1}`, label }));

describe("what an option is called", () => {
  test("space around a label is not part of it, noted or not", async () => {
    const picker = await openPicker();
    const spaced = await scene(
      form("picker", undefined, {
        values: [
          { value: "a", label: "  Apple  " },
          { value: "p", label: "  Paid  ", note: "settled" },
        ],
      }),
    );
    spaced.press(spaced.button as El);
    spaced.key("p", spaced.button as El);
    expect(activeOf(spaced.button as El)).toBe(spaced.options()[1]?.id);
    spaced.key("Enter", spaced.button as El);
    expect(spaced.valueEl?.textContent).toBe("Paid");
    spaced.press(spaced.button as El);
    spaced.press(spaced.options()[0] as El);
    expect(spaced.valueEl?.textContent).toBe("Apple");
    expect(picker.valueEl).not.toBeNull();
  });
});

describe("typing, and the keys that are not typing", () => {
  test("a key held with Cmd, Ctrl or Alt is a shortcut, never a jump", async () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"]) {
      const picker = await openPicker();
      const before = activeOf(picker.button);
      picker.doc.fire("keydown", picker.button, { key: "f", [modifier]: true });
      expect(activeOf(picker.button)).toBe(before);
    }
    // A named key is not a letter, even one that spells the start of an option.
    const named = await scene(form("picker", undefined, { values: values("Apple", "Delete me") }));
    named.press(named.button as El);
    const first = activeOf(named.button as El);
    named.key("Delete", named.button as El);
    expect(activeOf(named.button as El)).toBe(first);
  });

  test("Home and End reach an end even when it is the only option that can be chosen", async () => {
    const lone = (choosable: number) =>
      values("One", "Two", "Three").map((one, index) =>
        index === choosable ? one : { ...one, disabled: true as const },
      );
    const last = await scene(form("picker", undefined, { values: lone(2) }));
    last.press(last.button as El);
    expect(activeOf(last.button as El)).toBe(last.options()[2]?.id);
    const first = await scene(form("picker", undefined, { values: lone(0) }));
    first.key("End", first.button as El);
    expect(activeOf(first.button as El)).toBe(first.options()[0]?.id);
  });

  test("walking on takes the mark off the row it left", async () => {
    const picker = await openPicker();
    const left = picker.options().find((o) => o.id === activeOf(picker.button)) as El;
    picker.key("ArrowDown", picker.button);
    expect(left.classList.contains("is-active")).toBe(false);
  });

  test("a pause of more than the typing window starts a new word; exactly the window does not", async () => {
    await atTimes(async (after) => {
      const picker = await openPicker();
      picker.key("f", picker.button);
      after(701);
      picker.key("s", picker.button);
      expect(activeOf(picker.button)).toBe(idOf(picker, "second"));

      const again = await openPicker();
      again.key("f", again.button);
      expect(activeOf(again.button)).toBe(idOf(again, "fourth"));
      after(700);
      again.key("i", again.button);
      expect(activeOf(again.button)).toBe(idOf(again, "first"));
    });
  });

  test("a growing word searches from the top, even past the row the first letter reached", async () => {
    await atTimes(async () => {
      const picker = await scene(
        form("picker", undefined, { values: values("Apple", "Avocado", "Apricot") }),
      );
      const button = picker.button as El;
      picker.press(button);
      picker.key("a", button);
      expect(activeOf(button)).toBe(picker.options()[1]?.id);
      picker.key("p", button);
      expect(activeOf(button)).toBe(picker.options()[0]?.id);
    });
  });

  test("the keys that open, and the keys that walk, keep their browser meaning to themselves", async () => {
    const picker = await scene(form("picker"));
    const button = picker.button as El;
    expect(picker.key("Enter", button).prevented).toBe(true);
    expect(picker.key("ArrowDown", button).prevented).toBe(true);
    expect(picker.key("End", button).prevented).toBe(true);
  });
});

describe("a field missing a part refuses to become a picker, and says which", () => {
  for (const [part, said] of [
    [".listbox__button", /listbox__button/],
    [".listbox__panel", /listbox__panel/],
    [".listbox__value", /listbox__value/],
    [".listbox__scroll", /listbox__scroll/],
  ] as const) {
    test(`without its ${part}`, async () => {
      const { mountChoicePickers } = await import("#shell/choice-picker.js");
      const held = parseHtml(form("picker"), new El("div"));
      const field = held.querySelector("[data-choice-presentation]") as El;
      const missing = field.querySelector(part) as El;
      missing.replaceWith(new El("span"));
      expect(() => mountChoicePickers(held as never)).toThrow(said);
    });
  }
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
    picker.key("End", picker.button);
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
    picker.key("Home", picker.button);
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
    picker.key("Home", picker.button);
    picker.key("ArrowDown", picker.button);
    expect(picker.scroll.scrollLeft).toBe(10);
    picker.scroll.scrollLeft = 0;
    picker.hidden.box = { ...picker.hidden.box, top: 136, bottom: 172, left: 150, right: 260 };
    picker.key("End", picker.button);
    expect(picker.scroll.scrollLeft).toBe(50);
  });

  test("a row already inside, sideways, moves nothing sideways", async () => {
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.scroll.scrollLeft = 30;
    picker.hidden.box = { ...picker.hidden.box, left: 20, right: 120 };
    picker.key("End", picker.button);
    expect(picker.scroll.scrollLeft).toBe(30);
  });
});

describe("what closes an open panel, and where focus is left", () => {
  test("the window resizing closes it without taking focus", async () => {
    const picker = await openPicker();
    const elsewhere = parseHtml("<button>elsewhere</button>", picker.doc).querySelector(
      "button:not([aria-haspopup])",
    ) as El;
    elsewhere.focus();
    picker.doc.fire("resize", picker.doc);
    expect([picker.panel?.hidden, picker.doc.activeElement]).toEqual([true, elsewhere]);
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
    const theirs = other.querySelector(".listbox__button") as El;
    picker.press(theirs);
    picker.press(other.querySelectorAll('[role="option"]')[0] as El);
    const kept = (other.querySelector(".listbox__value") as El).textContent;
    picker.doc.fire(RECORD_CREATED_EVENT, picker.form);
    expect((other.querySelector(".listbox__value") as El).textContent).toBe(kept);
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
