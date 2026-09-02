import { afterAll, describe, expect, test } from "bun:test";

import { seedFrom } from "#design/lib/random.js";
import { recordInkSeed } from "../records/ink-seed.ts";
import { ITEM_TRIGGER_CLASS } from "../records/list-container.ts";
import { installFakeDom } from "./ink.test-support.ts";

// The globals have to exist before the ink system is evaluated — it builds its two
// observers at module scope — so the import is deferred rather than hoisted.
const dom = installFakeDom();
const { drawAlso, mountAllInk, mountInk, unmountInk } = await import("#design/ink.js");

// The fakes are process-wide while they are installed, and the shell's own browser
// modules install themselves the moment a `document` exists. Hand them back.
afterAll(() => dom.restore());

type Drawn = ReturnType<typeof dom.element>;

function drawn(tagName: string, className: string, parent?: Drawn): Drawn {
  const el = dom.element(tagName, className);
  if (parent) parent.append(el);
  el.box = { w: 220, h: 36 };
  el.borderWidth = 2;
  return el;
}

/** The second child is the front layer — the one carrying the two stroke passes. */
function inkOf(el: Drawn): string {
  const layer = el.children.find((child) => child.matches(".ink__layer"));
  if (!layer) throw new Error("Not drawn: no ink layer.");
  return layer.innerHTML;
}

describe("the ink system draws the surface's own boundaries", () => {
  test("resize is watched once per container rather than once per drawn element", () => {
    const list = dom.element("div", "records");
    const cards = Array.from({ length: 8 }, () => drawn("article", "record", list));
    for (const card of cards) mountInk(card);

    expect(dom.resizeObservations()).toEqual([list]);
    for (const card of cards) expect(dom.resizeObservations()).not.toContain(card);

    // And the container is released the moment it loses its last drawn child, so a
    // list that is swapped away takes its observation with it.
    for (const card of cards.slice(0, -1)) unmountInk(card);
    expect(dom.resizeObservations()).toEqual([list]);
    unmountInk(cards.at(-1) as Drawn);
    expect(dom.resizeObservations()).toEqual([]);
  });

  test("a container resize redraws the children it holds", () => {
    const list = dom.element("div", "records");
    const card = drawn("article", "record", list);
    mountInk(card);
    const before = inkOf(card);

    card.box = { w: 420, h: 36 };
    dom.resize(list);
    dom.frame();

    expect(inkOf(card)).not.toBe(before);
  });

  test("hierarchy rides on the hand, at one weight throughout", () => {
    const rail = drawn("div", "prompt-bar");
    rail.properties["--ink-hand"] = "frame";
    const button = drawn("button", "btn");
    const mark = drawn("span", "choice__mark");
    mark.properties["--ink-hand"] = "close";
    mark.box = { w: 22, h: 22 };
    for (const el of [rail, button, mark]) mountInk(el);

    const hands = [inkOf(rail), inkOf(button), inkOf(mark)];
    expect(new Set(hands).size).toBe(3);
    for (const hand of hands) {
      expect(hand).toContain('stroke-width="2"');
      expect(hand).not.toMatch(/stroke-width="(?!2")/);
    }
  });

  test("a drawn boundary survives a re-render without the hand changing", () => {
    const button = drawn("button", "btn");
    mountInk(button);
    const seed = button.dataset.inkSeed;
    const before = inkOf(button);

    // What `el.textContent = "Making it"` does: every child goes, the two layers with
    // them, leaving a transparent border and no line at all.
    const layers = [...button.children];
    for (const layer of layers) layer.remove();
    dom.mutate({ type: "childList", target: button, removed: layers });

    expect(button.dataset.inkSeed).toBe(seed);
    expect(inkOf(button)).toBe(before);
  });

  test("a control resized by its neighbour is redrawn without being observed itself", () => {
    const rail = dom.element("div", "prompt__composer");
    const field = drawn("div", "field__control", rail);
    const submit = drawn("button", "btn", rail);
    for (const el of [field, submit]) mountInk(el);
    const before = inkOf(field);

    // The submit's label grows, the field beside it gives up the room, and the rail's
    // own box never changes — so no resize is reported anywhere.
    const label = dom.element("span", "label");
    submit.append(label);
    field.box = { w: 160, h: 36 };
    dom.mutate({ type: "childList", target: label, added: [label] });
    dom.frame();

    expect(inkOf(field)).not.toBe(before);
  });

  test("a control shown by an attribute gets its first line", () => {
    const bar = dom.element("div", "desk__logos");
    const toggle = drawn("button", "btn", bar);
    toggle.box = { w: 0, h: 0 };
    mountInk(toggle);
    expect(toggle.children.every((child) => child.innerHTML === "")).toBe(true);

    toggle.box = { w: 40, h: 40 };
    dom.mutate({ type: "attributes", target: toggle });
    dom.frame();

    expect(inkOf(toggle)).toContain('stroke-width="2"');
  });

  test("a control mounted before it can be measured costs nothing until it is drawn", () => {
    // Anything mounted inside a `display: none` subtree measures zero, so the first draw
    // is the resize watch's. Until then the element must keep its own border and its
    // layers must take no room: an `<svg>` with no size of its own is 300 by 150, which
    // in flow widens its host and out of flow overflows whatever holds it.
    const bar = dom.element("div", "desk__logos");
    const toggle = drawn("button", "btn", bar);
    toggle.box = { w: 0, h: 0 };
    mountInk(toggle);

    expect(toggle.classes.has("is-ink")).toBe(false);
    for (const child of toggle.children) {
      expect(child.style.position).toBe("absolute");
      expect(child.style.width).toBe("0");
      expect(child.style.height).toBe("0");
    }

    toggle.box = { w: 40, h: 40 };
    dom.mutate({ type: "attributes", target: toggle });
    dom.frame();

    // The border is handed over at the same moment the line replaces it, never before.
    expect(toggle.classes.has("is-ink")).toBe(true);
    for (const child of toggle.children) expect(child.style.height).toBe("40px");
  });

  test("an element that cannot hold the layers is left ruled rather than blanked", () => {
    const input = drawn("input", "field__control");
    mountInk(input);

    expect(input.classes.has("is-ink")).toBe(false);
    expect(input.children).toEqual([]);
  });

  test("the host's own chrome joins the system's selector", () => {
    const rail = drawn("div", "prompt__composer");
    mountAllInk(dom.body);
    expect(rail.classes.has("is-ink")).toBe(false);

    drawAlso(".prompt__composer");
    mountAllInk(dom.body);
    expect(rail.classes.has("is-ink")).toBe(true);
  });
});

