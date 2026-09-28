// What the shell does with a run once its stream closes, run rather than grepped: which content
// takes the window, what is released, when the window goes away, and when a deflection leaves the
// view standing. `app.build-ending.test.ts` holds the runs that end with something to tell you.

import { describe, expect, test } from "bun:test";
import {
  NAME_THE_WINDOW_EVENT,
  PUT_WINDOW_AWAY_EVENT,
  WINDOW_TOOK_CAPABILITY_EVENT,
} from "#shell/desk-window.js";
import { RELEASE_REGION_EVENT } from "#shell/region-scope.js";
import { ACTIVE_CAPABILITY_ATTRIBUTE } from "#shell/shell-dom.js";
import {
  closeStream,
  desk,
  dismiss,
  El,
  eventAt,
  narrateEnding,
  streamRestoration,
  Text,
} from "../../app.shell-double.test-support.ts";
import { renderPromptNotice } from "../../http/index.ts";

type Scene = ReturnType<typeof desk>;

function navigations(scene: Scene) {
  return scene.dispatched
    .filter(({ type }) => type === WINDOW_TOOK_CAPABILITY_EVENT)
    .map(({ detail }) => (detail as { navigated: boolean }).navigated);
}

function namings(scene: Scene) {
  return scene.dispatched
    .filter(({ type }) => type === NAME_THE_WINDOW_EVENT)
    .map(({ detail }) => (detail as { title: string | null }).title);
}

/** An ending with words in it, so a rescue that should not happen would be heard. */
function endWith(scene: Scene, words: string): void {
  const ending = new El("p", { "data-build-ending": "" });
  ending.ownText = words;
  scene.narration.append(ending);
}

function putAway(scene: Scene): number {
  return scene.dispatched.filter(({ type }) => type === PUT_WINDOW_AWAY_EVENT).length;
}

/** A text node: whitespace between swapped nodes by default, which is not content. */
function blank(words = "\n  "): Text {
  return new Text(words);
}

describe("which closes are a run finishing", () => {
  test("only a stream the server finished, told the way the extension tells it", () => {
    for (const close of [
      { detail: { type: "message" } },
      new CustomEvent("htmx:sseClose", { detail: { kind: "message" } }),
      new CustomEvent("htmx:sseClose", { detail: "message" }),
      new CustomEvent("htmx:sseClose", { detail: null }),
    ]) {
      const scene = desk();
      Object.defineProperty(close, "target", { value: scene.subscriber });

      scene.fire("htmx:sseClose", close);

      expect(scene.subscriber.parent).toBe(scene.region);
      expect(navigations(scene)).toEqual([]);
    }
  });
});

