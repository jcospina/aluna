import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROMPT_FORM_ID } from "#shell/desk-window.js";
import {
  closeLogoMenu,
  closeRenameEditor,
  isUsableCapabilityName,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  labelNotice,
} from "#shell/logo-menu.js";
import { isCapabilityNameLabel, MAX_CAPABILITY_LABEL_CHARS } from "../../../registry/index.ts";
import { renderCapabilityLogo } from "../../../server/http/fragments.ts";
import { desk, type Node, pressAndHold, slotFor } from "./logo-menu.test-support.ts";

describe("the three ways into a logo's menu", () => {
  test("right-click opens it at the pointer, and nothing else opens", () => {
    const scene = desk();

    const { prevented } = scene.root.fire("contextmenu", scene.notes.logo, {
      clientX: 120,
      clientY: 90,
    });

    expect(prevented).toBe(true);
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(false);
    expect(scene.recipes.menu.hasAttribute("hidden")).toBe(true);
    // And the logo says so, because a reader told only "Open Notes, button" has no way to
    // learn a menu opens on it.
    expect(scene.notes.logo.getAttribute("aria-expanded")).toBe("true");
    // It stands in the menu layer while it is open, over every window on the desk.
    expect(scene.notes.menu.parent).toBe(scene.menus);
    expect(scene.notes.menu.style.getPropertyValue("left")).toBe("120px");
    expect(scene.notes.menu.style.getPropertyValue("top")).toBe("90px");
    expect(scene.root.activeElement).toBe(scene.notes.rename);

    closeLogoMenu({ restoreFocus: false });
  });

  test("a menu asked for near the floor stands above the prompt bar, not over it", () => {
    const scene = desk();

    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 396 });

    // The strip the bar floats in is a floor for everything on this desk, and it is where
    // a refusal about the name being typed is spoken — a panel over that sentence would
    // cover the answer to itself.
    const top = Number.parseInt(scene.notes.menu.style.getPropertyValue("top"), 10);
    expect(top + scene.notes.menu.getBoundingClientRect().height).toBeLessThanOrEqual(
      scene.promptBar.getBoundingClientRect().top,
    );

    closeLogoMenu({ restoreFocus: false });
  });

  test("the menu key and Shift+F10 both open it, at the logo", () => {
    for (const stroke of [{ key: "ContextMenu" }, { key: "F10", shiftKey: true }]) {
      const scene = desk();

      const { prevented } = scene.root.fire("keydown", scene.notes.logo, stroke);

      expect(prevented).toBe(true);
      expect(scene.notes.menu.hasAttribute("hidden")).toBe(false);
      expect(scene.root.activeElement).toBe(scene.notes.rename);

      closeLogoMenu({ restoreFocus: false });
    }
  });

  test("press-and-hold opens it, and the click it ends in opens nothing", async () => {
    const scene = desk();

    await pressAndHold(scene, scene.notes.logo);
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(false);

    // A keyboard activation on the menu it just opened is not the click the hold owes.
    // A platform that suppressed its own would otherwise have the first press of Rename
    // swallowed here and do nothing at all.
    const byKeyboard = scene.root.fire("click", scene.notes.rename, { detail: 0 });
    expect(byKeyboard.prevented).toBe(false);
    closeRenameEditor({ restoreFocus: false });
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    // The release the browser follows with a click on the button that was held. Opening
    // the menu must never also open the capability, so exactly one click is taken — and
    // taken outside the document, before the desk's own opener can see it.
    const consumed = scene.root.fire("click", scene.notes.logo);
    expect(consumed.prevented).toBe(true);
    expect(consumed.stopped).toBe(true);
    // And only one: the next press is the person's own.
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(false);

    closeLogoMenu({ restoreFocus: false });
  });

  test("a mouse holds nothing down — it has a button of its own", async () => {
    const scene = desk();

    scene.root.fire("pointerdown", scene.notes.logo, {
      pointerType: "mouse",
      clientX: 40,
      clientY: 60,
    });
    await Bun.sleep(LONG_PRESS_MS + 30);

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
  });
});

