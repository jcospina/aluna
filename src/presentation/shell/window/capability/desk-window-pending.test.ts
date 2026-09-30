import { afterEach, describe, expect, test } from "bun:test";
import { CONTENT_REGION_SELECTOR } from "#shell/core/region-scope.js";
import { renderBuildSubscriber } from "../../../../server/http/fragments/fragments.ts";
import { readSource as read } from "../../../safety/source.test-support.ts";
import type { El } from "../standing-desk.test-support.ts";
import { deskNodes, type ViewportDesk, viewportDesk } from "../viewport-desk.test-support.ts";

// A window a prompt stood up before anything was known waits out of sight for the first thing
// worth showing, because a frame that appears and vanishes reads as a fault (PLAN decision 24).

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A bare desk a prompt was just submitted on, with the run's surface landed in its window. */
async function submitted() {
  screen = await viewportDesk();
  const desk = screen;
  desk.desk.doc.dispatchEvent({ type: "submit", target: desk.desk.bar } as never);
  const el = desk.desk.windows()[0] as El;
  el.querySelector(CONTENT_REGION_SELECTOR)?.append(...deskNodes(renderBuildSubscriber("b-1")));
  const part = (name: string) => el.querySelector(`[sse-swap="${name}"]`) as El;
  return {
    el,
    classes: () => el.names(),
    message: (from: El) =>
      desk.desk.doc.dispatchEvent({ type: "htmx:sseBeforeMessage", target: from } as never),
    part,
  };
}

// A prompt that never becomes a build earns a window never, so an answer belonging on the prompt
// bar does not also flash an empty frame across the desk.
describe("a window stood up before anything is known", () => {
  test("is revealed by the run's first message, and by nothing else", async () => {
    const run = await submitted();
    const waiting = run.classes();
    // The `fragment` event's listener is the run giving back what it displaced, which is the
    // opposite of having something to show.
    run.message(run.part("fragment"));
    expect(run.classes()).toEqual(waiting);
    run.message(run.part("narration"));
    expect(run.classes().length).toBe(waiting.length - 1);
  });

  test("a commit reveals it too", async () => {
    const run = await submitted();
    const waiting = run.classes();
    run.message(run.part("commit"));
    expect(run.classes().length).toBe(waiting.length - 1);
  });

  test("waits under one class of its own, which the reveal takes off", async () => {
    const run = await submitted();
    const waiting = run.classes();
    run.message(run.part("narration"));
    expect(waiting.filter((name) => !run.classes().includes(name))).toHaveLength(1);
  });

  test("waits out of sight rather than being taken out of the layout", async () => {
    // `visibility`, not `display`: the window is measured when it mounts, and a box with no
    // layout would be drawn at nothing and stay that way. The class is the one the module writes.
    const run = await submitted();
    const waiting = run.classes();
    run.message(run.part("narration"));
    const pending = waiting.find((name) => !run.classes().includes(name));
    expect(pending).toBeDefined();
    expect(read("public/css/demo.css")).toMatch(
      new RegExp(`\\.window--desk\\.${pending}\\s*\\{\\s*visibility:\\s*hidden`),
    );
  });
});