describe("what a finished run leaves the window holding", () => {
  test("a restoration's content takes the window, not the element that carried it", () => {
    const scene = desk();
    const restoration = new El("div", { "data-build-restoration": "capability" });
    const collection = new El("section");
    restoration.append(collection);
    scene.surface.append(restoration);

    closeStream(scene);

    expect(scene.region.childNodes).toEqual([collection]);
    expect(navigations(scene)).toEqual([false]);
  });

  test("a desk with no htmx on it still gets the content, unwired", () => {
    const scene = desk();
    (scene.windowStub as { htmx?: unknown }).htmx = undefined;
    const collection = new El("section");
    const commit = new El("div", { class: "build-stream__commit" });
    commit.append(collection);
    scene.subscriber.append(commit);

    closeStream(scene);

    expect(scene.region.childNodes).toEqual([collection]);
  });

  test("a window left holding nothing goes away, and one still holding something stays", () => {
    const empty = desk();
    empty.displaced.remove();
    empty.region.append(blank());
    closeStream(empty);
    expect(putAway(empty)).toBe(1);
    expect(navigations(empty)).toEqual([false]);

    const holding = desk();
    closeStream(holding);
    expect(putAway(holding)).toBe(0);

    const saying = desk();
    saying.displaced.remove();
    saying.region.append(blank("Still here."));
    closeStream(saying);
    expect(putAway(saying)).toBe(0);
  });

  test("a close that reaches no run in the window finishes nothing and claims nothing", () => {
    const closeAt = (scene: Scene, target: unknown) => {
      const close = new CustomEvent("htmx:sseClose", {
        detail: { type: "message" },
        bubbles: true,
      });
      Object.defineProperty(close, "target", { value: target });
      scene.fire("htmx:sseClose", close);
    };

    const elsewhere = desk();
    const outside = new El("div");
    elsewhere.region.parent?.append(outside);
    closeAt(elsewhere, outside);
    expect(elsewhere.subscriber.parent).toBe(elsewhere.region);
    expect(navigations(elsewhere)).toEqual([false]);

    const nothing = desk();
    expect(() => closeAt(nothing, null)).not.toThrow();
    expect(navigations(nothing)).toEqual([false]);

    const taken = desk();
    taken.narration.append(new El("p"));
    taken.subscriber.remove();
    expect(() => closeAt(taken, taken.subscriber)).not.toThrow();
    // A run already out of the page closes where no document listener can hear it.
    expect(navigations(taken)).toEqual([]);
    expect(taken.subscriber.parent).toBeNull();
  });

  test("htmx tearing down something that is not a held run carries nothing to the bar", () => {
    const scene = desk();

    for (const target of [null, scene.displaced, scene.subscriber]) {
      expect(() => scene.fire("htmx:beforeCleanupElement", { target })).not.toThrow();
    }
    expect(scene.notice.textContent).toBe("");
  });

  test("a neutral restoration corrects the address only when it is not already the desk's", () => {
    for (const [pathname, search, writes] of [
      ["/", "", 0],
      ["/", "?from=elsewhere", 1],
      ["/capability/tasks", "", 1],
    ] as const) {
      const scene = desk();
      const written: unknown[] = [];
      Object.assign(scene.windowStub.location, { pathname, search });
      scene.windowStub.history.replaceState = (...args: unknown[]) => {
        written.push(args);
      };
      scene.surface.append(new El("div", { "data-build-restoration": "neutral" }));

      closeStream(scene);

      expect({ pathname, search, writes: written.length }).toEqual({ pathname, search, writes });
    }

    // A capability given back is standing at its own address already.
    const scene = desk();
    let writes = 0;
    scene.windowStub.history.replaceState = () => {
      writes += 1;
    };
    const restoration = new El("div", { "data-build-restoration": "capability" });
    restoration.append(new El("section"));
    scene.surface.append(restoration);
    closeStream(scene);
    expect(writes).toBe(0);
  });
});

