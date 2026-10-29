// A press and a drag in a developer panel well, carried by the panel the way a text area carries
// one, and a payload that holds still while it is being selected. `devpanel.selecting.test.ts`
// runs copying.

import { describe, expect, test } from "bun:test";
import { clearStages, formatPayloadSize, RESTING_PAYLOAD } from "#design/desk/devpanel.js";
import {
  clock,
  type FakeElement,
  FakeEvent,
  FakeText,
  fakeDocument,
  usePanelDom,
} from "./devpanel-dom.test-support.ts";
import { at, CONTENT, opened, panelWith, SOURCE, UNITS } from "./devpanel-fixture.test-support.ts";

usePanelDom();

const page = fakeDocument.documentElement;
const BOX = { left: 100, top: 200, width: 300, height: 150 };
const selection = fakeDocument.selection;

/** A units well standing at `BOX` in a panel that shows all of it, and a press in it. */
function pressedWell(press: Partial<FakeEvent> = {}) {
  const panelled = panelWith("units", UNITS);
  panelled.pre.box = { ...BOX };
  fakeDocument.caret = () => ({ offsetNode: panelled.code, offset: 0 });
  const down = new FakeEvent("mousedown", { clientX: 150, clientY: 220, ...press });
  panelled.code.dispatchEvent(down);
  return { ...panelled, down };
}

const moveTo = (clientX: number, clientY: number, buttons = 1) =>
  fakeDocument.dispatch(new FakeEvent("mousemove", { clientX, clientY, buttons }));
const release = (button = 0) => fakeDocument.dispatch(new FakeEvent("mouseup", { button }));
const dragging = () => page.classList.contains("devpanel-selecting");

describe("a press in a well", () => {
  test("is the panel's: it puts the caret there and gives the well the focus", () => {
    selection.modified.length = 0;
    const { pre, code, down } = pressedWell();
    expect(down.defaultPrevented).toBe(true);
    expect(selection.anchorNode).toBe(code);
    expect(selection.isCollapsed).toBe(true);
    expect(fakeDocument.activeElement).toBe(pre);
    expect(fakeDocument.scrolledToFocus).toBe(false);
    // Focus a press gives, not the ring a keyboard's focus draws.
    expect(fakeDocument.ringed).toBe(false);
    expect(selection.modified).toEqual([]);
    // A press is not yet a drag: nothing is held and the page is not walled off.
    expect(dragging()).toBe(false);
    release();
  });

  test("picks the word on a second press and the line on a third, as the browser would", () => {
    const { code, node } = panelWith("units", UNITS);
    const text = new FakeText("let price = 0.25; don't");
    code.append(text);
    const picked = (at: { offsetNode: FakeText; offset: number }, detail: number) => {
      fakeDocument.caret = () => at;
      code.dispatchEvent(new FakeEvent("mousedown", { detail }));
      release();
      return selection.getRangeAt(0).cloneContents().textContent;
    };
    expect(picked({ offsetNode: text, offset: 6 }, 2)).toBe("price");
    expect(picked({ offsetNode: text, offset: 13 }, 2)).toBe("0.25");
    expect(picked({ offsetNode: text, offset: 20 }, 2)).toBe("don't");
    expect(picked({ offsetNode: text, offset: 10 }, 2)).toBe("=");
    expect(picked({ offsetNode: text, offset: 23 }, 2)).toBe("don't");
    // Read raw, a line runs between line breaks.
    expect(picked({ offsetNode: text, offset: 6 }, 3)).toBe(text.data);

    // A line of code, whole and with its indent; a member, up to what it opens.
    const rows = node(CONTENT).querySelectorAll(".devpanel__codeline");
    const indented = rows[2]?.childNodes.at(-1) as FakeText;
    expect(picked({ offsetNode: indented, offset: 3 }, 3)).toBe("  return list();");
    const units = node(at("units")).querySelector(".devpanel__key")?.childNodes[0] as FakeText;
    expect(picked({ offsetNode: units, offset: 2 }, 3)).toBe('  "units": [');

    // A second press that lands between nodes, not in text, has no word to take.
    fakeDocument.caret = () => ({ offsetNode: code, offset: 0 });
    code.dispatchEvent(new FakeEvent("mousedown", { detail: 2 }));
    expect(selection.isCollapsed).toBe(true);
    release();
  });

  test("grows a word at a time from a word, and a line at a time from a line, keeping it", () => {
    const { code, node } = panelWith("units", UNITS);
    const text = new FakeText("let price = 0.25; don't");
    code.append(text);
    const chosen = () => selection.getRangeAt(0).cloneContents().textContent;
    fakeDocument.caret = () => ({ offsetNode: text, offset: 6 });
    code.dispatchEvent(new FakeEvent("mousedown", { detail: 2 }));
    fakeDocument.caret = () => ({ offsetNode: text, offset: 20 });
    moveTo(150, 260);
    expect(chosen()).toBe("price = 0.25; don't");
    fakeDocument.caret = () => ({ offsetNode: text, offset: 1 });
    moveTo(150, 260);
    expect(chosen()).toBe("let price");
    fakeDocument.caret = () => ({ offsetNode: text, offset: 7 });
    moveTo(150, 260);
    expect(chosen()).toBe("price");
    release();

    const rows = node(CONTENT).querySelectorAll(".devpanel__codeline");
    const textOf = (row: number) => rows[row]?.childNodes.at(-1) as FakeText;
    fakeDocument.caret = () => ({ offsetNode: textOf(1), offset: 2 });
    code.dispatchEvent(new FakeEvent("mousedown", { detail: 3 }));
    fakeDocument.caret = () => ({ offsetNode: textOf(2), offset: 1 });
    moveTo(150, 260);
    expect(chosen()).toBe("export function read() {\n  return list();");
    release();
  });

  test("with shift carries a selection already in the well, and starts afresh from one outside", () => {
    const { panel, code } = panelWith("units", UNITS);
    fakeDocument.caret = () => ({ offsetNode: code, offset: 1 });
    selection.collapse(code, 0);
    code.dispatchEvent(new FakeEvent("mousedown", { shiftKey: true }));
    expect([selection.anchor?.offset, selection.focus?.offset]).toEqual([0, 1]);
    release();

    selection.collapse(panel.querySelector(".devpanel__stage") as FakeElement, 0);
    code.dispatchEvent(new FakeEvent("mousedown", { shiftKey: true }));
    expect(selection.anchorNode).toBe(code);
    expect(selection.isCollapsed).toBe(true);
    release();
  });
});

