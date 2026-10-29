// Taking a payload out of the developer panel: its controls, the Copy button, a copy of a
// selection, and select-all. `devpanel.dragging.test.ts` runs a drag and a payload held still.

import { describe, expect, test } from "bun:test";
import { clearStages, devPanelBody, writeStage } from "#design/desk/devpanel.js";
import {
  clipboardState,
  clock,
  copied,
  FakeElement,
  FakeEvent,
  type FakeText,
  fakeDocument,
  usePanelDom,
} from "./devpanel-dom.test-support.ts";
import { at, keyOn, opened, panelWith, SOURCE, UNITS } from "./devpanel-fixture.test-support.ts";

usePanelDom();

/** The copy settles on a resolved promise, which a turn of the event loop lets through. */
const settle = () => Bun.sleep(0);

/** What an element is called, read the way `aria-labelledby` reads it. */
function nameOf(panel: FakeElement, el: FakeElement) {
  const ids = el.getAttribute("aria-labelledby")?.split(" ") ?? [];
  const parts = ids.map((id) => shown(panel.querySelector(`[id="${id}"]`)));
  return parts.join(" ").trim();
}

/** An element's words, less any a screen reader is told to pass over. */
function shown(el: FakeElement | null): string {
  if (!el || el.getAttribute("aria-hidden") === "true") return "";
  return el.childNodes
    .map((child) => (child instanceof FakeElement ? shown(child) : child.textContent))
    .join("");
}

/** The word Copy is saying now, and the widest it keeps room for. */
const copyWord = (button: FakeElement) => shown(button);
const roomFor = (button: FakeElement) =>
  button.querySelector('[aria-hidden="true"]')?.textContent ?? "";

