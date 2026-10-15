// The drawn choice controls, run against the markup the renderer actually emits.
//
// The picker gives up a native `<select>`, so everything a `<select>` did for free has to
// be proved here: the keys that open it, the walk that skips what cannot be chosen, the
// search that reads a label and not the note beside it, the commit that only Enter or a
// press makes, and the focus that never leaves the field. The segmented row's whole behavior
// is one exclusive press, and the radio group's is the browser's.
//
// How the controls get mounted, where the panel hangs and what puts a finished form back
// live next door, in `choice-picker.mounting.test.ts`.

import { describe, expect, test } from "bun:test";
import { NO_RESULTS } from "#design/controls/listbox-search.js";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { readSource } from "../../safety/source.test-support.ts";
import {
  activeOf,
  form,
  idOf,
  installDomGlobals,
  labelOf,
  longList,
  OPTIONS,
  openPicker,
  scene,
} from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { startedOn } from "../double/started-module.test-support.ts";

installDomGlobals();

/** What a person typing into the field leaves behind: its new text, and the `input` it hears. */
function type(picker: Awaited<ReturnType<typeof openPicker>>, text: string) {
  picker.button.value = text;
  picker.doc.fire("input", picker.button);
}

const kept = (picker: Awaited<ReturnType<typeof openPicker>>) =>
  picker
    .options()
    .filter((option) => !option.hidden)
    .map(labelOf);

const sentence = (picker: Awaited<ReturnType<typeof openPicker>>) =>
  picker.field.querySelector(".listbox__empty")?.textContent ?? "";

/* ── the seam ──────────────────────────────────────────────────────────────── */