describe("what cancels a press-and-hold", () => {
  test("a finger that wanders further than the slop is scrolling, not holding", async () => {
    const scene = desk();

    await pressAndHold(scene, scene.notes.logo, () => {
      scene.root.fire("pointermove", scene.notes.logo, {
        clientX: 40 + LONG_PRESS_SLOP_PX + 1,
        clientY: 60,
      });
    });

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    // Nothing was consumed either: the press that was not a hold is an ordinary press,
    // and the capability it lands on opens.
    expect(scene.root.fire("click", scene.notes.logo).prevented).toBe(false);
  });

  test("a finger that stays inside the slop is still holding still", async () => {
    const scene = desk();

    await pressAndHold(scene, scene.notes.logo, () => {
      scene.root.fire("pointermove", scene.notes.logo, {
        clientX: 40 + LONG_PRESS_SLOP_PX - 1,
        clientY: 60,
      });
    });

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(false);
    closeLogoMenu({ restoreFocus: false });
  });

  test("a list moving under the finger, and an early release, both cancel it", async () => {
    for (const ending of ["scroll", "pointerup", "pointercancel"]) {
      const scene = desk();

      scene.root.fire("pointerdown", scene.notes.logo, {
        pointerType: "touch",
        clientX: 40,
        clientY: 60,
      });
      scene.root.fire(ending, scene.notes.logo, {});
      await Bun.sleep(LONG_PRESS_MS + 30);

      expect(scene.notes.menu.hasAttribute("hidden"), ending).toBe(true);
      expect(scene.root.fire("click", scene.notes.logo).prevented, ending).toBe(false);
    }
  });
});

describe("the menu itself", () => {
  test("it carries Rename and Delete, and the arrows walk between them", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    expect(scene.notes.menu.querySelectorAll("[role=menuitem]")).toHaveLength(2);

    for (const [key, expected] of [
      ["ArrowDown", scene.notes.remove],
      ["ArrowDown", scene.notes.rename],
      ["ArrowUp", scene.notes.remove],
      ["Home", scene.notes.rename],
      ["End", scene.notes.remove],
    ] as const) {
      const at = scene.root.activeElement as Node;
      expect(scene.root.fire("keydown", at, { key }).prevented, key).toBe(true);
      expect(scene.root.activeElement, key).toBe(expected);
    }

    closeLogoMenu({ restoreFocus: false });
  });

  test("Escape puts it away and hands the focus back to the logo", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    scene.root.fire("keydown", scene.root.activeElement as Node, { key: "Escape" });

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    // And home again, so a swap addressed at this capability takes its menu with it.
    expect(scene.notes.menu.parent).toBe(scene.notes.slot);
    expect(scene.notes.logo.getAttribute("aria-expanded")).toBe("false");
    expect(scene.root.activeElement).toBe(scene.notes.logo);
  });

  test("a press away puts it away, and a press on its own logo only puts it away", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    const elsewhere = scene.root.fire("click", scene.layer);
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    expect(elsewhere.prevented).toBe(false);
    expect(scene.root.activeElement).toBe(scene.notes.logo);

    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });
    const onItsLogo = scene.root.fire("click", scene.notes.logo);
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    // One press did one thing: it dismissed the menu, and did not also open the capability.
    expect(onItsLogo.prevented).toBe(true);
    expect(onItsLogo.stopped).toBe(true);
  });

  test("a right-click away puts it away too — that gesture produces no click", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    scene.root.fire("contextmenu", scene.layer, { clientX: 300, clientY: 300 });

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
  });

  test("another logo's menu is this one closing", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    scene.root.fire("contextmenu", scene.recipes.logo, { clientX: 20, clientY: 20 });

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    expect(scene.notes.menu.parent).toBe(scene.notes.slot);
    expect(scene.recipes.menu.hasAttribute("hidden")).toBe(false);

    closeLogoMenu({ restoreFocus: false });
  });

  test("Delete hands the focus back to the logo rather than leaving it nowhere", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    scene.root.fire("click", scene.notes.remove);

    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
    // The row the press put the focus on is now hidden, and the window's own answer
    // arrives later and only if it arrives: a refused deletion swaps nothing, and the
    // keyboard would be left on the body with nothing to carry on from.
    expect(scene.root.activeElement).toBe(scene.notes.logo);
  });
});