describe("the reader's controls", () => {
  test("each says what it does, and to which stage", () => {
    const { panel } = panelWith("spec", '{"a":1}');
    const names = new Set<string>();
    for (const block of panel.querySelectorAll(".devpanel__block")) {
      const stage = block.querySelector(".devpanel__stage")?.textContent ?? "";
      const fold = block.querySelector('[data-devpanel-action="fold"]') as FakeElement;
      // The fold is named by the stage's name it holds, once.
      expect(fold.textContent).toBe(stage);
      expect(fold.hasAttribute("aria-labelledby")).toBe(false);
      for (const control of block.querySelectorAll("[data-devpanel-action]")) {
        if (control === fold) continue;
        expect(control.tagName).toBe("BUTTON");
        expect(control.getAttribute("type")).toBe("button");
        const name = nameOf(panel, control);
        expect(name).toStartWith(shown(control));
        expect(name).toEndWith(stage);
        names.add(name);
      }
    }
    // Twenty-four controls, twenty-four names: no two Copy buttons sound alike.
    expect(names.size).toBe(24);
  });

  test("each well is a named region the keyboard can scroll, and no two share an id", () => {
    const { panel } = panelWith("spec", '{"a":1}');
    for (const block of panel.querySelectorAll(".devpanel__block")) {
      const pre = block.querySelector(".devpanel__pre") as FakeElement;
      const fold = block.querySelector('[data-devpanel-action="fold"]') as FakeElement;
      expect(pre.getAttribute("tabindex")).toBe("0");
      expect(pre.getAttribute("role")).toBe("region");
      expect(nameOf(panel, pre)).toBe(block.querySelector(".devpanel__stage")?.textContent ?? "");
      expect(fold.getAttribute("aria-controls")).toBe(pre.getAttribute("id"));
    }
    const ids = (root: FakeElement) =>
      root.descendants().flatMap((el) => el.getAttribute("id") ?? []);
    const other = devPanelBody() as unknown as FakeElement;
    const all = [...ids(panel), ...ids(other)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("each control does its one thing, and the payload itself is not a control", async () => {
    const { pre, code, control, press } = panelWith("units", UNITS);
    const before = copied.length;
    press(code.querySelector(".devpanel__lines") as FakeElement);
    expect(pre.hasAttribute("hidden")).toBe(false);
    expect(control("format").getAttribute("aria-pressed")).toBe("true");

    press(control("fold"));
    await settle();
    expect(copied).toHaveLength(before);
    // A collapsed block can still be copied or re-read, and stays collapsed while it is.
    press(control("copy"));
    press(control("format"));
    await settle();
    expect(copied).toHaveLength(before + 1);
    expect(pre.hasAttribute("hidden")).toBe(true);
    expect(control("format").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the Copy button", () => {
  test("copies what the well shows, folds opened, in the reading it is shown in", async () => {
    const { code, control, twist, press } = panelWith("units", UNITS);
    press(twist(at("units")));

    press(control("copy"));
    await settle();
    expect(copied.at(-1)).toBe(opened(JSON.parse(UNITS)));
    expect(copied.at(-1)).toBe(code.textContent);

    press(control("format"));
    press(control("copy"));
    await settle();
    expect(copied.at(-1)).toBe(UNITS);

    // And leaves whatever the reader had selected in the well where it was.
    fakeDocument.selection.selectAllChildren(code);
    press(control("copy"));
    await settle();
    expect(fakeDocument.selection.anchorNode).toBe(code);
  });

  test("says it copied, there and to a screen reader, for long enough to read", async () => {
    const { panel, block, control, press } = panelWith("units", UNITS);
    const status = panel.querySelector('[role="status"]') as FakeElement;
    const resting = copyWord(control("copy"));
    press(control("copy"));
    await settle();
    const said = copyWord(control("copy"));
    expect(said.trim()).not.toBe("");
    expect(said).not.toBe(resting);
    expect(status.textContent).toContain(said);
    expect(status.textContent).toContain(
      block.querySelector(".devpanel__stage")?.textContent ?? "missing",
    );

    // A second copy before the first one's word is gone keeps its own word for its full time.
    clock.advance(1000);
    press(control("copy"));
    await settle();
    clock.advance(600);
    expect(copyWord(control("copy"))).toBe(said);
    clock.advance(10_000);
    expect(copyWord(control("copy"))).toBe(resting);
    expect(status.textContent).toBe("");
  });

  test("leaves another block's word to that block, there and on the status line", async () => {
    const { panel, blockOf, control, press } = panelWith("units", UNITS);
    writeStage(panel, "spec", '{"a":1}');
    const status = panel.querySelector('[role="status"]') as FakeElement;
    press(control("copy"));
    await settle();
    clock.advance(1300);
    press(control("copy", blockOf("spec")));
    await settle();
    const spec = status.textContent;
    clock.advance(300);
    // Units' word has gone; what Spec said is still being said.
    expect(status.textContent).toBe(spec);
    clock.advance(10_000);
    expect(status.textContent).toBe("");
  });

  test("a clipboard that refuses is said to have refused", async () => {
    const { panel, control, press } = panelWith("units", UNITS);
    const status = panel.querySelector('[role="status"]') as FakeElement;
    const resting = copyWord(control("copy"));
    press(control("copy"));
    await settle();
    const copiedWord = copyWord(control("copy"));
    const copiedHeard = status.textContent;
    clipboardState.refuses = true;
    try {
      press(control("copy"));
      await settle();
    } finally {
      clipboardState.refuses = false;
    }
    const refused = copyWord(control("copy"));
    expect(refused.trim()).not.toBe("");
    expect(refused).not.toBe(resting);
    expect(refused).not.toBe(copiedWord);
    expect(status.textContent).not.toBe(copiedHeard);
    // Every word the button says fits in the room it keeps, so saying one never moves the caption.
    for (const word of [resting, copiedWord, refused]) {
      expect(word.length).toBeLessThanOrEqual(roomFor(control("copy")).length);
    }
  });

  test("a resting stage, and one a new build emptied, has nothing to copy", async () => {
    const { panel, blockOf, control, press } = panelWith("units", UNITS);
    const before = copied.length;
    press(control("copy", blockOf("gate")));
    clearStages(panel);
    press(control("copy"));
    await settle();
    expect(copied).toHaveLength(before);
  });
});

describe("a copy of a selection", () => {
  /** A copy as the browser sends it, with somewhere to put the text. */
  function copyEvent() {
    const put: string[] = [];
    const event = new FakeEvent("copy", {
      clipboardData: { setData: (type: string, text: string) => put.push(`${type} ${text}`) },
    });
    return { event: fakeDocument.dispatch(event), put };
  }

  test("inside a well takes the payload's own text, folds and all", () => {
    const { code, twist, press } = panelWith("units", UNITS);
    press(twist(at("units")));
    fakeDocument.selection.selectAllChildren(code);
    const { event, put } = copyEvent();
    expect(event.defaultPrevented).toBe(true);
    expect(put).toEqual([`text/plain ${opened(JSON.parse(UNITS))}`]);

    fakeDocument.selection.selectAllChildren(code.querySelector(".devpanel__lines") as FakeElement);
    expect(copyEvent().put).toEqual([`text/plain ${SOURCE}"`]);
  });

  test("takes just what is selected, and not the indent of the line it runs onto", () => {
    const { code, node } = panelWith("spec", JSON.stringify({ first: { a: 1 }, second: 2 }));
    const keyOf = (path: string) =>
      (node(path).querySelector(".devpanel__key") as FakeElement).childNodes[0] as FakeText;
    const second = code.querySelectorAll(".devpanel__key").at(-1) as FakeElement;
    const text = keyOf(at("first"));
    // From inside `"first":` to the start of the line that holds `"second"`.
    fakeDocument.selection.setBaseAndExtent(text, 1, second.childNodes[0] as FakeText, 0);
    const { put } = copyEvent();
    expect(put).toEqual(['text/plain first": {\n    "a": 1\n  },\n']);
  });

  test("keeps the indent of the line it starts at, which is drawn rather than selected", () => {
    const { node } = panelWith("units", UNITS);
    const rows = node(at("units", 0, "content")).querySelectorAll(".devpanel__codeline");
    const textOf = (row: number) => rows[row]?.childNodes.at(-1) as FakeText;
    fakeDocument.selection.setBaseAndExtent(textOf(2), 0, textOf(3), 1);
    expect(copyEvent().put).toEqual(["text/plain   return list();\n}"]);
  });

  test("anywhere else, or with nothing selected, or nowhere to put it, is the browser's", () => {
    const { panel, code } = panelWith("units", UNITS);
    fakeDocument.selection.selectAllChildren(panel);
    expect(copyEvent().event.defaultPrevented).toBe(false);
    fakeDocument.selection.removeAllRanges();
    expect(copyEvent().event.defaultPrevented).toBe(false);
    fakeDocument.selection.collapse(code);
    expect(copyEvent().event.defaultPrevented).toBe(false);
    fakeDocument.selection.selectAllChildren(code);
    expect(fakeDocument.dispatch(new FakeEvent("copy")).defaultPrevented).toBe(false);
  });
});

describe("select all", () => {
  test("⌘A or Ctrl+A anywhere in a block selects that block's payload and nothing else", () => {
    const { panel, pre, code, control } = panelWith("spec", '{"a":1}');
    writeStage(panel, "gate", '{"b":2}');

    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      fakeDocument.selection.removeAllRanges();
      expect(keyOn(pre, "a", modifier).defaultPrevented).toBe(true);
      expect(fakeDocument.selection.anchorNode).toBe(code);
    }
    fakeDocument.selection.removeAllRanges();
    keyOn(control("copy"), "A", { metaKey: true });
    expect(fakeDocument.selection.anchorNode).toBe(code);
    // A layout with no Latin A still has the key where A is.
    fakeDocument.selection.removeAllRanges();
    keyOn(pre, "ф", { metaKey: true, code: "KeyA" });
    expect(fakeDocument.selection.anchorNode).toBe(code);
  });

  test("every other key, and the same keys outside a block, are the page's to answer", () => {
    const { panel, pre } = panelWith("spec", '{"a":1}');
    fakeDocument.selection.removeAllRanges();
    expect(keyOn(pre, "a").defaultPrevented).toBe(false);
    expect(keyOn(pre, "c", { metaKey: true }).defaultPrevented).toBe(false);
    expect(keyOn(pre, "a", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(keyOn(pre, "a", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(keyOn(panel, "a", { metaKey: true }).defaultPrevented).toBe(false);
    expect(fakeDocument.selection.anchorNode).toBeNull();
  });

  test("a collapsed block shows nothing, so it selects nothing", () => {
    const { code, control, press } = panelWith("spec", '{"a":1}');
    fakeDocument.selection.selectAllChildren(code);
    press(control("fold"));
    expect(keyOn(control("fold"), "a", { metaKey: true }).defaultPrevented).toBe(true);
    expect(fakeDocument.selection.anchorNode).toBeNull();
  });
});
