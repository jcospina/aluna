import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderBuildEnding, renderBuildSubscriber } from "../web/index.ts";

// A run that ends with something to tell you holds the window there, and the press is
// what gives back what it displaced (PLAN decisions 23 and 25; ARCH §6.2).
//
// Run rather than grepped. `public/app.js` is a classic script that imports nothing, so
// it is evaluated with the handful of DOM globals its rules actually touch — the same
// way the shell's other glue rules are proved in this suite. The double below is as much
// of the DOM as these rules reach for and no more: a rule proved against a double that
// has stopped resembling the DOM is proved against nothing, so every operation here is
// the one the browser performs.

const WINDOW_REGION_ID = "spec-build-output";

/** As much of the shell's Alpine component as these rules touch. */
interface ShellState {
  promptBusy: boolean;
  init(): void;
}

class El {
  readonly childNodes: El[] = [];
  parent: El | null = null;
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly dispatched: string[] = [];
  readonly nodeType = 1;
  isFragment = false;
  raw = "";
  textContent = "";
  value = "";
  focused = false;

  constructor(
    readonly tag: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  get classList() {
    const classes = (this.attributes.get("class") ?? "").split(/\s+/).filter(Boolean);
    return { contains: (name: string) => classes.includes(name) };
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  matches(selector: string): boolean {
    // One compound selector only. A descendant selector reaching this would match on its
    // first bracket group and quietly answer about the wrong node, which is exactly the
    // kind of lie a double is not allowed to tell.
    if (/\s/.test(selector.trim())) throw new Error(`not a compound selector: ${selector}`);
    if (selector.startsWith("#")) return this.attributes.get("id") === selector.slice(1);
    const tagged = /^([a-z]+)\[/.exec(selector);
    if (tagged && this.tag !== tagged[1]) return false;
    const attribute = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(selector);
    if (attribute) {
      const held = this.attributes.get(attribute[1] ?? "");
      return held !== undefined && (attribute[2] === undefined || held === attribute[2]);
    }
    return selector.startsWith(".") && this.classList.contains(selector.slice(1));
  }

  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  /** The first descendant this selector reaches, one compound step at a time. */
  querySelector(selector: string): El | null {
    const [head, ...rest] = selector.trim().split(/\s+/);
    for (const child of this.childNodes) {
      const found = child.reachedBy(head ?? selector, rest) ?? child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  /** This node if the step ends here, or whatever the remaining steps reach inside it. */
  private reachedBy(step: string, rest: readonly string[]): El | null {
    if (!this.matches(step)) return null;
    return rest.length === 0 ? this : this.querySelector(rest.join(" "));
  }

  append(...nodes: El[]): void {
    for (const node of nodes) {
      if (node.isFragment) {
        this.append(...[...node.childNodes]);
        continue;
      }
      node.remove();
      node.parent = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes: El[]): void {
    for (const child of [...this.childNodes]) child.remove();
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  focus(): void {
    this.focused = true;
  }

  dispatchEvent(event: { type: string }): void {
    this.dispatched.push(event.type);
  }
}

/**
 * The one thing a `<template>` is for here: the parked restoration, inert and
 * unsearchable from the document until it is asked for. Its content is read exactly the
 * way the browser reads it — the outer element's attributes, and whatever it wraps.
 */
class Template extends El {
  readonly content = new El("#fragment");

  constructor() {
    super("template");
    this.content.isFragment = true;
  }

  set innerHTML(raw: string) {
    this.raw = raw;
    const opened = /<(\w+)([^>]*)>/.exec(raw);
    const wrapper = new El(opened?.[1] ?? "div");
    for (const [, name, value] of (opened?.[2] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) {
      wrapper.setAttribute(name ?? "", value ?? "");
    }
    const inner = new El("span");
    inner.raw = raw;
    wrapper.append(inner);
    this.content.replaceChildren(wrapper);
  }
}

/** One run standing in the window, with the surface it displaced beside it. */
function desk() {
  const region = new El("div", { id: WINDOW_REGION_ID });
  const displaced = new El("div", { "data-active-capability-id": "tasks" });
  const subscriber = new El("section", {
    class: "build-stream",
    "data-build-job-id": "build-1",
  });
  const narration = new El("div", { class: "build-stream__narration" });
  const surface = new El("div", { class: "build-stream__fragment" });
  subscriber.append(narration, surface);
  region.append(displaced, subscriber);

  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const processed: El[] = [];
  const notice = new El("div", { id: "prompt-notice" });
  const promptField = new El("input", { id: "spec-build-prompt" });
  const frames: Array<() => void> = [];
  class FormStub {
    id = "spec-build-form";
  }
  const documentStub = {
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    querySelector: (selector: string) => region.querySelector(selector),
    getElementById: (id: string) => {
      if (id === WINDOW_REGION_ID) return region;
      if (id === "prompt-notice") return notice;
      return id === "spec-build-prompt" ? promptField : null;
    },
    createElement: (tag: string) => (tag === "template" ? new Template() : new El(tag)),
    dispatchEvent: (event: { type: string; detail?: unknown }) =>
      dispatched.push({ type: event.type, detail: event.detail }),
  };
  /** The `shell` component, so the courtesy state can be driven the way Alpine drives it. */
  let shellFactory: (() => ShellState) | null = null;
  const windowStub = {
    Alpine: {
      data(_name: string, factory: () => ShellState) {
        shellFactory = factory;
      },
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    location: { pathname: "/capability/tasks", search: "" },
    history: { state: null, replaceState() {} },
    htmx: {
      process(node: El) {
        processed.push(node);
      },
    },
  };

  const appScript = readFileSync(resolve("public/app.js"), "utf8");
  Function(
    "document",
    "window",
    "requestAnimationFrame",
    "HTMLInputElement",
    "HTMLFormElement",
    "HTMLElement",
    "Element",
    "HTMLTemplateElement",
    "Node",
    appScript,
  )(
    documentStub,
    windowStub,
    (frame: () => void) => frames.push(frame),
    El,
    FormStub,
    El,
    El,
    Template,
    { TEXT_NODE: 3 },
  );

  /** Every rule listening for one event, in the order the document would run them. */
  const fire = (name: string, event: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(event);
  };

  /** Start the shell component the way Alpine does, and hand back its state. */
  const startShell = () => {
    fire("alpine:init", new CustomEvent("alpine:init"));
    const state = shellFactory?.();
    state?.init();
    return state;
  };

  return {
    region,
    displaced,
    subscriber,
    narration,
    surface,
    notice,
    promptField,
    listeners,
    fire,
    dispatched,
    processed,
    frames,
    FormStub,
    startShell,
  };
}

const RESTORATION = '<div data-build-restoration="capability"><p>collection</p></div>';

/** The ending arriving on the narration, exactly as the presenter streams it. */
function narrateEnding(scene: ReturnType<typeof desk>) {
  scene.narration.append(new El("p", { "data-build-ending": "" }));
}

/**
 * A real event, aimed at a node of the double. The glue asks `event instanceof
 * CustomEvent` before it trusts a close, so a plain object would be waved through every
 * rule under test without running any of them.
 */
function eventAt(type: string, target: El, detail: unknown) {
  const event = new CustomEvent(type, { detail, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

/** The restoration arriving on the fragment, exactly as the presenter streams it. */
function streamRestoration(scene: ReturnType<typeof desk>, raw = RESTORATION) {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, { data: raw });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/** The stream closing the way the server closes it. */
function closeStream(scene: ReturnType<typeof desk>) {
  scene.fire("htmx:sseClose", eventAt("htmx:sseClose", scene.surface, { type: "message" }));
}

/** The press that ends the wait. */
function dismiss(scene: ReturnType<typeof desk>) {
  const button = new El("button", { "data-build-dismiss": "" });
  scene.subscriber.append(button);
  scene.fire("click", eventAt("click", button, null));
}

describe("a run that ends with something to tell you", () => {
  test("parks the restoration instead of letting it read records nobody can see", () => {
    const scene = desk();
    narrateEnding(scene);

    expect(streamRestoration(scene)).toBe(true);
    // Parked in a template: inert, and invisible to every query the document makes.
    expect(scene.surface.childNodes).toHaveLength(0);
    expect(scene.subscriber.querySelector("[data-build-restoration]")).toBeNull();
    expect(scene.processed).toHaveLength(0);
  });

  test("holds the window at the ending when the stream closes", () => {
    const scene = desk();
    narrateEnding(scene);
    streamRestoration(scene);

    closeStream(scene);

    // The story is still up, and the surface the run displaced is still covered by it.
    expect(scene.subscriber.parent).toBe(scene.region);
    expect(scene.region.childNodes).toContain(scene.displaced);
    expect(scene.region.querySelector("[data-build-restoration]")).toBeNull();
  });

  test("gives back the displaced capability once the ending is dismissed", () => {
    const scene = desk();
    narrateEnding(scene);
    streamRestoration(scene);
    closeStream(scene);

    dismiss(scene);

    // The run is gone, what it displaced is gone with it, and what the registry says
    // now is standing in the window — wired up, so its own read runs exactly once.
    expect(scene.subscriber.parent).toBeNull();
    expect(scene.displaced.parent).toBeNull();
    expect(scene.displaced.dispatched).toContain("aluna:release-region");
    expect(scene.region.childNodes).toHaveLength(1);
    expect(scene.processed).toHaveLength(1);
    expect(scene.dispatched.map(({ type }) => type)).toContain("aluna:window-took-capability");
  });

  test("a run whose restoration never arrived still leaves the window usable", () => {
    const scene = desk();
    narrateEnding(scene);
    closeStream(scene);

    dismiss(scene);

    // Nothing was streamed to give back, so the story is dropped and the surface the
    // run only ever covered is what the window is left showing.
    expect(scene.subscriber.parent).toBeNull();
    expect(scene.region.childNodes).toEqual([scene.displaced]);
  });

  test("cancel has no ending, so it restores with no press in between", () => {
    const scene = desk();

    expect(streamRestoration(scene)).toBe(false);
    // htmx places a cancelled run's restoration itself; the close promotes it.
    scene.surface.append(
      Object.assign(new El("div", { "data-build-restoration": "capability" }), {}),
    );
    scene.surface.childNodes[0]?.append(new El("p"));

    closeStream(scene);

    expect(scene.subscriber.parent).toBeNull();
    expect(scene.displaced.parent).toBeNull();
    expect(scene.region.childNodes).toHaveLength(1);
  });
});

describe("the ending the presenter streams", () => {
  test("is a line the log says and a control in the run's own control row", () => {
    const ending = renderBuildEnding("build-1", "Hmm, that didn't work. Mind trying again?");

    expect(ending).toContain("data-build-ending");
    expect(ending).toContain("Mind trying again?");
    // The same place the run's Cancel stood, replaced rather than joined: once there is
    // an ending there is no run left to cancel.
    expect(ending).toContain('id="build-stream-control-build-1"');
    expect(ending).toContain('hx-swap-oob="outerHTML"');
    expect(ending).toContain("data-build-dismiss");
    expect(renderBuildSubscriber("build-1")).toContain(
      '<button id="build-stream-control-build-1" class="btn btn--outline build-stream__cancel"',
    );
    // Keyed by the build id, so one run's ending cannot out-of-band its way onto another
    // run's Cancel in the queued-submit window the one-subscriber guard cannot see into.
    expect(renderBuildEnding("build-2", "x")).not.toContain("build-stream-control-build-1");
  });

  test("escapes the line it is handed", () => {
    expect(renderBuildEnding("build-1", '<script>"x"</script>')).toContain(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;",
    );
  });
});

// The one subscriber the window admits, and what the next prompt does to a run that has
// already ended.
describe("what the next prompt finds standing in the window", () => {
  /** @returns whether the submission was refused. */
  function submitPrompt(scene: ReturnType<typeof desk>) {
    let prevented = false;
    scene.fire("htmx:beforeRequest", {
      detail: { elt: new scene.FormStub() },
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  }

  test("an empty window admits the prompt and retires the line before it", () => {
    const scene = desk();
    scene.subscriber.remove();
    scene.notice.append(new El("span"));

    expect(submitPrompt(scene)).toBe(false);
    expect(scene.notice.childNodes).toHaveLength(0);
  });

  test("a run still in flight is what the one-subscriber guard refuses", () => {
    const scene = desk();
    scene.notice.append(new El("span"));

    expect(submitPrompt(scene)).toBe(true);
    // Refused before anything was retired: the run keeps its story and its place.
    expect(scene.subscriber.parent).toBe(scene.region);
    expect(scene.notice.childNodes).toHaveLength(1);
  });

  test("a run that ended gets out of the way without starting a read for it", () => {
    const scene = desk();
    narrateEnding(scene);
    streamRestoration(scene);
    closeStream(scene);

    expect(submitPrompt(scene)).toBe(false);

    // The run is gone and the window stayed up for the build about to fill it. What the
    // run displaced was only ever covered, so it is already standing there — and the
    // parked collection is dropped rather than placed, because placing it would start a
    // records read for a surface the arriving subscriber covers again in the same frame.
    expect(scene.subscriber.parent).toBeNull();
    expect(scene.region.childNodes).toEqual([scene.displaced]);
    expect(scene.processed).toHaveLength(0);
    expect(scene.dispatched.map(({ type }) => type)).not.toContain("aluna:put-window-away");
  });
});

// The window is the only place an ending lives, so every way it can be destroyed rather
// than read has to carry the line somewhere that outlives the window.
describe("an ending that is torn down rather than read", () => {
  /** htmx cleaning up the subscriber — what putting the window away and a swap both do. */
  function cleanUp(scene: ReturnType<typeof desk>) {
    scene.fire(
      "htmx:beforeCleanupElement",
      eventAt("htmx:beforeCleanupElement", scene.subscriber, null),
    );
  }

  test("puts its line on the prompt bar on the way out", () => {
    const scene = desk();
    scene.narration.append(
      Object.assign(new El("p", { "data-build-ending": "" }), {
        textContent: "Hmm, that didn't work. Mind trying again?",
      }),
    );

    cleanUp(scene);

    expect(scene.notice.textContent).toBe("Hmm, that didn't work. Mind trying again?");
  });

  test("a dismissed ending is not rescued, because it was read", () => {
    const scene = desk();
    narrateEnding(scene);
    streamRestoration(scene);
    closeStream(scene);
    dismiss(scene);

    cleanUp(scene);

    expect(scene.notice.textContent).toBe("");
  });

  test("a run still in flight has no line to rescue", () => {
    const scene = desk();

    cleanUp(scene);

    expect(scene.notice.textContent).toBe("");
  });
});

describe("the prompt bar while an ending is held", () => {
  test("keeps the words that produced it and hands the keyboard to the control", () => {
    const scene = desk();
    const shell = scene.startShell();
    scene.promptField.value = "track my houseplants";
    narrateEnding(scene);
    const control = new El("button", { "data-build-dismiss": "" });
    scene.subscriber.append(control);

    closeStream(scene);
    for (const frame of scene.frames.splice(0)) frame();

    // Unlocked, but not wiped: a line that says "mind trying again?" beside a field that
    // was just emptied is asking for something it took away.
    expect(shell?.promptBusy).toBe(false);
    expect(scene.promptField.value).toBe("track my houseplants");
    expect(scene.promptField.focused).toBe(false);
    // And the control is where the keyboard lands, which is also the only way an
    // assistive technology is told the window is waiting on one.
    expect(control.focused).toBe(true);
  });

  test("a run with no ending clears the field and takes the keyboard back", () => {
    const scene = desk();
    const shell = scene.startShell();
    scene.promptField.value = "track my houseplants";

    closeStream(scene);
    for (const frame of scene.frames.splice(0)) frame();

    expect(shell?.promptBusy).toBe(false);
    expect(scene.promptField.value).toBe("");
    expect(scene.promptField.focused).toBe(true);
  });
});

// The window's name is information, not decoration (M5 plan 1). The server names it the
// moment resolution settles what the run is; the desk owns the window and writes it.
describe("what the run tells the desk to call the window", () => {
  /** Every name this run asked the window to be called, in order. */
  const namings = (scene: ReturnType<typeof desk>) =>
    scene.dispatched
      .filter(({ type }) => type === "aluna:name-the-window")
      .map(({ detail }) => (detail as { title: string | null }).title);

  test("the name lands nowhere — the desk owns the window", () => {
    const scene = desk();

    expect(streamRestoration(scene, '<div data-build-window-title="Building…"></div>')).toBe(true);

    expect(namings(scene)).toEqual(["Building…"]);
    expect(scene.surface.childNodes).toHaveLength(0);
    expect(scene.region.querySelector("[data-build-window-title]")).toBeNull();
  });

  test("an evolution is named after the capability it is changing", () => {
    const scene = desk();

    streamRestoration(scene, '<div data-build-window-title="Journal"></div>');

    expect(namings(scene)).toEqual(["Journal"]);
  });

  test("a run that ends without activating gives the name back", () => {
    const scene = desk();
    streamRestoration(scene, '<div data-build-window-title="Building…"></div>');
    narrateEnding(scene);
    streamRestoration(scene);

    closeStream(scene);

    // `null` is the desk's word for *put back what the run took over*: nothing the run
    // was called while it worked is true any more.
    expect(namings(scene)).toEqual(["Building…", null]);
  });

  test("cancel gives it back too, at once", () => {
    const scene = desk();
    streamRestoration(scene, '<div data-build-window-title="Building…"></div>');
    scene.surface.append(new El("div", { "data-build-restoration": "capability" }));

    closeStream(scene);

    expect(namings(scene)).toEqual(["Building…", null]);
  });

  test("an activation does not, because its capability is what the window is called now", () => {
    const scene = desk();
    streamRestoration(scene, '<div data-build-window-title="Building…"></div>');
    const commit = new El("div", { class: "build-stream__commit" });
    commit.append(new El("section", { "data-active-capability-id": "notes" }));
    scene.subscriber.append(commit);

    closeStream(scene);

    expect(namings(scene)).toEqual(["Building…"]);
  });
});