describe("the one inline rename form", () => {
  function editing() {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });
    scene.root.fire("click", scene.notes.rename);
    return scene;
  }

  test("Rename turns the label into the form, and takes the tile out of reach", () => {
    const scene = editing();

    expect(scene.notes.form.hasAttribute("hidden")).toBe(false);
    expect(scene.notes.slot.hasAttribute("data-renaming")).toBe(true);
    expect(scene.notes.logo.hasAttribute("inert")).toBe(true);
    expect(scene.notes.input.value).toBe("Notes");
    expect(scene.root.activeElement).toBe(scene.notes.input);
    // The menu is put away by opening the form, not left standing behind it.
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);

    closeRenameEditor({ restoreFocus: false });
  });

  test("Cancel and Escape both give the label back and the focus with it", () => {
    for (const leave of ["cancel", "escape"] as const) {
      const scene = editing();
      scene.notes.input.value = "Something else entirely";

      if (leave === "cancel") scene.root.fire("click", scene.notes.cancel);
      else scene.root.fire("keydown", scene.notes.input, { key: "Escape" });

      expect(scene.notes.form.hasAttribute("hidden"), leave).toBe(true);
      expect(scene.notes.form.parent, leave).toBe(scene.notes.slot);
      expect(scene.notes.slot.hasAttribute("data-renaming"), leave).toBe(false);
      expect(scene.notes.logo.hasAttribute("inert"), leave).toBe(false);
      expect(scene.notes.logoLabel.textContent, leave).toBe("Notes");
      expect(scene.root.activeElement, leave).toBe(scene.notes.logo);
    }
  });

  test("a name the editor will not send never reaches the wire", () => {
    for (const refused of ["", "   ", "Got it — I'll set that up.", "x".repeat(49)]) {
      const scene = editing();
      scene.notes.input.value = refused;

      const submitted = scene.root.fire("submit", scene.notes.form);

      expect(submitted.prevented, refused).toBe(true);
      expect(submitted.stopped, refused).toBe(true);
      expect(scene.notes.error.textContent, refused).not.toBe("");
      // The typed value and the focus stay exactly where they were, so a second try is
      // one keystroke away rather than a retype.
      expect(scene.notes.input.value, refused).toBe(refused);
      expect(scene.root.activeElement, refused).toBe(scene.notes.input);
      expect(scene.notes.form.hasAttribute("hidden"), refused).toBe(false);

      closeRenameEditor({ restoreFocus: false });
    }
  });

  test("a name it will send goes out, and whatever it said before is retired", () => {
    const scene = editing();
    scene.notes.input.value = "";
    scene.root.fire("submit", scene.notes.form);
    expect(scene.notes.error.textContent).not.toBe("");

    scene.notes.input.value = "Journal";
    const submitted = scene.root.fire("submit", scene.notes.form);

    expect(submitted.prevented).toBe(false);
    expect(submitted.stopped).toBe(false);
    expect(scene.notes.error.textContent).toBe("");

    closeRenameEditor({ restoreFocus: false });
  });

  test("a press that goes somewhere answers the editor and gives the label back", () => {
    const scene = editing();
    scene.notes.input.value = "Something else entirely";

    // Opening another capability: an editor left standing through that is a form about a
    // capability the person has walked away from.
    scene.root.fire("click", scene.recipes.logo);

    expect(scene.notes.form.hasAttribute("hidden")).toBe(true);
    expect(scene.notes.form.parent).toBe(scene.notes.slot);
    expect(scene.notes.slot.hasAttribute("data-renaming")).toBe(false);
    expect(scene.notes.logo.hasAttribute("inert")).toBe(false);
    // And the press goes on doing what it was for: the focus is not taken back from it.
    expect(scene.root.activeElement).not.toBe(scene.notes.logo);
  });

  test("a press that goes nowhere leaves a half-typed name where it was", () => {
    const scene = editing();
    scene.notes.input.value = "Half a name";

    // Inside the editor, and on the ground beside it. Neither is going anywhere, and
    // neither may take a name someone is still typing.
    scene.root.fire("click", scene.notes.input);
    scene.root.fire("click", scene.layer);

    expect(scene.notes.form.hasAttribute("hidden")).toBe(false);
    expect(scene.notes.input.value).toBe("Half a name");

    closeRenameEditor({ restoreFocus: false });
  });
});

