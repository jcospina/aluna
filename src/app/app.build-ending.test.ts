import { describe, expect, test } from "bun:test";

import { renderBuildEnding, renderBuildSubscriber } from "../web/index.ts";
import {
  closeStream,
  desk,
  dismiss,
  El,
  eventAt,
  narrateEnding,
  streamRestoration,
} from "./app.shell-double.test-support.ts";

// A run that ends with something to tell you holds the window there, and the press is
// what gives back what it displaced (PLAN decisions 23 and 25; ARCH §6.2).

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