describe("a press the browser keeps", () => {
  test("is one on selected text, on a fold, off the payload, or with another button", () => {
    const { block, code, twist } = panelWith("units", UNITS);
    fakeDocument.caret = () => ({ offsetNode: code, offset: 0 });
    for (const [target, press, inSelection] of [
      [code, {}, true],
      [twist(""), {}, false],
      [block.querySelector(".devpanel__size") as FakeElement, {}, false],
      [code, { button: 2 }, false],
    ] as const) {
      // Only the first lands in a selection; each of the rest is the browser's for its own reason.
      if (inSelection) selection.selectAllChildren(code);
      else selection.collapse(code, 0);
      const down = new FakeEvent("mousedown", press);
      target.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
      moveTo(150, 400);
      expect(dragging()).toBe(false);
    }
  });

  test("is one on the well's own scrollbar", () => {
    const { code } = panelWith("units", UNITS);
    selection.removeAllRanges();
    fakeDocument.caret = () => ({ offsetNode: code, offset: 0 });
    for (const [clientX, clientY] of [
      [400, 10],
      [10, 300],
    ]) {
      const down = new FakeEvent("mousedown", { clientX, clientY });
      code.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
    }
    const inside = new FakeEvent("mousedown", { clientX: 399, clientY: 299 });
    code.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(true);
    release();
  });

  test("is not one outside a selection made elsewhere", () => {
    const { panel, code } = panelWith("units", UNITS);
    selection.selectAllChildren(panel.querySelector(".devpanel__stage") as FakeElement);
    fakeDocument.caret = () => null;
    const down = new FakeEvent("mousedown");
    code.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    release();
  });
});