describe("a held run let go", () => {
  test("with nothing parked, the window it covered is put away when that was all it held", () => {
    const scene = desk();
    scene.displaced.remove();
    endWith(scene, "That didn’t work.");
    closeStream(scene);

    dismiss(scene);

    expect(scene.region.childNodes).toEqual([]);
    expect(putAway(scene)).toBe(1);
    expect(navigations(scene).at(-1)).toBe(false);
    expect(scene.subscriber.dispatched).toContain(RELEASE_REGION_EVENT);
    expect(namings(scene).at(-1)).toBeNull();
    // Read, so a teardown after it has nothing left to carry to the bar.
    scene.fire("htmx:beforeCleanupElement", { target: scene.subscriber });
    expect(scene.notice.textContent).toBe("");
  });

  test("the next prompt clears an ended run away but keeps the window up for itself", () => {
    const scene = desk();
    scene.displaced.remove();
    narrateEnding(scene);
    closeStream(scene);

    scene.fire("htmx:beforeRequest", {
      detail: { elt: scene.promptForm, target: scene.region },
      preventDefault: () => {},
    });

    expect(scene.subscriber.parent).toBeNull();
    expect(putAway(scene)).toBe(0);
  });

  test("a run already taken out of the window is not given anything back", () => {
    const scene = desk();
    narrateEnding(scene);
    closeStream(scene);
    scene.subscriber.remove();
    const button = new El("button", { "data-build-dismiss": "" });
    scene.subscriber.append(button);

    const before = navigations(scene).length;

    scene.fire("click", eventAt("click", button, null));

    expect(scene.subscriber.querySelector("[data-build-ending]")).not.toBeNull();
    expect(navigations(scene)).toHaveLength(before);
  });

  test("an empty restoration given back leaves an empty window, which goes too", () => {
    const scene = desk();
    scene.displaced.remove();
    endWith(scene, "That didn’t work.");
    streamRestoration(scene, '<div data-build-restoration="capability"></div>');
    closeStream(scene);
    expect(navigations(scene)).toEqual([false]);

    dismiss(scene);

    expect(putAway(scene)).toBe(1);
    expect(navigations(scene).at(-1)).toBe(false);
    scene.fire("htmx:beforeCleanupElement", { target: scene.subscriber });
    expect(scene.notice.textContent).toBe("");
  });

  test("a press that is not on a run's control is not the press that ends the wait", () => {
    const scene = desk();
    narrateEnding(scene);
    closeStream(scene);
    const stray = new El("button", { "data-build-dismiss": "" });
    scene.region.append(stray);

    for (const target of [null, { closest: () => null }, stray]) {
      expect(() => scene.fire("click", { target })).not.toThrow();
    }
    expect(scene.subscriber.parent).toBe(scene.region);
    expect(scene.promptField.focused).toBe(false);
  });
});

describe("what a swap settling tells the desk", () => {
  test("every swap reports that the window changed hands, without claiming a navigation", () => {
    const scene = desk();

    scene.fire("htmx:afterSwap", { target: scene.displaced });

    expect(navigations(scene)).toEqual([false]);
  });

  test("a swap or a message with nothing behind it is passed over", () => {
    const scene = desk();

    for (const [name, event] of [
      ["htmx:configRequest", {}],
      ["htmx:sseBeforeMessage", { target: null, detail: { data: "" } }],
    ] as const) {
      expect(() => scene.fire(name, event)).not.toThrow();
    }
  });

  test("only a swap that emptied the region itself puts the window away", () => {
    const scene = desk();
    const inner = new El("div");
    scene.displaced.append(inner);

    scene.fire("htmx:afterSettle", { detail: { target: inner } });
    scene.fire("htmx:afterSettle", {});
    expect(putAway(scene)).toBe(0);

    scene.region.replaceChildren(blank());
    scene.fire("htmx:afterSettle", { detail: { target: new El("div", { id: "elsewhere" }) } });
    expect(putAway(scene)).toBe(0);
    scene.fire("htmx:afterSettle", { detail: { target: scene.region } });
    expect(putAway(scene)).toBe(1);
  });
});

/**
 * A deflection that would keep the view standing: the duplicate path's restoration, marked
 * `preserve`, naming the capability `restored` names, with a sentence for the bar.
 */
function deflection(restored: Record<string, string>, kind = "capability") {
  const inner = Object.entries(restored)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  const view = kind === "capability" ? `<div${inner}></div>` : "";
  return `<div data-build-restoration="${kind}" data-build-restoration-behavior="preserve">${view}</div>${renderPromptNotice("Already here.", "refusal")}`;
}

const TASKS = {
  [ACTIVE_CAPABILITY_ATTRIBUTE]: "tasks",
  "data-active-capability-incarnation": "inc-1",
  "data-active-capability-version": "1",
};

/** The canonical collection standing untouched, as the duplicate path finds it. */
function canonicalDesk(identity: Record<string, string> = TASKS) {
  const scene = desk();
  for (const name of [...scene.displaced.attributes.keys()]) scene.displaced.removeAttribute(name);
  for (const [name, value] of Object.entries(identity)) scene.displaced.setAttribute(name, value);
  const search = new El("input", { "data-capability-search-input": "" });
  const collection = new El("div", { "data-search-state": "idle" });
  scene.displaced.append(collection, search);
  return { scene, search, collection };
}

