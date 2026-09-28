import { describe, expect, test } from "bun:test";

import {
  BUILD_NARRATION_REGION_ID,
  buildIdFromEvent,
  PROVISIONAL_LOGO_ATTRIBUTE,
  removeProvisionalLogo,
  revealBuildNarration,
  startDeskLogos,
} from "#shell/desk-logos.js";
import { WINDOW_CONTENT_ID } from "#shell/desk-window.js";
import { BUILD_JOB_ID_ATTRIBUTE } from "#shell/shell-dom.js";
import {
  DESK_LOGO_LAYER_ELEMENT_ID,
  renderBuildSubscriber,
  renderProvisionalLogo,
} from "../../../server/http/fragments.ts";
import { elementsOf, moduleSources } from "../../../server/http/served-page.test-support.ts";
import { El as ParsedEl, parseHtml } from "../../controls/choice-picker.test-support.ts";
import { startedOn } from "../../controls/started-module.test-support.ts";
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
  readonly listeners = new Map<string, Listener[]>();

  querySelectorAll(selector: string): Node[] {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  getElementById(id: string): Node | null {
    for (const node of this.descendants()) if (node.getAttribute("id") === id) return node;
    return null;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: LogoEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
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
      "/static/desk-logos.js",
    );
    const { root, tile, subscriber } = deskWithBuild("build-1");
    await startedOn("desk-logos.js", root);
    root.dispatch("click", { target: tile });
    expect(subscriber.focused).toBe(true);
  });

  test("the narration region the tile falls back to is the window's own", () => {
    // Both halves can import the one id, so they do: the window holds the narration now.
    expect(BUILD_NARRATION_REGION_ID).toBe(WINDOW_CONTENT_ID);
  });
});
