// The drawn choice controls, run against the markup the renderer actually emits.
//
// The picker gives up a native `<select>`, so everything a `<select>` did for free has to
// be proved here: the keys that open it, the walk that skips what cannot be chosen, the
// typeahead that reads a label and not the note beside it, the commit that only Enter
// makes, and the focus that never leaves the button. The segmented row's whole behavior
// is one exclusive press, and the radio group's is the browser's.
//
// How the controls get mounted, where the panel hangs and what puts a finished form back
// live next door, in `choice-picker.mounting.test.ts`.

import { describe, expect, test } from "bun:test";
import {
  activeOf,
  form,
  idOf,
  installDomGlobals,
  labelOf,
  longList,
  OPTIONS,
  openPicker,
} from "./choice-picker.fixture.test-support.ts";
import { type El, scene } from "./choice-picker.test-support.ts";
import { codeOf, readSource } from "./source.test-support.ts";

installDomGlobals();

/* ── the seam ──────────────────────────────────────────────────────────────── */

describe("the shipped page runs the module against what the server writes", () => {
  const MODULE = codeOf("public/choice-picker.js");

  test("the shell loads it and it starts itself", () => {
    expect(readSource("public/index.html")).toContain(
      '<script type="module" src="/static/choice-picker.js"></script>',
    );
    expect(MODULE).toContain('if (typeof document !== "undefined") startChoiceControls(document);');
  });

  test("every hook the module queries by is one the renderer emits", () => {
    const picker = form("picker");
    const segmented = form("segmented", undefined, {
      values: OPTIONS.map(({ note, ...rest }) => rest),
    });
    for (const hook of [
      ".listbox__button",
      ".listbox__panel",
      ".listbox__value",
      ".listbox__note",
    ]) {
      expect(MODULE).toContain(hook);
      expect(picker).toContain(hook.slice(1));
    }
    expect(picker).toContain("data-choice-value");
    expect(segmented).toContain('data-choice-presentation="segmented"');
    expect(MODULE).toContain('[data-choice-presentation="segmented"] button[data-value]');
  });

  test("a form opening onto a choice field has something to put focus on", () => {
    // Neither drawn control is a form element — a picker's closed control is a `button`
    // and a segmented row is a set of them — so a capability whose fields are all of that
    // kind matched neither focus selector and opened onto no focus at all.
    const asked = [
      readSource("public/record-view.js"),
      readSource("src/presentation/list-container.ts"),
    ];
    for (const source of asked) {
      expect(source).toContain(".listbox__button");
      expect(source).toContain(".segmented button:not([disabled])");
    }
    expect(form("picker")).toContain(
      'class="field__control field__control--select listbox__button"',
    );
    expect(
      form("segmented", undefined, { values: OPTIONS.map(({ note, ...rest }) => rest) }),
    ).toContain('<div class="segmented"');
  });
});

/* ── opening and closing ───────────────────────────────────────────────────── */

describe("the six keys that open, and the ways out", () => {
  test("Enter, Space, both arrows and Home all open onto the first enabled option", async () => {
    for (const key of ["Enter", " ", "ArrowDown", "ArrowUp", "Home"]) {
      const picker = await scene(form("picker"));
      const button = picker.button as El;
      expect(picker.panel?.hidden).toBe(true);

      picker.key(key, button);

      expect(picker.panel?.hidden).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(activeOf(button)).toBe(idOf(picker, "first"));
    }
  });

  test("End opens onto the last option instead — the one asymmetry in the pattern", async () => {
    const picker = await scene(form("picker"));
    const button = picker.button as El;
    picker.key("End", button);
    expect(activeOf(button)).toBe(idOf(picker, "fourth"));
  });

  test("a key that is not one of the six leaves it closed", async () => {
    const picker = await scene(form("picker"));
    picker.key("a", picker.button as El);
    expect(picker.panel?.hidden).toBe(true);
  });

  test("opening onto a stored value starts the keyboard there, not at the top", async () => {
    const picker = await openPicker("fourth");
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
  });

  test("Escape closes, drops the active row, and puts focus back on the button", async () => {
    const picker = await openPicker();
    picker.key("Escape", picker.button);

    expect(picker.panel?.hidden).toBe(true);
    expect(picker.button.getAttribute("aria-expanded")).toBe("false");
    expect(picker.button.hasAttribute("aria-activedescendant")).toBe(false);
    expect(picker.doc.activeElement).toBe(picker.button);
  });

  test("Tab closes without taking the focus back, so it still moves on", async () => {
    const picker = await openPicker();
    picker.doc.activeElement = null;
    picker.key("Tab", picker.button);

    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(null);
  });

  test("a press outside closes it, and a press inside does not", async () => {
    const picker = await openPicker();
    picker.doc.fire("pointerdown", picker.panel as El);
    expect(picker.panel?.hidden).toBe(false);

    picker.doc.fire("pointerdown", picker.form);
    expect(picker.panel?.hidden).toBe(true);
    // Closed by a press elsewhere, so the focus stays where the press landed.
    expect(picker.doc.activeElement).toBe(null);
  });

  test("the button toggles it, and focus never moves into the panel", async () => {
    const picker = await scene(form("picker"));
    picker.press(picker.button as El);
    expect(picker.panel?.hidden).toBe(false);
    picker.press(picker.button as El);
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(picker.button);
  });
});