describe("when a deflection keeps the view standing", () => {
  test("only over the exact revision it would restore, and only while it is untouched", () => {
    expect(streamRestoration(canonicalDesk().scene, deflection(TASKS))).toBe(true);

    for (const restored of [
      { ...TASKS, "data-active-capability-version": "2" },
      { ...TASKS, "data-active-capability-incarnation": "inc-2" },
      { ...TASKS, [ACTIVE_CAPABILITY_ATTRIBUTE]: "notes" },
    ]) {
      expect(streamRestoration(canonicalDesk().scene, deflection(restored))).toBe(false);
    }
    const unversioned = { [ACTIVE_CAPABILITY_ATTRIBUTE]: "tasks" };
    expect(streamRestoration(canonicalDesk(unversioned).scene, deflection(unversioned))).toBe(
      false,
    );

    const searching = canonicalDesk();
    searching.collection.setAttribute("data-search-state", "loading");
    expect(streamRestoration(searching.scene, deflection(TASKS))).toBe(false);

    const typed = canonicalDesk();
    typed.search.value = "milk";
    expect(streamRestoration(typed.scene, deflection(TASKS))).toBe(false);

    // Every part of the identity has to be there to be the same: two blanks are not a match.
    for (const missing of Object.keys(TASKS).slice(1)) {
      const partial = { ...TASKS };
      delete partial[missing as keyof typeof TASKS];
      expect(streamRestoration(canonicalDesk(partial).scene, deflection(partial))).toBe(false);
    }
    const viewless =
      '<div data-build-restoration="capability" data-build-restoration-behavior="preserve"></div>';
    expect(streamRestoration(canonicalDesk().scene, viewless)).toBe(false);
  });

  test("an open create panel is a view in use; a closed one is not", () => {
    for (const [display, preserved] of [
      ["block", false],
      ["none", true],
    ] as const) {
      const { scene } = canonicalDesk();
      scene.displaced.append(new El("div", { class: "capability-collection__create" }));
      Object.assign(scene.windowStub, { getComputedStyle: () => ({ display }) });

      expect({ display, preserved: streamRestoration(scene, deflection(TASKS)) }).toEqual({
        display,
        preserved,
      });
    }
  });

  test("a neutral one keeps a desk that holds nothing but the run", () => {
    const bare = desk();
    bare.displaced.remove();
    bare.region.append(blank());
    expect(streamRestoration(bare, deflection({}, "neutral"))).toBe(true);

    const standing = desk();
    expect(streamRestoration(standing, deflection({}, "neutral"))).toBe(false);

    // Something standing that is not a capability is still something standing.
    const record = desk();
    record.displaced.remove();
    record.region.append(new El("form", { id: "notes-edit" }));
    expect(streamRestoration(record, deflection({}, "neutral"))).toBe(false);
  });

  test("and at the close the view is left exactly where it was, read once already", () => {
    const { scene } = canonicalDesk();
    streamRestoration(scene, deflection(TASKS));
    scene.narration.append(new El("p"));

    closeStream(scene);

    expect(scene.region.childNodes).toEqual([scene.displaced]);
    expect(scene.subscriber.dispatched).toContain(RELEASE_REGION_EVENT);
    expect(scene.displaced.dispatched).not.toContain(RELEASE_REGION_EVENT);
    expect(scene.processed).toEqual([]);
    expect(navigations(scene)).toEqual([false]);
  });

  test("a run holding its ending claims no navigation at the close", () => {
    const scene = desk();
    narrateEnding(scene);
    scene.fire("htmx:sseClose", eventAt("htmx:sseClose", scene.subscriber, { type: "message" }));

    expect(navigations(scene)).toEqual([false]);
  });
});