/** The seed the ink system settled on for one element, as a string. */
function seedOf(el: Drawn): string {
  const seed = el.dataset.inkSeed;
  if (seed === undefined) throw new Error("No seed on the element.");
  return seed;
}

/** One records region holding `ids.length` cards, shaped like the shipped markup. */
function collection(ids: readonly string[]) {
  const list = dom.element("div", "capability-records");
  const cards = ids.map((id) => {
    const card = dom.element("article", ITEM_TRIGGER_CLASS);
    list.append(card);
    card.dataset.inkSeed = String(recordInkSeed(id));
    card.box = { w: 420, h: 96 };
    card.borderWidth = 2;
    return card;
  });
  return { list, cards };
}

describe("the ink system draws the records the platform hands it", () => {
  test("a records region is one observation, however many cards it holds", () => {
    drawAlso(`.${ITEM_TRIGGER_CLASS}`);
    const before = dom.resizeObservations().length;
    const { list, cards } = collection(Array.from({ length: 200 }, (_, i) => `record-${i}`));
    mountAllInk(list);

    expect(cards.every((card) => card.classes.has("is-ink"))).toBe(true);
    // Two hundred cards, one observation — the region, never a card. This is the whole
    // cost argument: the children of a list resize together, so watching each one buys
    // nothing and is what would show up on a long list.
    expect(dom.resizeObservations()).toContain(list);
    expect(dom.resizeObservations().length).toBe(before + 1);
    for (const card of cards) expect(dom.resizeObservations()).not.toContain(card);

    for (const card of cards) unmountInk(card);
    expect(dom.resizeObservations()).not.toContain(list);
    expect(dom.resizeObservations().length).toBe(before);
  });

  test("the card is drawn in the hand the platform chose, not in mount order", () => {
    drawAlso(`.${ITEM_TRIGGER_CLASS}`);
    const ids = ["dune", "solaris", "piranesi"];
    const { list, cards } = collection(ids);
    mountAllInk(list);

    for (const [index, card] of cards.entries()) {
      expect(seedOf(card)).toBe(String(seedFrom(ids[index] as string)));
    }
    expect(new Set(cards.map(inkOf)).size).toBe(3);
  });

  test("a resize redraws the card at the new size without re-rolling its hand", () => {
    drawAlso(`.${ITEM_TRIGGER_CLASS}`);
    const { list, cards } = collection(["dune"]);
    const card = cards[0] as Drawn;
    mountAllInk(list);

    const before = inkOf(card);
    const seed = seedOf(card);

    card.box = { w: 640, h: 96 };
    dom.resize(list);
    dom.frame();

    expect(inkOf(card)).not.toBe(before);
    expect(seedOf(card)).toBe(seed);
  });
});

// Where the two layers sit, which is a different question from what they draw.
//
// They are absolutely positioned, so the drawn element has to be their containing block.
// Get that wrong and the boundary is drawn at the right size, in the right shape, in some
// ancestor's corner — a button's line painted at the top-left of the window while the
// button stands at the bottom-right.
describe("the box the layers sit in", () => {
  test("a control mounted off-document still gets the box its layers sit in", () => {
    // The layers are absolutely positioned, so the element they belong to has to be the
    // containing block. A detached element has no computed style — every property is the
    // empty string, `position` included — so the ask at mount cannot be answered, and an
    // element mounted before it is in the document is exactly what an out-of-band swap
    // produces. Unanswered, its layers belong to whatever containing block is above it
    // and are drawn in *that* element's corner: right size, right shape, nowhere near
    // the thing they are the boundary of. Seen in a browser as a button's boundary
    // painted at the top-left of the window while the button sat at the bottom-right.
    const loose = dom.element("button", "btn");
    loose.box = { w: 84, h: 36 };
    loose.remove(); // off-document, the way an out-of-band swap's element arrives
    expect(loose.isConnected).toBe(false);
    mountInk(loose);

    // Put into the document and drawn.
    const bar = dom.element("div", "build-stream");
    bar.append(loose);
    dom.mutate({ type: "attributes", target: loose });
    dom.frame();

    expect(loose.style.position).toBe("relative");
    expect(loose.classes.has("is-ink")).toBe(true);
  });

  test("a control that positions itself is never overridden", () => {
    const held = drawn("button", "btn", dom.body);
    held.position = "absolute";
    held.box = { w: 40, h: 40 };
    mountInk(held);
    dom.frame();

    expect(held.style.position).toBeUndefined();
  });
});