describe("a drag in a well", () => {
  test("follows the pointer held inside the well's edges, and scrolls while it is past one", () => {
    const { pre } = pressedWell();
    // Past the bottom edge, over the next block's caption: the end stays on the well's last line.
    expect(moveTo(150, 400).defaultPrevented).toBe(true);
    expect(dragging()).toBe(true);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: 150, y: BOX.top + BOX.height - 1 });
    expect(selection.extended).not.toBeNull();

    clock.advance(100);
    const early = pre.scrollTop;
    clock.advance(100);
    expect(early).toBeGreaterThan(0);
    expect(pre.scrollTop).toBeGreaterThan(early);

    // Back inside, the scrolling stops and the end is where the pointer is.
    moveTo(160, 260);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: 160, y: 260 });
    const stopped = pre.scrollTop;
    const asked = fakeDocument.askedCaret.length;
    clock.advance(200);
    expect(pre.scrollTop).toBe(stopped);
    // And stays stopped: nothing more is asked of the page until the pointer moves again.
    expect(fakeDocument.askedCaret.length).toBe(asked);

    // Above the top and off to either side: up it goes, the end kept to the well's edges.
    moveTo(900, 100);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: BOX.left + BOX.width - 1, y: BOX.top + 1 });
    moveTo(20, 100);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: BOX.left + 1, y: BOX.top + 1 });
    clock.advance(100);
    expect(pre.scrollTop).toBeLessThan(stopped);
    release();
  });

  test("keeps to the part of the well the panel shows, when the panel has scrolled some away", () => {
    const { panel, pre } = pressedWell();
    pre.scrollTop = 500;
    panel.box = { left: 0, top: 260, width: 2000, height: 50 };
    moveTo(150, 400);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: 150, y: 309 });
    moveTo(150, 230);
    expect(fakeDocument.askedCaret.at(-1)).toEqual({ x: 150, y: 261 });
    clock.advance(100);
    expect(pre.scrollTop).toBeLessThan(500);

    // A well scrolled wholly out of sight, either way, has nowhere to put the selection.
    const asked = fakeDocument.askedCaret.length;
    panel.box = { left: 0, top: 900, width: 2000, height: 50 };
    moveTo(150, 400);
    panel.box = { left: 900, top: 0, width: 50, height: 2000 };
    moveTo(150, 400);
    expect(fakeDocument.askedCaret.length).toBe(asked);
    release();
  });

  test("scrolls the panel once the well can go no further and more of it is out of sight", () => {
    const { panel, pre } = pressedWell();
    pre.maxScroll = 0;
    panel.box = { left: 0, top: 0, width: 2000, height: 300 };
    moveTo(150, 400);
    clock.advance(16 * 3);
    expect(panel.scrollTop).toBeGreaterThan(0);
    release();

    // With all of the well in sight, there is nothing more to bring in.
    const shown = pressedWell();
    shown.pre.maxScroll = 0;
    moveTo(150, 400);
    clock.advance(16 * 3);
    expect(shown.panel.scrollTop).toBe(0);
    release();
  });

  test("moves the selection only to a caret in its own well, and only once there is one", () => {
    const { panel, code } = pressedWell();
    const elsewhere = panel.querySelector('.devpanel__block[data-stage="gate"] .devpanel__code');
    selection.extended = null;
    fakeDocument.caret = () => null;
    moveTo(150, 260);
    fakeDocument.caret = () => ({ offsetNode: elsewhere as FakeElement, offset: 0 });
    moveTo(150, 260);
    expect(selection.extended).toBeNull();

    // A caret in the well, but no selection left to move: nothing to extend, and nothing thrown.
    fakeDocument.caret = () => ({ offsetNode: code, offset: 0 });
    selection.removeAllRanges();
    expect(() => moveTo(150, 260)).not.toThrow();
    expect(selection.extended).toBeNull();
    release();
  });

  test("finds the caret either way a browser reports it", () => {
    const { code } = pressedWell();
    const asked: number[][] = [];
    Object.assign(fakeDocument, {
      caret: undefined,
      caretRangeFromPoint: (x: number, y: number) => {
        asked.push([x, y]);
        return { startContainer: code, startOffset: 3 };
      },
    });
    try {
      moveTo(160, 260);
      expect(asked).toEqual([[160, 260]]);
      expect(selection.extended).toEqual({ node: code, offset: 3 });
    } finally {
      Object.assign(fakeDocument, { caret: () => null, caretRangeFromPoint: undefined });
      release();
    }
  });

  test("carries the selection as the well scrolls, whoever scrolls it", () => {
    const { pre } = pressedWell();
    // Scrolled before the pointer has moved, there is no drag yet to carry.
    const before = fakeDocument.askedCaret.length;
    pre.dispatchEvent(new FakeEvent("scroll"));
    expect(fakeDocument.askedCaret.length).toBe(before);
    moveTo(150, 400);
    const asked = fakeDocument.askedCaret.length;
    clock.advance(16 * 3);
    expect(fakeDocument.askedCaret.length).toBe(asked + 3);
    moveTo(150, 260);
    pre.dispatchEvent(new FakeEvent("scroll"));
    expect(fakeDocument.askedCaret.length).toBe(asked + 5);
    release();
  });
});