// Every suite below runs the module on the markup the renderer emits, so a hook the module
// queries by that the server stopped writing fails them; this is only the page's half.
describe("the shipped page runs the module against what the server writes", () => {
  test("the shell loads it, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/controls/choice-picker.js",
    );
    const doc = new Doc();
    parseHtml(form("picker"), doc);
    await startedOn("controls/choice-picker.js", doc);
    const button = doc.querySelector('[role="combobox"]') as El;
    doc.fire("keydown", button, { key: "Enter" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

/* ── opening and closing ───────────────────────────────────────────────────── */

describe("the keys that open, and the ways out", () => {
  test("Enter and both arrows open onto the first enabled option", async () => {
    for (const key of ["Enter", "ArrowDown", "ArrowUp"]) {
      const picker = await scene(form("picker"));
      const button = picker.button as El;
      expect(picker.panel?.hidden).toBe(true);

      expect(picker.key(key, button).prevented).toBe(true);

      expect(picker.panel?.hidden).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(activeOf(button)).toBe(idOf(picker, "first"));
    }
  });

  test("Space, Home, End and a letter are typing: the field keeps them, and nothing opens", async () => {
    for (const key of [" ", "Home", "End", "a"]) {
      const picker = await scene(form("picker"));
      expect(picker.key(key, picker.button as El).prevented).toBe(false);
      expect(picker.panel?.hidden).toBe(true);
    }
  });

  test("opening onto a stored value starts the keyboard there, not at the top", async () => {
    const picker = await openPicker("fourth");
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
  });

  test("Escape closes, drops the active row, puts the choice back, and keeps focus", async () => {
    const picker = await openPicker("fourth");
    picker.button.focus();
    type(picker, "sec");
    picker.key("Escape", picker.button);

    expect(picker.panel?.hidden).toBe(true);
    expect(picker.button.getAttribute("aria-expanded")).toBe("false");
    expect(picker.button.hasAttribute("aria-activedescendant")).toBe(false);
    expect(picker.button.value).toBe("Fourth");
    expect(picker.carrier?.value).toBe("fourth");
    expect(picker.doc.activeElement).toBe(picker.button);
  });

  test("Tab closes without taking the focus back, so it still moves on", async () => {
    const picker = await openPicker();
    // The browser moves focus on after the key; the module must not have taken it back first.
    picker.button.blur();
    expect(picker.key("Tab", picker.button).prevented).toBe(false);

    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(picker.doc.body);
  });

  test("a press outside closes it and puts the choice back, and a press inside does not", async () => {
    const picker = await openPicker("first");
    type(picker, "fou");
    picker.doc.fire("pointerdown", picker.panel as El);
    expect(picker.panel?.hidden).toBe(false);

    // A press on something that takes no focus leaves it on the page, as it lands.
    picker.button.blur();
    picker.doc.fire("pointerdown", picker.form);
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.button.value).toBe("First");
    // Closed by a press elsewhere, so the focus stays where the press landed.
    expect(picker.doc.activeElement).toBe(picker.doc.body);
  });

  test("focus leaving the field closes it and puts the choice back; moving inside it does not", async () => {
    const picker = await openPicker("first");
    type(picker, "fou");
    picker.doc.fire("focusout", picker.button, { relatedTarget: picker.panel });
    expect(picker.panel?.hidden).toBe(false);

    picker.doc.fire("focusout", picker.button, { relatedTarget: null });
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.button.value).toBe("First");
  });

  test("a press on the field opens it with its text chosen, and a second press leaves it open", async () => {
    const picker = await scene(form("picker", "second"));
    const field = picker.button as El;
    picker.press(field);
    expect(picker.panel?.hidden).toBe(false);
    expect(field.selection).toEqual({ start: 0, end: "Second".length });
    // A press inside the text places the caret; it is not a press to close.
    picker.press(field);
    expect(picker.panel?.hidden).toBe(false);
  });

  test("the chevron opens and closes it, and focus is in the field throughout", async () => {
    const picker = await scene(form("picker"));
    const chevron = picker.field.querySelector(".listbox__chevron") as El;
    // A press there would take focus off the field, closing the list before the press opened it.
    expect(picker.doc.fire("mousedown", chevron).prevented).toBe(true);
    picker.press(chevron);
    expect(picker.panel?.hidden).toBe(false);
    expect(picker.doc.activeElement).toBe(picker.button as El);
    picker.press(chevron);
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(picker.button as El);
  });

  test("a press on a row keeps focus in the field until the press picks it", async () => {
    const picker = await openPicker();
    const row = picker.options().find((option) => labelOf(option) === "fourth") as El;
    expect(picker.doc.fire("mousedown", row).prevented).toBe(true);
    // The input takes its own press: that is where the caret goes.
    expect(picker.doc.fire("mousedown", picker.button).prevented).toBe(false);
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

  test("Home and End move the caret, not the active row", async () => {
    const picker = await openPicker();
    picker.key("ArrowDown", picker.button);
    for (const key of ["Home", "End"]) {
      expect(picker.key(key, picker.button).prevented).toBe(false);
      expect(activeOf(picker.button)).toBe(idOf(picker, "second"));
    }
  });

  test("the walk steps through only the options a search kept", async () => {
    const picker = await openPicker();
    type(picker, "f");
    expect(activeOf(picker.button)).toBe(idOf(picker, "first"));
    picker.key("ArrowDown", picker.button);
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
    picker.key("ArrowDown", picker.button);
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
    // A hover is already on the row it names, so only the keyboard has to be shown where it went.
    // Revealing used to be `scrollIntoView`, which scrolls the form and re-placed the panel.
    const picker = await longList();

    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);
    expect(picker.scroll.scrollTop).toBe(0);

    picker.key("ArrowDown", picker.button);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);
    expect(picker.scroll.scrollTop).toBe(56);
  });

  test("a key that moves nowhere leaves a hand-scrolled list where the hand put it", async () => {
    // The other half of not fighting the user: the row is already active, so re-revealing
    // it would drag the list back from wherever it has since been scrolled to.
    const picker = await longList();
    picker.key("ArrowUp", picker.button);
    expect(picker.scroll.scrollTop).toBe(56);

    picker.scroll.scrollTop = 0;
    picker.key("Home", picker.button);

    expect(activeOf(picker.button)).toBe(picker.hidden.id);
    expect(picker.scroll.scrollTop).toBe(0);
  });

  test("a row the list slid under a still pointer is not a row anyone chose", async () => {
    // `pointerover` fires for a scroll under a resting hand as much as for a hand that moved, and
    // answering the first hands the selection back to wherever the cursor is sitting.
    const picker = await longList();
    picker.doc.fire("pointerover", picker.visible);
    picker.key("ArrowDown", picker.button);

    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.hidden.id);

    // A hand that then moves is a hand choosing again.
    picker.doc.fire("pointermove", picker.panel as El);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);

    // Disarming lasts one opening. This one scrolled the list; the next opens onto a row
    // already in view, moves nothing, and so trusts the pointer from the start.
    picker.key("ArrowDown", picker.button);
    picker.key("Escape", picker.button);
    const parked = picker.scroll.scrollTop;
    picker.key("Enter", picker.button);
    expect(picker.scroll.scrollTop).toBe(parked);
    picker.doc.fire("pointerover", picker.visible);
    expect(activeOf(picker.button)).toBe(picker.visible.id);
  });

  test("a row is brought inside the scrollport, not inside the scrollbars", async () => {
    // A note long enough to overflow brings out a horizontal scrollbar, and the border box
    // includes it while the scrollport does not, so the wrong one parks the last row under it.
    const picker = await longList();
    // A 200px border box holding a 1px line and 15px of horizontal scrollbar: the
    // scrollport runs 101..285, where the border box runs 100..300.
    picker.scroll.clientTop = 1;
    picker.scroll.clientHeight = 184;
    picker.key("ArrowUp", picker.button);
    // `hidden` ends at 356, so the list must move by 356 - 285.
    expect(picker.scroll.scrollTop).toBe(71);
  });

  test("a row off the side is brought back too", async () => {
    // `scrollIntoView` moved both axes. Only ever moving one is a real behaviour dropped,
    // not a difference that cannot show.
    const picker = await longList();
    picker.scroll.scrollWidth = 400;
    picker.hidden.box = { ...picker.hidden.box, left: 40, right: 340 };
    picker.key("ArrowUp", picker.button);
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

/* ── searching ─────────────────────────────────────────────────────────────── */

describe("typing searches the labels, and only the labels", () => {
  test("the first keystroke opens the list, kept to the labels holding every typed word", async () => {
    const picker = await scene(form("picker"));
    const input = picker.button as El;
    input.value = "f";
    picker.doc.fire("input", input);
    expect(picker.panel?.hidden).toBe(false);
    expect(
      picker
        .options()
        .filter((option) => !option.hidden)
        .map(labelOf),
    ).toEqual(["first", "fourth"]);
  });

  test("case and accents are ignored, words may come in any order, and each must be found", async () => {
    const picker = await scene(
      form("picker", undefined, {
        values: [
          { value: "leguin", label: "Ursula K. Le Guin" },
          { value: "butler", label: "Octavia E. Butler" },
          { value: "pena", label: "Peña Nieto" },
        ],
      }),
    );
    const open = picker as Awaited<ReturnType<typeof openPicker>>;
    type(open, "GUIN le");
    expect(kept(open)).toEqual(["leguin"]);
    type(open, "pena");
    expect(kept(open)).toEqual(["pena"]);
    type(open, "guin octavia");
    expect(kept(open)).toEqual([]);
  });

  test("the first option kept is where Enter lands, skipping one that cannot be chosen", async () => {
    const picker = await openPicker();
    type(picker, "thi");
    // "third" is kept, since it is shown as the list draws it, but it cannot be chosen.
    expect(kept(picker)).toEqual(["third"]);
    expect(picker.button.hasAttribute("aria-activedescendant")).toBe(false);
    type(picker, "d");
    expect(kept(picker)).toEqual(["second", "third"]);
    expect(activeOf(picker.button)).toBe(idOf(picker, "second"));
  });

  test("a note is never searched", async () => {
    const picker = await openPicker();
    const second = picker.options().find((o) => labelOf(o) === "second") as El;
    const note = (second.querySelector(".listbox__note") as El).textContent;
    type(picker, note);
    expect(kept(picker)).toEqual([]);
  });

  test("a search that keeps nothing says so, and Enter picks nothing and posts nothing", async () => {
    const picker = await openPicker();
    expect(sentence(picker)).toBe("");
    type(picker, "zzz");
    expect(sentence(picker)).toBe(NO_RESULTS);
    expect(picker.button.hasAttribute("aria-activedescendant")).toBe(false);
    expect(picker.key("Enter", picker.button).prevented).toBe(true);
    expect(picker.carrier?.value).toBe("");
    expect(picker.panel?.hidden).toBe(false);
  });

  test("a group that keeps no option is hidden with them, heading and all", async () => {
    const picker = await scene(
      form("picker", undefined, {
        values: [
          { value: "usd", label: "Dollar", group: "americas" },
          { value: "eur", label: "Euro", group: "europe" },
        ],
        groups: [
          { id: "americas", heading: "Americas" },
          { id: "europe", heading: "Europe" },
        ],
      }),
    );
    const open = picker as Awaited<ReturnType<typeof openPicker>>;
    type(open, "eur");
    const groups = picker.field.querySelectorAll('[role="group"]');
    expect(groups.map((group) => group.hidden)).toEqual([true, false]);
  });

  test("emptying the search lists everything again, landing on the chosen option", async () => {
    const picker = await openPicker("fourth");
    type(picker, "fir");
    type(picker, "");
    expect(kept(picker)).toEqual(OPTIONS.map((option) => option.value));
    expect(activeOf(picker.button)).toBe(idOf(picker, "fourth"));
  });

  test("reopening starts from the whole list, not the last search", async () => {
    const picker = await openPicker();
    type(picker, "zzz");
    picker.key("Escape", picker.button);
    picker.key("ArrowDown", picker.button);
    expect(kept(picker)).toEqual(OPTIONS.map((option) => option.value));
    expect(sentence(picker)).toBe("");
  });
});

/* ── committing ────────────────────────────────────────────────────────────── */

describe("only a pick changes what is chosen", () => {
  test("Enter takes the active option, closes, and writes the carrier", async () => {
    const picker = await openPicker();
    type(picker, "sec");
    picker.key("Enter", picker.button);

    expect(picker.carrier?.value).toBe("second");
    // The field shows the option's name: the note is the row's, and stays behind in the list.
    expect(picker.button.value).toBe("Second");
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.doc.activeElement).toBe(picker.button);
    expect(picker.doc.changes).toHaveLength(1);
  });

  test("Space is typing, and commits nothing", async () => {
    const picker = await openPicker();
    picker.key("ArrowDown", picker.button);
    expect(picker.key(" ", picker.button).prevented).toBe(false);
    expect(picker.carrier?.value).toBe("");
    expect(picker.panel?.hidden).toBe(false);
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
