// The shell glue's own rules, run rather than grepped: `public/app.js` and the desk modules under
// `public/desk/` are driven through the document double, and every name the glue restates is imported from
// the module that owns it, so a copy that drifts fails a behaviour here.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_REGION_EVENT } from "#shell/core/region-scope.js";
import { ACTIVE_CAPABILITY_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { startCapabilityDeletionRecovery } from "#shell/desk/logos/capability-deletion.js";
import { STAGE_PAYLOAD_EVENT, STAGES_CLEARED_EVENT } from "#shell/desk/window/desk-dev-panel.js";
import { PROMPT_FORM_ID, WINDOW_TOOK_CAPABILITY_EVENT } from "#shell/desk/window/desk-window.js";
import {
  RESTORATION_CAPABILITY_ID_FIELD,
  RESTORATION_INCARNATION_ID_FIELD,
} from "../../pipeline/jobs/restoration.ts";
import { elementsOf, moduleSources, type ServedElement } from "../http/served-page.test-support.ts";
import { desk, El, eventAt, openStream } from "./app.shell-double.test-support.ts";

describe("a prompt's restoration evidence", () => {
  /** A prompt's request being configured, the way htmx hands it to the glue. */
  function configure(scene: ReturnType<typeof desk>, elt: El) {
    const parameters: Record<string, unknown> = {};
    scene.fire("htmx:configRequest", { detail: { elt, parameters } });
    return parameters;
  }

  test("a prompt carries the exact capability standing in the window", () => {
    const scene = desk();
    scene.displaced.setAttribute("data-active-capability-incarnation", "inc-1");

    expect(configure(scene, scene.promptForm)).toEqual({
      [RESTORATION_CAPABILITY_ID_FIELD]: "tasks",
      [RESTORATION_INCARNATION_ID_FIELD]: "inc-1",
    });
  });

  test("and nothing it cannot name exactly, or that is not a prompt", () => {
    const halfNamed = desk();
    expect(configure(halfNamed, halfNamed.promptForm)).toEqual({});

    // A capability's copy inside the run's own subscriber is not what is standing in the window.
    const nested = desk();
    nested.displaced.remove();
    nested.subscriber.append(
      new El("div", {
        [ACTIVE_CAPABILITY_ATTRIBUTE]: "tasks",
        "data-active-capability-incarnation": "inc-1",
      }),
    );
    expect(configure(nested, nested.promptForm)).toEqual({});

    const elsewhere = desk();
    elsewhere.displaced.setAttribute("data-active-capability-incarnation", "inc-1");
    const anotherForm = new elsewhere.FormStub();
    anotherForm.setAttribute("id", "notes-create");
    expect(configure(elsewhere, anotherForm)).toEqual({});
    expect(configure(elsewhere, new El("form", { id: PROMPT_FORM_ID }))).toEqual({});
  });
});

describe("a run's stream ending", () => {
  /** The run's stream ending the way `why` says, at the subscriber the SSE extension closed. */
  function endStream(scene: ReturnType<typeof desk>, why: string) {
    scene.fire("htmx:sseClose", eventAt("htmx:sseClose", scene.subscriber, { type: why }));
  }

  /** Every navigation the glue reported to the desk, in order. */
  function navigations(scene: ReturnType<typeof desk>) {
    return scene.dispatched
      .filter(({ type }) => type === WINDOW_TOOK_CAPABILITY_EVENT)
      .map(({ detail }) => (detail as { navigated: boolean }).navigated);
  }

  function activation(scene: ReturnType<typeof desk>, ...content: El[]) {
    const commit = new El("div", { class: "build-stream__commit" });
    commit.append(...content);
    scene.subscriber.append(commit);
  }

  test("an activation takes the window: its content replaces the run and what it displaced", () => {
    const scene = desk();
    const collection = new El("section", { [ACTIVE_CAPABILITY_ATTRIBUTE]: "notes" });
    activation(scene, collection);

    endStream(scene, "message");

    expect(scene.region.childNodes).toEqual([collection]);
    expect(scene.displaced.dispatched).toContain(RELEASE_REGION_EVENT);
    expect(scene.subscriber.dispatched).toContain(RELEASE_REGION_EVENT);
    expect(collection.dispatched).not.toContain(RELEASE_REGION_EVENT);
    // Wired rather than re-fetched: its own `load` trigger is the one canonical read.
    expect(scene.processed).toEqual([collection]);
    expect(navigations(scene)).toEqual([true]);
  });

  test("each release reaches the document, where the region's scope listens for it", () => {
    const scene = desk();
    const released: unknown[] = [];
    scene.root.addEventListener(RELEASE_REGION_EVENT, (event) => {
      released.push((event as Event).target);
    });
    activation(scene, new El("section", { [ACTIVE_CAPABILITY_ATTRIBUTE]: "notes" }));

    endStream(scene, "message");

    expect(released).toEqual([scene.displaced, scene.subscriber]);
  });

  test("content already reading is left to the read it started", () => {
    const scene = desk();
    const reading = new El("section", { class: "htmx-request" });
    const holdingOne = new El("section");
    holdingOne.append(new El("div", { class: "htmx-request" }));
    const idle = new El("section");
    activation(scene, reading, holdingOne, idle);

    endStream(scene, "message");

    expect(scene.region.childNodes).toEqual([reading, holdingOne, idle]);
    expect(scene.processed).toEqual([idle]);
  });

  test("an empty commit is not an activation: the story is what the window keeps", () => {
    const scene = desk();
    activation(scene);
    scene.narration.append(new El("p"));

    endStream(scene, "message");

    expect(scene.region.childNodes).toEqual([scene.narration]);
    expect(navigations(scene)).toEqual([false]);
  });

  test("a run that ended with nothing to show leaves what it displaced standing", () => {
    const scene = desk();

    endStream(scene, "message");

    expect(scene.region.childNodes).toEqual([scene.displaced]);
    expect(scene.subscriber.dispatched).toContain(RELEASE_REGION_EVENT);
    expect(scene.displaced.dispatched).not.toContain(RELEASE_REGION_EVENT);
    expect(scene.processed).toEqual([]);
  });

  test("a neutral restoration puts the desk at its own address, in place", () => {
    const scene = desk();
    const written: unknown[][] = [];
    scene.windowStub.history.replaceState = (...args: unknown[]) => {
      written.push(args);
    };
    scene.surface.append(new El("div", { "data-build-restoration": "neutral" }));

    endStream(scene, "message");

    expect(written).toEqual([[null, "", "/"]]);
    expect(navigations(scene)).toEqual([false]);
  });

  test("a stream the desk took down is not a run finishing", () => {
    for (const why of ["nodeReplaced", "nodeMissing"]) {
      const scene = desk();
      activation(scene, new El("section"));

      endStream(scene, why);

      expect(scene.subscriber.parent).toBe(scene.region);
      expect(scene.processed).toEqual([]);
      expect(navigations(scene)).toEqual([]);
    }
  });

  test("a transient drop keeps the bar locked, and a dead connection wakes it", () => {
    const CLOSED = 2;
    const previous = Reflect.getOwnPropertyDescriptor(globalThis, "EventSource");
    (globalThis as { EventSource?: unknown }).EventSource = { CLOSED };
    try {
      const scene = desk();
      const state = scene.startShell();
      openStream(scene);
      const drop = (readyState: number) =>
        scene.fire("htmx:sseError", { detail: { source: { readyState } } });

      drop(CLOSED - 2);
      expect(state?.promptBusy).toBe(true);
      drop(CLOSED);
      expect(state?.promptBusy).toBe(false);
    } finally {
      if (previous) Object.defineProperty(globalThis, "EventSource", previous);
      else Reflect.deleteProperty(globalThis, "EventSource");
    }
  });
});

describe("the developer panel's feed", () => {
  test("a stage's payload is handed to the panel rather than swapped anywhere", () => {
    const scene = desk();
    const listener = new El("span", { "data-preview-stage": "spec" });
    scene.subscriber.append(listener);
    const event = eventAt("htmx:sseBeforeMessage", listener, { data: '{"id":"notes"}' });

    scene.fire("htmx:sseBeforeMessage", event);

    expect(event.defaultPrevented).toBe(true);
    expect(scene.dispatched).toContainEqual({
      type: STAGE_PAYLOAD_EVENT,
      detail: { stage: "spec", payload: '{"id":"notes"}' },
    });
  });

  test("an admitted build empties the panel once, however often its window swaps", () => {
    const scene = desk();
    const cleared = () => scene.dispatched.filter(({ type }) => type === STAGES_CLEARED_EVENT);

    scene.fire("htmx:afterSwap", { target: scene.region });
    scene.fire("htmx:afterSwap", { target: scene.narration });
    expect(cleared()).toHaveLength(1);

    scene.fire("htmx:afterSwap", { target: scene.displaced });
    expect(cleared()).toHaveLength(1);
  });
});

/** The shell page the desk ships, parsed. */
async function shellPage(): Promise<readonly ServedElement[]> {
  return elementsOf(readFileSync(resolve(import.meta.dir, "../../../public/index.html"), "utf8"));
}

describe("permanent deletion's restoration evidence", () => {
  /** A deletion's request being configured, htmx's event reaching the recovery the page starts. */
  function configureDeletion(scene: ReturnType<typeof desk>, elt: El) {
    startCapabilityDeletionRecovery(scene.root as never);
    const parameters: Record<string, unknown> = {};
    scene.root.dispatchEvent(
      new CustomEvent("htmx:configRequest", { detail: { elt, parameters } }),
    );
    return parameters;
  }

  const doorway = () => new El("button", { "data-capability-delete": "" });

  test("a deletion asked over a standing capability names that capability exactly", () => {
    const scene = desk();
    scene.displaced.setAttribute("data-active-capability-incarnation", "inc-1");

    expect(configureDeletion(scene, doorway())).toEqual({
      restore_surface: "capability",
      restore_capability_id: "tasks",
      restore_incarnation_id: "inc-1",
    });
  });

  test("and the bare desk when nothing it can name exactly is standing", () => {
    const halfNamed = desk();
    const bare = desk();
    bare.displaced.remove();

    for (const scene of [halfNamed, bare]) {
      expect(configureDeletion(scene, doorway())).toEqual({ restore_surface: "neutral" });
    }
  });

  test("a request that is not a deletion is not its business", async () => {
    const scene = desk();
    scene.displaced.setAttribute("data-active-capability-incarnation", "inc-1");

    expect(configureDeletion(scene, new El("button"))).toEqual({});
    // Nor is an event that carries no request at all.
    expect(() => scene.root.dispatchEvent(new CustomEvent("htmx:configRequest"))).not.toThrow();
    expect(moduleSources(await shellPage())).toContain("/static/desk/logos/capability-deletion.js");
  });
});