describe("the scrolling under a drag", () => {
  /** How far the well has scrolled after the pointer has stood `past` below it for `frames`. */
  const scrolled = (past: number, frames: number, moves = 1, frameMs = 16) => {
    clock.frameMs = frameMs;
    try {
      const { pre } = pressedWell();
      for (let move = 0; move < moves; move += 1) moveTo(150, BOX.top + BOX.height + past);
      clock.advance(frameMs * frames);
      release();
      return pre.scrollTop;
    } finally {
      clock.frameMs = 16;
    }
  };

  test("keeps step with how far past the edge and for how long, up to a limit", () => {
    const one = scrolled(25, 1);
    expect(one).toBeGreaterThan(0);
    expect(scrolled(50, 1)).toBe(one * 2);
    expect(scrolled(25, 2)).toBe(one * 2);
    // Moving the pointer more often does not scroll any faster.
    expect(scrolled(25, 2, 5)).toBe(one * 2);
    // Far past the edge asks for nothing faster than a little past it.
    expect(scrolled(400, 1)).toBe(scrolled(200, 1));
    // A tenth of a second just past the edge is a line or two: neither nothing nor a page.
    expect(scrolled(30, 6)).toBeGreaterThan(16);
    expect(scrolled(30, 6)).toBeLessThan(BOX.height / 2);
    // Just past the edge it still moves, the fractions of a pixel adding up.
    expect(scrolled(1, 20)).toBeGreaterThan(0);
  });

  test("keeps its pace when frames come late, and does not leap after a stall", () => {
    // The first frame has no frame before it to measure from, so the comparison starts after it.
    const steady = scrolled(25, 3);
    // Nor does a frame after the pointer has been back inside a while: it starts afresh.
    const { pre } = pressedWell();
    moveTo(150, BOX.top + BOX.height + 25);
    clock.advance(16);
    const first = pre.scrollTop;
    moveTo(150, 260);
    clock.advance(1000);
    moveTo(150, BOX.top + BOX.height + 25);
    clock.advance(16);
    release();
    expect(pre.scrollTop).toBe(first * 2);
    expect(scrolled(25, 3, 1, 32)).toBe(steady + (steady / 3) * 2);
    expect(scrolled(25, 3, 1, 1000)).toBe(scrolled(25, 3, 1, 50));
  });
});

describe("the end of a drag", () => {
  test("comes with the main button's release, a menu, a lost window, or a move with no button", () => {
    const endings: Record<string, () => void> = {
      mouseup: () => release(),
      pointercancel: () => fakeDocument.dispatch(new FakeEvent("pointercancel")),
      contextmenu: () => fakeDocument.dispatch(new FakeEvent("contextmenu")),
      buttons: () => moveTo(150, 400, 0),
      blur: () => fakeDocument.defaultView.dispatch(new FakeEvent("blur")),
    };
    for (const [ending, end] of Object.entries(endings)) {
      const { pre } = pressedWell();
      moveTo(150, 400);
      end();
      expect(dragging(), ending).toBe(false);
      for (const type of ["mousemove", "mouseup", "pointercancel", "contextmenu"]) {
        expect(fakeDocument.listening(type), `${ending}: ${type}`).toBe(0);
      }
      expect(pre.listening("scroll"), ending).toBe(0);
      expect(fakeDocument.defaultView.listening("blur"), ending).toBe(0);
      const resting = pre.scrollTop;
      clock.advance(500);
      expect(pre.scrollTop, ending).toBe(resting);
      expect(moveTo(150, 400).defaultPrevented, ending).toBe(false);
    }
  });

  test("not with another button's release, and a new press ends the old drag first", () => {
    pressedWell();
    moveTo(150, 400);
    release(2);
    expect(dragging()).toBe(true);
    pressedWell();
    expect(fakeDocument.listening("mousemove")).toBe(1);
    release();
    expect(fakeDocument.listening("mousemove")).toBe(0);
  });
});

