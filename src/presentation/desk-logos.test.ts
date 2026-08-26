import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BUILD_NARRATION_REGION_ID,
  buildIdFromEvent,
  PROVISIONAL_LOGO_ATTRIBUTE,
  removeProvisionalLogo,
  revealBuildNarration,
  startDeskLogos,
} from "#shell/desk-logos.js";
import { WINDOW_CONTENT_ID } from "#shell/desk-window.js";
import { renderBuildSubscriber, renderProvisionalLogo } from "../web/fragments.ts";

/**
 * A document small enough to run the tile's rules in Bun. They need four DOM facts and no
 * more — find a node by attribute, find one by id, remove one, and receive an event — so
 * this implements exactly those.
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

/** A desk with one build in flight: its tile on the ground, its subscriber in the output. */
function deskWithBuild(buildId: string) {
  const root = new FakeDocument();
  const tile = new Node({ [PROVISIONAL_LOGO_ATTRIBUTE]: buildId });
  const layer = new Node({ id: "capability-logos" }).append(tile);
  const narration = new Node({ class: "build-stream__narration" });
  const subscriber = new Node({ "data-build-job-id": buildId }).append(narration);
  const output = new Node({ id: "spec-build-output" }).append(subscriber);
  root.append(layer, output);
  return { root, tile, layer, narration, subscriber, output };
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
    // A build id is a string this module did not author. Reading the attribute back
    // compares two strings; building `[attr="…"]` out of one has to be escaped correctly
    // to be safe, and there is no reason to take on that obligation.
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
    // `htmx:sseError` is not a terminal. The vendored extension fires it and then — when
    // the connection node is still in the document — schedules a reconnect with backoff;
    // a native EventSource fires `error` on every drop while it retries itself. The
    // genuinely dead case never reaches here: `bodyContains` failing makes the extension
    // fire `htmx:sseClose` with `nodeMissing` and close, which the row above covers.
    //
    // So taking the tile down here let an ordinary proxy blip orphan the tile of a build
    // that is still running, and nothing puts it back — only activation appends a logo.
    const { root, tile, narration } = deskWithBuild("build-1");
    startDeskLogos(root);

    root.dispatch("htmx:sseError", { target: narration });
    expect(tile.parent).not.toBeNull();
  });

  // The three `detail.type` values htmx's SSE extension actually closes with. `message` is
  // the server-sent `done`; the other two are htmx closing a stream whose subscriber left
  // the document, and they arrive without an `error` event, so nothing else would catch
  // them. Pressing another capability's logo while a build runs swaps the region the
  // subscriber lives in and produces exactly `nodeReplaced` — an ordinary gesture that
  // used to strand a tile on the ground for the rest of the session.
  for (const type of ["message", "nodeReplaced", "nodeMissing"]) {
    test(`a stream closed as ${type} takes its tile down`, () => {
      const { root, tile, narration } = deskWithBuild("build-1");
      startDeskLogos(root);

      root.dispatch("htmx:sseClose", { target: narration, detail: { type } });
      expect(tile.parent).toBeNull();
    });
  }

  test("a close belonging to another build leaves this one standing", () => {
    const { root, tile, layer } = deskWithBuild("build-1");
    const other = new Node({ "data-build-job-id": "build-2" });
    layer.parent?.append(other);
    startDeskLogos(root);

    root.dispatch("htmx:sseClose", { target: other, detail: { type: "message" } });
    expect(tile.parent).not.toBeNull();
  });

  test("activation replaces the tile rather than leaving both or neither", () => {
    // The commit's out-of-band sidecar stands the registry-backed logo on the desk while
    // the stream is still open; the close that follows takes the provisional one down.
    // What the user sees is one logo becoming another, never two of the same capability
    // and never a gap.
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
  const root = resolve(import.meta.dir, "../..");
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  test("the shipped page loads it, and it starts itself against the real document", () => {
    expect(read("public/index.html")).toContain(
      '<script type="module" src="/static/desk-logos.js"></script>',
    );
    // Self-starting, like `region-scope.js` and `swap-target.js`: the page states that
    // the rule is on, and the module is the one place it is written down.
    expect(read("public/desk-logos.js")).toContain(
      'if (typeof document !== "undefined") startDeskLogos(',
    );
  });

  test("what this module looks for is what the server writes", () => {
    // The two halves are a classic script and a server renderer, so neither can import
    // the other's constant. They are pinned against each other here instead — the same
    // answer `region-scope.js` and `app.js` give for `RELEASE_REGION_EVENT`.
    expect(renderProvisionalLogo("build-1")).toContain(`${PROVISIONAL_LOGO_ATTRIBUTE}="build-1"`);
    expect(renderBuildSubscriber("build-1")).toContain('data-build-job-id="build-1"');
    // The narration region is no longer in the shell: the window holds it, and the
    // window is created by the client. Both halves can import that one, so they do.
    expect(BUILD_NARRATION_REGION_ID).toBe(WINDOW_CONTENT_ID);
  });
});