/* ── walking the list ──────────────────────────────────────────────────────── */

describe("the walk moves the active option and never the chosen one", () => {
  test("the arrows step, wrap, and skip what cannot be chosen", async () => {
    const picker = await openPicker();
    const walk = (key: string) => {
      picker.key(key, picker.button);
      return activeOf(picker.button);
    };

    expect(walk("ArrowDown")).toBe(idOf(picker, "second"));
    // "third" is disabled, so the next step lands past it.
    expect(walk("ArrowDown")).toBe(idOf(picker, "fourth"));
    expect(walk("ArrowDown")).toBe(idOf(picker, "first"));
    expect(walk("ArrowUp")).toBe(idOf(picker, "fourth"));
    expect(walk("ArrowUp")).toBe(idOf(picker, "second"));
  });

  test("Home and End go to the ends, skipping a disabled one there too", async () => {
    const picker = await openPicker();
    picker.key("End", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
    picker.key("Home", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "first"));
  });

  test("walking past an option never commits it", async () => {
    const picker = await openPicker();
    picker.key("ArrowDown", picker.button);
    picker.key("ArrowDown", picker.button);

    expect(picker.carrier?.value).toBe("");
    expect(picker.options().every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);
  });

  test("hovering a row makes it active, so the mouse and the keyboard agree", async () => {
    const picker = await openPicker();
    const fourth = picker.options().find((o) => labelOf(o) === "fourth") as El;
    picker.doc.fire("pointerover", fourth);
    expect(activeOf(picker.button)).toBe(fourth.id);
  });

  test("hovering a row scrolls nothing, and the keyboard scrolls only the list", async () => {
    // A hover is already on the row it names, so there is nothing to bring into view; the
    // keyboard is the one that has to be shown where it went. Revealing used to be
    // `scrollIntoView`, which scrolls every ancestor — including the form, whose movement
    // re-placed the panel and put a new row under a pointer that had not moved.
    const picker = await longList();

    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);
    expect(picker.scroll.scrollTop).toBe(0);

    picker.key("End", picker.button);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);
    expect(picker.scroll.scrollTop).toBe(56);
  });

  test("a key that moves nowhere leaves a hand-scrolled list where the hand put it", async () => {
    // The other half of not fighting the user: the row is already active, so re-revealing
    // it would drag the list back from wherever it has since been scrolled to.
    const picker = await longList();
    picker.key("End", picker.button);
    expect(picker.scroll.scrollTop).toBe(56);

    picker.scroll.scrollTop = 0;
    picker.key("End", picker.button);

    expect(activeOf(picker.button)).toBe(picker.hidden.id);
    expect(picker.scroll.scrollTop).toBe(0);
  });

  test("a row the list slid under a still pointer is not a row anyone chose", async () => {
    // `pointerover` fires for a scroll under a resting hand as much as for a hand that
    // moved. Answering the first is how arrowing down a list hands the selection straight
    // back to wherever the cursor happens to be sitting.
    const picker = await longList();
    picker.doc.fire("pointerover", picker.visible);
    picker.key("End", picker.button);

    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);

    // A hand that then moves is a hand choosing again.
    picker.doc.fire("pointermove", picker.panel as El);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);

    // Disarming lasts one opening. This one scrolled the list; the next opens onto a row
    // already in view, moves nothing, and so trusts the pointer from the start.
    picker.key("End", picker.button);
    picker.key("Escape", picker.button);
    const parked = picker.scroll.scrollTop;
    picker.key("Enter", picker.button);
    expect(picker.scroll.scrollTop).toBe(parked);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);
  });

  test("a row is brought inside the scrollport, not inside the scrollbars", async () => {
    // A note long enough to overflow brings out a horizontal scrollbar, and the border box
    // includes it while the scrollport does not. Revealing against the wrong one parks the
    // last row underneath the bar, which is exactly where it cannot be read.
    const picker = await longList();
    // A 200px border box holding a 1px line and 15px of horizontal scrollbar: the
    // scrollport runs 101..285, where the border box runs 100..300.
    picker.scroll.clientTop = 1;
    picker.scroll.clientHeight = 184;
    picker.key("End", picker.button);
    // `hidden` ends at 356, so the list must move by 356 - 285.
    expect(picker.scroll.scrollTop).toBe(71);
  });

  test("a row off the side is brought back too", async () => {
    // `scrollIntoView` moved both axes. Only ever moving one is a real behaviour dropped,
    // not a difference that cannot show.
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.hidden.box = { ...picker.hidden.box, left: 40, right: 340 };
    picker.key("End", picker.button);
    expect(picker.scroll.scrollLeft).toBe(140);
  });

  test("the list scrolling under itself never re-places the panel", async () => {
    // Placement re-caps the list's height, so answering the list's own scroll meant
    // resizing the box the user was scrolling, on every frame of the scroll.
    const picker = await openPicker();
    (picker.panel as El).style.top = "-9999px";
    picker.scrollWithin(picker.field.querySelector(".listbox__scroll") as El);
    expect(picker.panel?.style.top).toBe("-9999px");
  });

  test("hovering a disabled row leaves the active one where it was", async () => {
    const picker = await openPicker();
    const before = activeOf(picker.button);
    picker.doc.fire("pointerover", picker.options().find((o) => labelOf(o) === "third") as El);
    expect(activeOf(picker.button)).toBe(before);
  });
});