describe("a payload being selected holds still", () => {
  const later = JSON.stringify({ status: "complete", units: [] });

  test("while a drag selects in it, and while what it selected lasts", () => {
    const { block, code, write } = pressedWell();
    const size = () => block.querySelector(".devpanel__size")?.textContent;
    moveTo(160, 260);
    write(later);
    expect(code.textContent).toContain(SOURCE);
    expect(block.classList.contains("is-held")).toBe(true);
    // The caption speaks for what is shown, not for what is waiting.
    expect(size()).toBe(formatPayloadSize(UNITS));

    selection.selectAllChildren(code.querySelector(".devpanel__lines") as FakeElement);
    release();
    expect(code.textContent).toContain(SOURCE);

    selection.removeAllRanges();
    fakeDocument.dispatch(new FakeEvent("selectionchange"));
    expect(code.textContent).toBe(opened(JSON.parse(later)));
    expect(block.classList.contains("is-held")).toBe(false);
    expect(size()).toBe(formatPayloadSize(later));
    expect(fakeDocument.listening("selectionchange")).toBe(1);
  });

  test("from the press, so what lands mid-press waits, and a click on a fold's count still lands", () => {
    const { block, code, node, press, folded, twist, write } = pressedWell();
    release();
    press(twist(at("units")));
    // Its own count, a child of its own; the first one inside it belongs to a fold it holds.
    const countOf = () =>
      node(at("units")).children.find((part) =>
        part.classList.contains("devpanel__elided"),
      ) as FakeElement;
    const count = countOf();
    count.dispatchEvent(new FakeEvent("mousedown"));
    const caret = selection.anchor;
    write(JSON.stringify({ status: "complete", units: [...JSON.parse(UNITS).units, {}] }));
    expect(block.classList.contains("is-held")).toBe(true);
    expect(selection.anchor).toBe(caret);
    expect(code.textContent).toContain(SOURCE);
    // Released: the newer payload comes in, and the count pressed is still the one there.
    release();
    expect(block.classList.contains("is-held")).toBe(false);
    expect(countOf()).toBe(count);
    press(count);
    expect(folded(at("units"))).toBe(false);
  });

  test("never for a panel that has been put away", () => {
    const { panel, code, write } = panelWith("units", UNITS);
    selection.selectAllChildren(code);
    write(later);
    panel.detached = true;
    selection.removeAllRanges();
    fakeDocument.dispatch(new FakeEvent("selectionchange"));
    expect(code.textContent).toContain(SOURCE);
    panel.detached = false;
    fakeDocument.dispatch(new FakeEvent("selectionchange"));
    expect(code.textContent).toContain(SOURCE);
  });

  test("until the reader asks for the latest, which lets go and puts them back in the well", () => {
    const { block, pre, code, control, press, write } = pressedWell();
    moveTo(160, 260);
    write(later);
    selection.selectAllChildren(code);
    release();
    control("latest").focus();
    press(control("latest"));
    expect(code.textContent).toBe(opened(JSON.parse(later)));
    expect(block.classList.contains("is-held")).toBe(false);
    expect(selection.anchorNode).toBeNull();
    expect(fakeDocument.activeElement).toBe(pre);
  });

  test("not when the selection runs past the well, and no longer once the block is closed", () => {
    const { panel, block, code, control, press, write } = panelWith("units", UNITS);
    selection.selectAllChildren(panel);
    write(later);
    expect(code.textContent).toBe(opened(JSON.parse(later)));
    // From inside the well to another block's: not reading this one.
    selection.collapse(code);
    selection.extend(panel.querySelector(".devpanel__stage") as FakeElement, 0);
    write(UNITS);
    expect(code.textContent).toBe(opened(JSON.parse(UNITS)));

    selection.selectAllChildren(code);
    write(later);
    expect(block.classList.contains("is-held")).toBe(true);
    press(control("fold"));
    expect(block.classList.contains("is-held")).toBe(false);
    expect(code.textContent).toBe(opened(JSON.parse(later)));
  });

  test("a drag that ends with nothing selected lets the newest payload in at once", () => {
    const { code, write } = pressedWell();
    moveTo(160, 260);
    write(later);
    selection.removeAllRanges();
    release();
    expect(code.textContent).toBe(opened(JSON.parse(later)));
  });

  test("a new build empties a held block, and the hold lets nothing old back in", () => {
    const { panel, block, code, write } = pressedWell();
    moveTo(160, 260);
    write(later);
    clearStages(panel);
    expect(block.classList.contains("is-held")).toBe(false);
    selection.removeAllRanges();
    release();
    expect(code.textContent).toBe(RESTING_PAYLOAD);
  });
});