describe("the rename that is on its way", () => {
  function editing() {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });
    scene.root.fire("click", scene.notes.rename);
    return scene;
  }

  test("the wait is exposed while the write is queued, and taken off after", () => {
    const scene = editing();

    scene.root.fire("htmx:beforeRequest", scene.notes.form, { detail: { elt: scene.notes.form } });
    expect(scene.notes.form.getAttribute("aria-busy")).toBe("true");
    // And it says so, rather than only going grey: this write waits behind whatever is
    // already queued, so the wait is real and occasionally long.
    expect(scene.notes.save.textContent).toBe("Saving…");

    scene.root.fire("htmx:afterRequest", scene.notes.form, {
      detail: { elt: scene.notes.form, successful: true },
    });
    expect(scene.notes.form.hasAttribute("aria-busy")).toBe(false);
    expect(scene.notes.save.textContent).toBe("Save");

    closeRenameEditor({ restoreFocus: false });
  });

  test("the name lands and the logo that comes back is given the focus the swap took", () => {
    const scene = editing();
    scene.notes.input.value = "Journal";
    scene.root.fire("submit", scene.notes.form);

    // What htmx does with an `outerHTML` swap: the old slot leaves and a new one, carrying
    // the same capability, stands in its place.
    const renamed = slotFor("notes", "Journal");
    const was = scene.notes.slot;
    scene.layer.append(renamed.slot);
    was.remove();
    scene.root.fire("htmx:afterSwap", renamed.slot, { detail: { target: was } });

    expect(scene.root.activeElement).toBe(renamed.logo);
    // And the editor went out of the document with the slot it belonged to, rather than
    // being left floating over a desk that has no logo under it any more.
    expect(scene.menus.children).toHaveLength(0);
    expect(scene.notes.form.parent).toBe(was);
  });

  test("a refusal swaps nothing, so the logo it would have focused is left alone", () => {
    const scene = editing();
    scene.notes.input.value = "Journal";
    scene.root.fire("submit", scene.notes.form);
    scene.root.fire("htmx:afterRequest", scene.notes.form, {
      detail: { elt: scene.notes.form, successful: false },
    });

    // Some later, unrelated swap must not be read as this rename landing.
    scene.root.fire("htmx:afterSwap", scene.recipes.slot, {
      detail: { target: scene.recipes.slot },
    });

    expect(scene.root.activeElement).toBe(scene.notes.input);
    expect(scene.notes.form.hasAttribute("hidden")).toBe(false);

    closeRenameEditor({ restoreFocus: false });
  });

  test("an editor open when its own slot is re-rendered goes with it", () => {
    const scene = editing();

    // No rename was submitted: this is the tile's own artwork landing underneath an open
    // editor. Nothing puts the editor back unless this does.
    const replacement = slotFor("notes", "Notes");
    const was = scene.notes.slot;
    scene.layer.append(replacement.slot);
    was.remove();
    scene.root.fire("htmx:afterSwap", replacement.slot, { detail: { target: was } });

    expect(scene.menus.children).toHaveLength(0);
    expect(scene.notes.form.parent).toBe(was);
    expect(scene.notes.form.hasAttribute("hidden")).toBe(true);
  });
});

