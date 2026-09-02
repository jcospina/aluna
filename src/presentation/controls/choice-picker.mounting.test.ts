// How a drawn choice control gets its script, where its panel hangs, and what puts a
// finished form back.
//
// Mounting is the half that is not about the control at all: a field arrives in a desk
// long after page load, by an htmx swap or by a module cloning a template and swapping it
// in itself, and either way something has to notice. The panel's placement is the other
// half — a fixed box measured against one ancestor and painted inside a different one.
//
// The control's own behavior — the keys, the walk, the typeahead, the commit — is next
// door, in `choice-picker.test.ts`.

import { describe, expect, test } from "bun:test";
import {
  deskChrome,
  form,
  installDomGlobals,
  labelOf,
  OPTIONS,
  openPicker,
} from "./choice-picker.fixture.test-support.ts";
import { El, parseHtml, scene } from "./choice-picker.test-support.ts";

installDomGlobals();

/* ── mounting and resetting ────────────────────────────────────────────────── */

describe("what happens around the control", () => {
  test("a picker is mounted once, however many arrivals are reported", async () => {
    const { mountChoicePickers } = await import("#shell/choice-picker.js");
    const picker = await scene(form("picker"));
    picker.doc.append(picker.form);
    picker.doc.append(picker.form);
    // The guard flag, read from the outside: a second arrival finds nothing left to mount.
    expect(mountChoicePickers(picker.doc as never)).toHaveLength(0);

    // And the press round-trips, which a second toggle wired to the same button would
    // turn into open-then-closed.
    picker.press(picker.button as El);
    expect(picker.panel?.hidden).toBe(false);
  });

  test("a form put in place by hand mounts too, with no landing announced", async () => {
    // What `record-view.js` does to open a record: it clones the view out of a template and
    // replaces the collection with it, so htmx announces nothing. The edit form's picker
    // used to stand there dead — it opened on a fresh record and on nothing after.
    const picker = await scene(form("picker"));
    const template = parseHtml(form("picker", "second"), new El("div"));
    const outgoing = new El("div");
    picker.doc.append(outgoing);
    const arriving = template.cloneNode(true);
    outgoing.replaceWith(arriving);

    const field = arriving.querySelector("[data-choice-presentation]") as El;
    expect(field.getAttribute("data-choice-picker-mounted")).toBe("true");
    picker.doc.fire("click", field.querySelector(".listbox__button") as El);
    expect(field.querySelector(".listbox__panel")?.hidden).toBe(false);
    // And the template it was taken from is inert: cloning a mounted field would hand the
    // copy a flag and no script, which is the same dead control by another route.
    const source = template.querySelector("[data-choice-presentation]") as El;
    expect(source.getAttribute("data-choice-picker-mounted")).toBe(null);
  });

  test("the watch listens for the one thing that reports an arrival", async () => {
    // A watch configured for anything but childList over the subtree hears nothing, and
    // the whole fix is that watch. Read back what it actually asked for.
    const picker = await scene(form("picker"));
    expect(picker.doc.watches).toEqual([
      { target: picker.doc, options: { childList: true, subtree: true } },
    ]);
  });

  test("the field that arrives is mounted even when it arrives alone", async () => {
    // The watch hands over the node that landed, which need not be a form holding a field.
    const { mountChoicePickers } = await import("#shell/choice-picker.js");
    const arriving = parseHtml(form("picker"), new El("div"));
    const field = arriving.querySelector("[data-choice-presentation]") as El;
    field.remove();

    expect(mountChoicePickers(field as never)).toHaveLength(1);
    expect(field.getAttribute("data-choice-picker-mounted")).toBe("true");
  });

  test("one field that refuses to mount does not take the batch down with it", async () => {
    // A refusal is loud — it is the fail-safe against a control that looks right and posts
    // nothing — but it is not allowed to cost every other form that landed beside it.
    const picker = await scene(form("picker"));
    const broken = parseHtml(form("picker"), new El("div"));
    broken.querySelector("[data-choice-value]")?.remove();
    const sound = parseHtml(form("picker", "second"), new El("div"));

    expect(() => picker.doc.append(broken, sound)).toThrow("data-choice-value");

    const soundField = sound.querySelector("[data-choice-presentation]") as El;
    expect(soundField.getAttribute("data-choice-picker-mounted")).toBe("true");
    // And the one that refused is not marked done, so it is offered a script again.
    const brokenField = broken.querySelector("[data-choice-presentation]") as El;
    expect(brokenField.getAttribute("data-choice-picker-mounted")).toBe(null);
  });

  test("a picker left open when its form goes is closed and let go", async () => {
    const picker = await openPicker();
    expect(picker.panel?.hidden).toBe(false);
    picker.form.remove();
    picker.doc.append(new El("div"));

    expect(picker.panel?.hidden).toBe(true);
    // Nothing left holding it: the next press has no detached subtree to walk.
    picker.doc.fire("pointerdown", picker.doc);
    expect(picker.button.getAttribute("aria-expanded")).toBe("false");
  });

  test("a press meant for the panel never reaches the button underneath", async () => {
    // Enter is taken by the control while it is open. Without `preventDefault` the same
    // key would go on to activate the button, which would close what it just committed.
    const picker = await openPicker();
    expect(picker.key("Enter", picker.button).prevented).toBe(true);
    expect(picker.key("Escape", picker.button).prevented).toBe(false);
  });
});

