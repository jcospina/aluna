import { describe, expect, test } from "bun:test";
import { BUILD_JOB_ID_ATTRIBUTE } from "#shell/core/shell-dom.js";
import {
  BUILD_NARRATION_REGION_ID,
  buildIdFromEvent,
  DESK_LOGO_LAYER_ID,
  PROVISIONAL_LOGO_ATTRIBUTE,
  removeProvisionalLogo,
  revealBuildNarration,
  startDeskLogos,
  startLogoLayerScroll,
} from "#shell/desk/logos/desk-logos.js";
import { WINDOW_CONTENT_ID } from "#shell/desk/window/desk-window.js";
import {
  DESK_LOGO_LAYER_ELEMENT_ID,
  renderBuildSubscriber,
  renderProvisionalLogo,
} from "../../../server/http/fragments/fragments.ts";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { El as ParsedEl, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { startedOn } from "../../controls/double/started-module.test-support.ts";
import { readSource } from "../../safety/source.test-support.ts";

/**
 * A document small enough to run the tile's rules in Bun. They need four DOM facts: find a node
 * by attribute, find one by id, remove one, and receive an event.
 */
class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  scrolled = false;
  focused = false;

  constructor(readonly attributes: Record<string, string> = {}) {}

  append(...nodes: Node[]): this {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  scrollIntoView(): void {
    this.scrolled = true;
  }

  focus(): void {
    this.focused = true;
  }

  readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: LogoEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  closest(selector: string): Node | null {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  matches(selector: string): boolean {
    const exact = /^\[([a-z-]+)="(.*)"\]$/s.exec(selector);
    if (exact)
      return this.getAttribute(exact[1] as string) === (exact[2] as string).replace(/\\(.)/g, "$1");
    const present = /^\[([a-z-]+)\]$/.exec(selector);
    if (present) return this.getAttribute(present[1] as string) !== null;
    throw new Error(`Unsupported selector: ${selector}`);
  }

  *descendants(): Generator<Node> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
}

type LogoEvent = { target?: unknown; detail?: { type?: string } };
type Listener = (event: LogoEvent) => void;

class FakeDocument extends Node {
  querySelectorAll(selector: string): Node[] {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  getElementById(id: string): Node | null {
    for (const node of this.descendants()) if (node.getAttribute("id") === id) return node;
    return null;
  }
}

/** Server markup carried into this document, node for node, attributes and all. */
function adopt(from: ParsedEl): Node {
  return new Node({ ...from.attributes }).append(
    ...from.children.filter((child) => child.tag !== "#text").map(adopt),
  );
}

const served = (html: string) =>
  parseHtml(html, new ParsedEl("div"))
    .children.filter((child) => child.tag !== "#text")
    .map(adopt);

/** A desk with one build in flight: its tile on the ground, its subscriber in the output. */
function deskWithBuild(buildId: string) {
  const root = new FakeDocument();
  // The tile rides in out of band, and what lands on the layer is the logo it carries.
  const [carrier] = served(renderProvisionalLogo(buildId));
  const tile = [...(carrier as Node).descendants()].find((node) =>
    node.hasAttribute(PROVISIONAL_LOGO_ATTRIBUTE),
  );
  const layer = new Node({ id: DESK_LOGO_LAYER_ELEMENT_ID }).append(tile as Node);
  const [subscriber] = served(renderBuildSubscriber(buildId));
  const narration = [...(subscriber as Node).descendants()].find((node) =>
    (node.getAttribute("class") ?? "").includes("narration"),
  ) as Node;
  const output = new Node({ id: WINDOW_CONTENT_ID }).append(subscriber as Node);
  root.append(layer, output);
  return { root, tile: tile as Node, layer, narration, subscriber: subscriber as Node, output };
}

describe("the tile an admitted build stands on the desk", () => {
  test("one build's tile comes down and no other is touched", () => {
    const { root, layer } = deskWithBuild("build-1");
    layer.append(new Node({ [PROVISIONAL_LOGO_ATTRIBUTE]: "build-2" }));

    expect(removeProvisionalLogo(root, "build-1")).toBe(true);
    expect(layer.children.map((node) => node.getAttribute(PROVISIONAL_LOGO_ATTRIBUTE))).toEqual([
      "build-2",
    ]);
  });

  test("a build that never stood one up removes nothing and says nothing", () => {
    // An evolution uses the capability's existing logo, and a deflection admitted nothing
    // at all. Both reach a terminal, and both must pass through the cleanup harmlessly.
    const { root, layer } = deskWithBuild("build-1");
    expect(removeProvisionalLogo(root, "build-9")).toBe(false);
    expect(removeProvisionalLogo(root, undefined)).toBe(false);
    expect(removeProvisionalLogo(root, "")).toBe(false);
    expect(layer.children).toHaveLength(1);
  });

  test("taking a tile down twice is not an error", () => {
    // The stream can close and error, and a terminal can be reached with the tile already
    // gone. Removal is a fact about the ground, not a transition.
    const { root } = deskWithBuild("build-1");
    expect(removeProvisionalLogo(root, "build-1")).toBe(true);
    expect(removeProvisionalLogo(root, "build-1")).toBe(false);
  });

  test("a build id is matched as a value, never assembled into a selector", () => {
    // A build id is a string this module did not author, so the attribute is read back and
    // compared rather than built into an `[attr="…"]` selector that would need escaping.
    const root = new FakeDocument();
    const tile = new Node({ [PROVISIONAL_LOGO_ATTRIBUTE]: 'b"1' });
    root.append(new Node({ id: "capability-logos" }).append(tile));
    expect(removeProvisionalLogo(root, 'b\\"1')).toBe(false);
    expect(removeProvisionalLogo(root, 'b"1')).toBe(true);
  });
});

describe("the terminal cleanup path", () => {
  test("every terminal takes the tile down, because every terminal closes the stream", () => {
    // Activation, stale, no-op, failure, cancellation and a pre-activation expiry all end
    // in the same `done` close. One way down rather than six.
    const { root, tile, narration } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("htmx:sseClose", { target: narration, detail: { type: "message" } });
    expect(tile.parent).toBeNull();
  });

  test("a transient error leaves the tile alone, because the transport is still retrying", () => {
    // `htmx:sseError` is not a terminal: the extension fires it and then schedules a reconnect, so
    // taking the tile down here let a proxy blip orphan a running build, and nothing puts it back.
    const { root, tile, narration } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("htmx:sseError", { target: narration });
    expect(tile.parent).not.toBeNull();
  });

  // The three `detail.type` values htmx's SSE extension closes with. The two node ones arrive
  // without an `error` event, and pressing another logo mid-build produces `nodeReplaced`.
  for (const type of ["message", "nodeReplaced", "nodeMissing"]) {
    test(`a stream closed as ${type} takes its tile down`, () => {
      const { root, tile, narration } = deskWithBuild("build-1");
      startDeskLogos(root);

      root.dispatch("htmx:sseClose", { target: narration, detail: { type } });
      expect(tile.parent).toBeNull();
    });
  }

  test("a run whose window holds its ending still takes its tile down at the close", () => {
    // The window waits, the tile does not: a failed or refused run holds its story until it is
    // dismissed (PLAN decision 25), but by then there is no in-flight story to go back to.
    const { root, tile, narration } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("htmx:sseClose", { target: narration, detail: { type: "message" } });

    expect(tile.parent).toBeNull();
  });

  test("a close belonging to another build leaves this one standing", () => {
    const { root, tile, layer } = deskWithBuild("build-1");
    const other = new Node({ [BUILD_JOB_ID_ATTRIBUTE]: "build-2" });
    layer.parent?.append(other);
    startDeskLogos(root);

    root.dispatch("htmx:sseClose", { target: other, detail: { type: "message" } });
    expect(tile.parent).not.toBeNull();
  });

  test("activation replaces the tile rather than leaving both or neither", () => {
    // The commit's out-of-band sidecar stands the registry-backed logo on the desk while the
    // stream is open, and the close takes the provisional one down: one logo becoming another.
    const { root, layer, narration } = deskWithBuild("build-1");
    startDeskLogos(root);

    layer.append(new Node({ id: "capability-logo-houseplants" }));
    root.dispatch("htmx:sseClose", { target: narration, detail: { type: "message" } });

    expect(layer.children.map((node) => node.getAttribute("id"))).toEqual([
      "capability-logo-houseplants",
    ]);
  });

  test("the build is read off the subscriber even after the terminal replaced its contents", () => {
    // The terminal presentation promotes what the build displaced, which can detach the
    // node the event came from before this runs. `closest` still answers.
    const { subscriber, narration } = deskWithBuild("build-1");
    subscriber.remove();
    expect(buildIdFromEvent(narration)).toBe("build-1");
    expect(buildIdFromEvent(null)).toBeUndefined();
    expect(buildIdFromEvent({})).toBeUndefined();
  });
});

describe("pressing the tile brings the in-flight story back", () => {
  test("it goes to the build's own subscriber and gives it somewhere to land", () => {
    const { root, tile, subscriber } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("click", { target: tile });
    expect(subscriber.scrolled).toBe(true);
    expect(subscriber.focused).toBe(true);
    // The region is not a control, so it carries no tab stop of its own.
    expect(subscriber.getAttribute("tabindex")).toBe("-1");
  });

  test("a press with the subscriber gone falls back to the region it streams into", () => {
    const { root, tile, subscriber, output } = deskWithBuild("build-1");
    startDeskLogos(root);
    subscriber.remove();

    root.dispatch("click", { target: tile });
    expect(output.focused).toBe(true);
  });

  test("a press somewhere else on the desk does nothing at all", () => {
    const { root, layer, subscriber } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("click", { target: layer });
    expect(subscriber.focused).toBe(false);
    revealBuildNarration(new FakeDocument(), "build-1"); // and an empty desk is not an error
  });
});

describe("the module ships with the shell", () => {
  test("the shipped page loads it, and it starts itself on the document it finds", async () => {
    expect(moduleSources(await elementsOf(readSource("public/index.html")))).toContain(
      "/static/desk/logos/desk-logos.js",
    );
    const { root, tile, subscriber, layer } = deskWithBuild("build-1");
    await startedOn("desk/logos/desk-logos.js", root);
    root.dispatch("click", { target: tile });
    expect(subscriber.focused).toBe(true);
    expect([...layer.listeners.keys()]).toEqual(expect.arrayContaining(["focusin", "wheel"]));
  });

  test("the narration region the tile falls back to is the window's own", () => {
    // Both halves can import the one id, so they do: the window holds the narration now.
    expect(BUILD_NARRATION_REGION_ID).toBe(WINDOW_CONTENT_ID);
  });
});

/** A logo layer as the scroll rules read it: its extents, its scroll and what it is told. */
function layerOf(size: { scrollWidth: number; scrollHeight: number }) {
  const listeners = new Map<string, (event: unknown) => void>();
  const layer = {
    scrollLeft: 0,
    clientWidth: 400,
    clientHeight: 300,
    ...size,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
  };
  let observed: ((records: { addedNodes: unknown[] }[]) => void) | undefined;
  class Observer {
    constructor(callback: (records: { addedNodes: unknown[] }[]) => void) {
      observed = callback;
    }
    observe(): void {}
  }
  startLogoLayerScroll(layer, Observer);
  const wheel = (event: {
    deltaY: number;
    deltaX?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
  }) => {
    let prevented = false;
    listeners.get("wheel")?.({
      deltaX: 0,
      deltaMode: 0,
      ...event,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  const press = (event: { target: unknown; offsetX: number; offsetY: number }) => {
    let prevented = false;
    listeners.get("mousedown")?.({
      ...event,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  return {
    layer,
    wheel,
    press,
    focus: (target: unknown) => listeners.get("focusin")?.({ target }),
    added: (...addedNodes: unknown[]) => observed?.([{ addedNodes }]),
  };
}

function revealable({ keyboard = true } = {}) {
  const node = { revealedWith: undefined as unknown };
  return Object.assign(node, {
    scrollIntoView: (options: unknown) => {
      node.revealedWith = options;
    },
    matches: (selector: string) => selector === ":focus-visible" && keyboard,
  });
}

describe("a desk with more logos than room", () => {
  test("a plain wheel scrolls the layer sideways, the one way it runs", () => {
    const { layer, wheel } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    expect(wheel({ deltaY: 40 })).toBe(true);
    expect(layer.scrollLeft).toBe(40);
    // A wheel counting lines, as Firefox's does for a mouse, still moves it a line's worth.
    wheel({ deltaY: 3, deltaMode: 1 });
    expect(layer.scrollLeft).toBeGreaterThan(40 + 3);
  });

  test("a wheel is left alone where it already means something", () => {
    const sideways = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    expect(sideways.wheel({ deltaY: 40, deltaX: 10 })).toBe(false);
    expect(sideways.wheel({ deltaY: 40, ctrlKey: true })).toBe(false);
    // Nothing to scroll, or a phone's list that runs down: the wheel is the browser's.
    expect(layerOf({ scrollWidth: 400, scrollHeight: 300 }).wheel({ deltaY: 40 })).toBe(false);
    expect(layerOf({ scrollWidth: 400, scrollHeight: 900 }).wheel({ deltaY: 40 })).toBe(false);
  });

  test("a logo the keyboard reaches is brought wholly into view", () => {
    const { focus } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    const logo = revealable();
    focus(logo);
    expect(logo.revealedWith).toEqual({ block: "nearest", inline: "nearest" });
  });

  test("a logo a pointer presses stays under the press", () => {
    // Revealed mid-press, a half-hidden logo slid away and the click landed on the ground.
    const { focus } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    const logo = revealable({ keyboard: false });
    focus(logo);
    expect(logo.revealedWith).toBeUndefined();
  });

  test("a press on the ground leaves the keyboard with nobody, as it was before the layer scrolled", () => {
    const { layer, focus } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    let blurred = false;
    Object.assign(layer, {
      blur: () => {
        blurred = true;
      },
    });
    focus(layer);
    expect(blurred).toBe(true);
  });

  test("a tile a swap stands on the ground is brought into view, past the text beside it", () => {
    const { added } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    const tile = revealable();
    added(tile, { nodeType: 3 });
    expect(tile.revealedWith).toEqual({ block: "nearest", inline: "nearest" });
  });

  test("a press on the scrollbar leaves the keyboard on the logo it was on", () => {
    const { layer, press } = layerOf({ scrollWidth: 900, scrollHeight: 300 });
    // Below the client box is the bar; above it is ground, which takes the press as any would.
    expect(press({ target: layer, offsetX: 10, offsetY: layer.clientHeight + 2 })).toBe(true);
    expect(press({ target: layer, offsetX: layer.clientWidth + 2, offsetY: 10 })).toBe(true);
    expect(press({ target: layer, offsetX: 10, offsetY: layer.clientHeight - 2 })).toBe(false);
    expect(press({ target: revealable(), offsetX: 10, offsetY: layer.clientHeight + 2 })).toBe(
      false,
    );
  });

  test("the layer is found by the name the server gives it", () => {
    expect(DESK_LOGO_LAYER_ID).toBe(DESK_LOGO_LAYER_ELEMENT_ID);
  });
});
