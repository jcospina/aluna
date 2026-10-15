// The chooser keeps the select-only keyboard the picker had before it searched: a typed letter
// jumps to the next option starting with it and nothing is hidden, Space and Enter pick, Home and
// End walk to the ends, and the field's own input, which the chain sits in, searches nothing. Run
// through the shipped `public/controls/link-control.js`.

import { describe, expect, test } from "bun:test";
import { NO_RESULTS } from "#design/controls/listbox-search.js";
import type { El } from "../double/choice-picker.test-support.ts";
import {
  chooserTarget,
  installLinkGlobals,
  linkScene,
  listed,
  type Reply,
  settle,
  written,
} from "./link-control.test-support.ts";

installLinkGlobals();

const FIELDS = [
  chooserTarget("authors", "Authors", { name: "name", label: "Name" }),
  chooserTarget("authors", "Authors", { name: "nickname", label: "Nickname" }),
  chooserTarget("authors", "Authors", { name: "born", label: "Birthplace" }),
];

async function opened(...after: Reply[]) {
  const scene = await linkScene([listed({ groups: [FIELDS] }), ...after]);
  await scene.press(scene.button);
  const active = () => scene.button.getAttribute("aria-activedescendant");
  const idOf = (label: string) =>
    scene.options().find((option) => option.textContent.trim() === label)?.id ?? null;
  const type = (key: string, extra: Record<string, unknown> = {}) =>
    scene.doc.fire("keydown", scene.button, { key, ...extra });
  return { ...scene, active, idOf, type };
}

/** `run` with `Date.now` reading a clock the test moves, put back exactly as it was afterwards. */
async function atTimes(run: (after: (ms: number) => void) => Promise<void>) {
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

describe("a typed letter jumps, and hides nothing", () => {
  test("one letter goes to the next option starting with it, and repeating it cycles", async () => {
    await atTimes(async () => {
      const scene = await opened();
      expect(scene.active()).toBe(scene.idOf("Name"));
      scene.type("n");
      expect(scene.active()).toBe(scene.idOf("Nickname"));
      scene.type("n");
      expect(scene.active()).toBe(scene.idOf("Name"));
    });
  });

  test("a growing word searches from the top for the longer match", async () => {
    await atTimes(async () => {
      const scene = await opened();
      scene.type("b");
      scene.type("n");
      expect(scene.active()).toBe(scene.idOf("Birthplace"));
      const again = await opened();
      again.type("n");
      again.type("i");
      expect(again.active()).toBe(again.idOf("Nickname"));
    });
  });

  test("a pause longer than the typing window starts a new word; exactly the window does not", async () => {
    await atTimes(async (after) => {
      // "bn" names nothing, so the active row stays; a new "n" jumps on to Name.
      const scene = await opened();
      scene.type("b");
      after(701);
      scene.type("n");
      expect(scene.active()).toBe(scene.idOf("Name"));

      const again = await opened();
      again.type("b");
      after(700);
      again.type("n");
      expect(again.active()).toBe(again.idOf("Birthplace"));
    });
  });

  test("a letter held with Cmd, Ctrl or Alt is a shortcut, never a jump", async () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"]) {
      const scene = await opened();
      scene.type("n", { [modifier]: true });
      expect(scene.active()).toBe(scene.idOf("Name"));
    }
  });

  test("a letter nothing starts with leaves every option shown, and says nothing", async () => {
    const scene = await opened();
    scene.type("z");
    expect(scene.options().every((option: El) => !option.hidden)).toBe(true);
    expect(scene.panel.textContent).not.toContain(NO_RESULTS);
    expect(scene.active()).toBe(scene.idOf("Name"));
  });

  test("typing in the field the chain sits in leaves the chooser as it was", async () => {
    const scene = await opened();
    scene.input.value = "bir";
    scene.doc.fire("input", scene.input);
    expect(scene.options().every((option: El) => !option.hidden)).toBe(true);
    expect(scene.active()).toBe(scene.idOf("Name"));
  });
});

describe("the keys that walk and pick", () => {
  test("Home and End go to the ends, and the keys keep their browser meaning to themselves", async () => {
    const scene = await opened();
    expect(scene.type("End").prevented).toBe(true);
    expect(scene.active()).toBe(scene.idOf("Birthplace"));
    expect(scene.type("Home").prevented).toBe(true);
    expect(scene.active()).toBe(scene.idOf("Name"));
  });

  test("Space picks the active option, as Enter does", async () => {
    const scene = await opened(written);
    scene.type("ArrowDown");
    expect(scene.type(" ").prevented).toBe(true);
    await settle();
    expect(scene.exchanges[1]?.body).toBe((FIELDS[1]?.press as URLSearchParams).toString());
  });

  test("the window resizing closes it, since nothing it measured still holds", async () => {
    const scene = await opened();
    expect(scene.panel.hidden).toBe(false);
    scene.doc.fire("resize", scene.doc);
    expect(scene.panel.hidden).toBe(true);
  });
});