describe("the box a fixed panel is painted inside", () => {
  test("it is the clipping ancestor, not the containing block and not the scroller", async () => {
    // Three boxes, and conflating any two of them is a bug that shipped: the window is the
    // containing block but does not clip (hang into it and the first rows land over the
    // title bar); the body clips and starts below the title bar; the form's own scroller is
    // static, which is the whole reason the panel is fixed rather than absolute.
    const { clipBounds } = await import("#shell/choice-picker.js");
    const picker = await scene(form("picker"));
    const { chrome, body, scroller } = deskChrome();
    picker.field.parent?.append(chrome);
    scroller.append(picker.field);

    expect(clipBounds(picker.panel as never)).toEqual({
      top: body.box.top,
      bottom: body.box.bottom,
      left: body.box.left,
      right: body.box.right,
    });
  });

  test("nothing above the containing block bounds it", async () => {
    // The walk stops at the transformed ancestor. A clipping box outside it is a box the
    // panel's own coordinates no longer answer to.
    const { clipBounds } = await import("#shell/choice-picker.js");
    const picker = await scene(form("picker"));
    const { chrome, scroller } = deskChrome();
    const outer = new El("div");
    outer.computed = { ...outer.computed, position: "relative", overflowY: "hidden" };
    outer.box = { top: 400, bottom: 500, left: 400, right: 500, width: 100, height: 100 };
    picker.field.parent?.append(outer);
    outer.append(chrome);
    scroller.append(picker.field);

    expect(clipBounds(picker.panel as never).top).toBe(136);
  });

  test("with nothing clipping, it is the viewport", async () => {
    const { clipBounds } = await import("#shell/choice-picker.js");
    const picker = await scene(form("picker"));
    expect(clipBounds(picker.panel as never)).toEqual({
      top: 0,
      left: 0,
      right: 1200,
      bottom: 900,
    });
  });
});

describe("where the panel hangs", () => {
  test("it stays inside the box that paints it, not the box it is measured against", async () => {
    // The bounds themselves are pinned above; what this adds is that placement asks for
    // them at all, and lands the panel between them rather than over the title bar.
    const picker = await scene(form("picker"));
    const { chrome, body, scroller } = deskChrome();
    picker.field.parent?.append(chrome);
    scroller.append(picker.field);
    (picker.button as El).box = {
      top: 306,
      bottom: 342,
      left: 275,
      right: 994,
      width: 719,
      height: 36,
    };

    picker.key("ArrowDown", picker.button as El);

    const top = Number.parseFloat(picker.panel?.style.top ?? "0") + chrome.box.top;
    const height = picker.panel?.offsetHeight ?? 0;
    expect(picker.field.classList.contains("is-above")).toBe(false);
    expect(top).toBeGreaterThanOrEqual(body.box.top);
    expect(top + height).toBeLessThanOrEqual(body.box.bottom);
  });

  test("scrolling the form the picker stands in keeps the panel on its control", async () => {
    // The panel is positioned against the viewport so the form's scroller cannot clip it,
    // which means it does not travel with the button on its own. The watch is a capturing
    // listener because an inner scroller's `scroll` does not bubble.
    const picker = await openPicker();
    const before = picker.panel?.getAttribute("style");
    expect(before).toContain("top:");
    (picker.panel as El).style.top = "-9999px";
    picker.scrollWithin(picker.form);
    expect(picker.panel?.style.top).not.toBe("-9999px");
    // Re-placing a control that has not moved lands on the same numbers it landed on
    // before, so a scroll that changes nothing writes nothing new.
    expect(picker.panel?.getAttribute("style")).toBe(before as string);
  });

  test("one document's press never closes another document's panel", async () => {
    const first = await openPicker();
    const second = await scene(form("picker"));
    expect(first.panel?.hidden).toBe(false);

    second.doc.fire("pointerdown", second.form);

    expect(first.panel?.hidden).toBe(false);
  });

  test("a picker missing the input it posts through refuses to mount", async () => {
    const { mountChoicePickers } = await import("#shell/choice-picker.js");
    const picker = await scene(form("picker"));
    picker.carrier?.remove();
    picker.field.removeAttribute("data-choice-picker-mounted");
    // Failing open would leave a control that looks right and posts nothing.
    expect(() => mountChoicePickers(picker.doc as never)).toThrow("data-choice-value");
  });

  test("the placeholder survives a chosen value, so an emptied control reads right", async () => {
    // Read off the field, not off the rendered value: with a value chosen, the rendered
    // value IS the label, and a control that recovered its placeholder from there would
    // put that label back the next time it was emptied.
    const picker = await scene(form("picker", "second"));
    expect(picker.field.getAttribute("data-choice-placeholder")).toBe("Choose Value…");
    picker.field.setAttribute("data-choice-initial", "");
    picker.doc.fire("aluna:record-created", picker.form);
    expect(picker.valueEl?.textContent).toBe("Choose Value…");
  });
});