describe("what happens to an open panel when its logo is re-rendered", () => {
  function editing() {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });
    scene.root.fire("click", scene.notes.rename);
    return scene;
  }

  test("an evolution's out-of-band replacement takes the editor with it", () => {
    const scene = editing();

    // An evolution answers into the window and replaces the slot out of band, so the
    // event names the *new* element inside a response that was never about this slot.
    // Nothing in it points at the slot that left.
    const replacement = slotFor("notes", "Notes");
    const was = scene.notes.slot;
    scene.layer.append(replacement.slot);
    was.remove();
    scene.root.fire("htmx:oobAfterSwap", replacement.slot, { detail: { target: scene.layer } });

    expect(scene.menus.children).toHaveLength(0);
    expect(scene.notes.form.hasAttribute("hidden")).toBe(true);
  });

  test("a deletion removes the slot without a swap, and the editor still comes down", () => {
    const scene = editing();

    // `hx-swap-oob="delete:…"` takes the slot out and htmx swaps nothing for it, so no
    // swap event is dispatched at all. The settle at the end of the request is the only
    // thing that can notice.
    scene.notes.slot.remove();
    scene.root.fire("htmx:afterSettle", scene.layer, {});

    expect(scene.menus.children).toHaveLength(0);
    expect(scene.notes.form.hasAttribute("hidden")).toBe(true);
  });

  test("an open menu comes down with the logo it opened on", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });

    scene.notes.slot.remove();
    scene.root.fire("htmx:afterSettle", scene.layer, {});

    expect(scene.menus.children).toHaveLength(0);
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);
  });

  test("the ground moving under it puts the menu away and takes the editor along", () => {
    const scene = desk();
    scene.root.fire("contextmenu", scene.notes.logo, { clientX: 10, clientY: 10 });
    scene.root.fire("scroll", scene.layer, {});
    expect(scene.notes.menu.hasAttribute("hidden")).toBe(true);

    // The editor is holding typed text, so it is followed rather than taken away.
    const editor = editing();
    editor.notes.logoLabel.box = { ...editor.notes.logoLabel.box, left: 200, top: 240 };
    editor.root.fire("scroll", editor.layer, {});

    expect(editor.notes.form.hasAttribute("hidden")).toBe(false);
    expect(editor.notes.form.style.getPropertyValue("left")).toBe("200px");

    closeRenameEditor({ restoreFocus: false });
  });
});

describe("the module and the markup agree", () => {
  const rendered = renderCapabilityLogo({
    id: "notes",
    label: "Notes",
    display_label_override: null,
    incarnation_id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    logo: { status: "absent", attempts: 0 },
  });

  test("every hook the rules key off is on the element the server renders", () => {
    for (const hook of [
      "data-logo-slot",
      "data-capability-logo",
      "data-logo-label",
      "data-logo-menu",
      "data-logo-menu-rename",
      "data-capability-delete",
      "data-logo-rename",
      "data-logo-rename-input",
      "data-logo-rename-error",
      "data-logo-rename-cancel",
      'role="menu"',
      'role="menuitem"',
    ]) {
      expect(rendered, hook).toContain(hook);
    }
  });

  test("the menu carries two items and nothing else", () => {
    expect(rendered.split('role="menuitem"').length - 1).toBe(2);
    expect(rendered).toContain("Rename\n");
    expect(rendered).toContain("Delete\n");
  });

  test("the field stops where the validator stops", () => {
    expect(rendered).toContain(`maxlength="${MAX_CAPABILITY_LABEL_CHARS}"`);
  });

  test("the editor's reading of a name is the registry's reading of one", () => {
    const corpus = [
      "Notes",
      "Reading list",
      "  Journal  ",
      "",
      "   ",
      "Notes.",
      "Is this ok?",
      "Wow!",
      "I'll set that up",
      "Got it — making it now",
      "we will keep track of this",
      "one two three four five",
      "one two three four five six",
      "x".repeat(MAX_CAPABILITY_LABEL_CHARS),
      "x".repeat(MAX_CAPABILITY_LABEL_CHARS + 1),
    ];

    for (const name of corpus) {
      expect(isUsableCapabilityName(name), name).toBe(isCapabilityNameLabel(name));
      expect(labelNotice(name) === "", name).toBe(isCapabilityNameLabel(name));
    }
  });

  test("the floor it stops at is the prompt bar the desk actually ships", () => {
    const module = readFileSync(resolve("public/logo-menu.js"), "utf8");
    const bar = readFileSync(resolve("public/prompt-bar.js"), "utf8");

    expect(module).toContain(`const PROMPT_FORM_ID = "${PROMPT_FORM_ID}";`);
    // And the slot it speaks in, which stands above the rail and raises the floor with
    // whatever it is holding.
    const notice = /const PROMPT_NOTICE_ID = "([^"]+)";/.exec(module)?.[1];
    expect(notice).toBeDefined();
    expect(bar).toContain(`const PROMPT_NOTICE_ID = "${notice}";`);
  });
});