/* ── typeahead ─────────────────────────────────────────────────────────────── */

describe("typing jumps to a label, and only to a label", () => {
  test("one letter cycles through everything starting with it", async () => {
    const picker = await openPicker();
    picker.key("f", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
    picker.key("f", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "first"));
  });

  test("a growing string searches from the top for the longer match", async () => {
    const picker = await openPicker();
    picker.key("f", picker.button);
    picker.key("i", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "first"));
  });

  test("a note is not part of what an option is called", async () => {
    const picker = await openPicker();
    // "Second" carries the note "closes the record". Typing `c` must find nothing here
    // rather than land on it, so the active row does not move.
    const before = activeOf(picker.button);
    picker.key("c", picker.button);
    expect(activeOf(picker.button)).toBe(before);
  });

  test("typeahead skips a disabled option", async () => {
    const picker = await openPicker();
    const before = activeOf(picker.button);
    picker.key("t", picker.button);
    expect(activeOf(picker.button)).toBe(before);
  });
});

/* ── committing ────────────────────────────────────────────────────────────── */

describe("only a commit changes what is chosen", () => {
  test("Enter takes the active option, closes, and writes the carrier", async () => {
    const picker = await openPicker();
    picker.key("ArrowDown", picker.button);
    picker.key("Enter", picker.button);

    expect(picker.carrier?.value).toBe("second");
    expect(picker.valueEl?.textContent).toBe("Second");
    expect(picker.valueEl?.getAttribute("class")).not.toContain("is-placeholder");
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(picker.button);
  });

  test("Space commits too, and the change is announced once", async () => {
    const picker = await openPicker();
    picker.key("ArrowDown", picker.button);
    picker.key(" ", picker.button);
    expect(picker.carrier?.value).toBe("second");
    expect(picker.doc.changes).toHaveLength(1);
  });

  test("choosing what was already chosen closes without announcing anything", async () => {
    const picker = await openPicker("fourth");
    picker.key("Enter", picker.button);
    expect(picker.carrier?.value).toBe("fourth");
    expect(picker.doc.changes).toHaveLength(0);
  });

  test("a press on a row commits it and closes", async () => {
    const picker = await openPicker();
    picker.press(picker.options().find((o) => labelOf(o) === "fourth") as El);
    expect(picker.carrier?.value).toBe("fourth");
    expect(picker.panel?.hidden).toBe(true);
  });

  test("a press on a disabled row chooses nothing", async () => {
    const picker = await openPicker();
    picker.press(picker.options().find((o) => labelOf(o) === "third") as El);
    expect(picker.carrier?.value).toBe("");
  });

  test("the option a record already holds is choosable, disabled or not", async () => {
    // "third" is disabled, but this record stores it, so the renderer never marked it so.
    const picker = await openPicker("third");
    expect(
      picker
        .options()
        .find((o) => labelOf(o) === "third")
        ?.hasAttribute("aria-disabled"),
    ).toBe(false);
    expect(picker.carrier?.value).toBe("third");
  });
});

/* ── the segmented row ─────────────────────────────────────────────────────── */

describe("the segmented row is one exclusive press", () => {
  const flat = { values: OPTIONS.map(({ note, ...rest }) => rest) };

  test("pressing a segment presses it and unpresses the rest, and writes the carrier", async () => {
    const row = await scene(form("segmented", undefined, flat));
    const segments = row.field.querySelectorAll("button[data-value]");
    row.press(segments[3] as El);

    expect(segments.map((s) => s.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(row.field.querySelector("[data-choice-value]")?.value).toBe("fourth");
    expect(row.doc.changes).toHaveLength(1);
  });

  test("a disabled segment does nothing at all", async () => {
    const row = await scene(form("segmented", undefined, flat));
    row.press(row.field.querySelectorAll("button[data-value]")[2] as El);
    expect(row.field.querySelector("[data-choice-value]")?.value).toBe("");
  });
});