describe("putting a finished form back", () => {
  test("a finished create form puts the picker back to what the server drew", async () => {
    const picker = await scene(form("picker"));
    picker.press(picker.button as El);
    picker.press(picker.options().find((o) => labelOf(o) === "fourth") as El);
    expect(picker.valueEl?.textContent).toBe("Fourth");
    // Left standing open, the way a form finished from anywhere but the panel leaves it:
    // put back has to mean closed too, or an active row and an `aria-expanded` outlive the
    // thing they described.
    picker.press(picker.button as El);
    expect(picker.panel?.hidden).toBe(false);
    // A hidden input's value *is* its content attribute, so choosing rewrote the very
    // default `form.reset()` would restore. That is why the server writes the truth once,
    // on the field, where nothing later moves it.
    expect(picker.carrier?.getAttribute("value")).toBe("fourth");
    expect(picker.field.getAttribute("data-choice-initial")).toBe("");

    picker.form.reset();
    picker.doc.fire("aluna:record-created", picker.form);

    expect(picker.carrier?.value).toBe("");
    expect(picker.valueEl?.textContent).toBe("Choose Value…");
    expect(picker.valueEl?.getAttribute("class")).toContain("is-placeholder");
    expect(picker.options().every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);
    expect(picker.panel?.hidden).toBe(true);
    expect(picker.button?.getAttribute("aria-expanded")).toBe("false");
    expect(picker.button?.getAttribute("aria-activedescendant")).toBe(null);
  });

  test("an edit form's picker goes back to the record's own value, not to empty", async () => {
    const picker = await scene(form("picker", "second"));
    expect(picker.field.getAttribute("data-choice-initial")).toBe("second");
    picker.press(picker.button as El);
    picker.press(picker.options().find((o) => labelOf(o) === "fourth") as El);

    picker.form.reset();
    picker.doc.fire("aluna:record-created", picker.form);

    expect(picker.carrier?.value).toBe("second");
    expect(picker.valueEl?.textContent).toBe("Second");
  });

  test("a cancelled create does the same to a segmented row", async () => {
    const row = await scene(
      form("segmented", undefined, { values: OPTIONS.map(({ note, ...r }) => r) }),
    );
    row.press(row.field.querySelectorAll("button[data-value]")[3] as El);
    expect(row.field.querySelector("[data-choice-value]")?.value).toBe("fourth");

    row.form.reset();
    row.doc.fire("aluna:create-cancelled", row.form);

    expect(row.field.querySelector("[data-choice-value]")?.value).toBe("");
    expect(
      row.field.querySelectorAll("button[data-value]").map((s) => s.getAttribute("aria-pressed")),
    ).toEqual(["false", "false", "false", "false"]);
  });

  test("the radio group needs none of this: its inputs reset themselves", async () => {
    const group = await scene(form("radio", "second"));
    expect(group.field.hasAttribute("data-choice-initial")).toBe(false);
    const inputs = group.field.querySelectorAll("input[type=radio]");
    expect(inputs[1]?.checked).toBe(true);

    (inputs[0] as El).checked = true;
    (inputs[1] as El).checked = false;
    group.form.reset();

    expect(inputs[1]?.checked).toBe(true);
    expect(inputs[0]?.checked).toBe(false);
  });
});
