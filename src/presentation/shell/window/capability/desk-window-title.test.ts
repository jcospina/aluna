import { afterEach, describe, expect, test } from "bun:test";

import {
  BUILD_WINDOW_TITLE,
  NAME_THE_WINDOW_EVENT,
  THINKING_WINDOW_TITLE,
} from "#shell/desk/window/desk-window.js";
import { renderBuildWindowTitle } from "../../../../server/http/fragments/fragments.ts";
import {
  desk as shellDesk,
  streamRestoration,
} from "../../../../server/shell-glue/app.shell-double.test-support.ts";
import type { El } from "../standing-desk.test-support.ts";
import { type ViewportDesk, viewportDesk } from "../viewport-desk.test-support.ts";

// What the window is called, and who gets to say (M5 plan 1): the desk says `Thinking…` at submit,
// the server names the run once resolution settles it, and an activation renames after the tool.
// Run on a started desk, with the prompt bar submitting the way the page's does.

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

async function startedDesk() {
  screen = await viewportDesk();
  const desk = screen;
  return {
    desk,
    submit: () => desk.desk.doc.dispatchEvent({ type: "submit", target: desk.desk.bar } as never),
    name: (title: string | null) =>
      desk.desk.doc.dispatchEvent({ type: NAME_THE_WINDOW_EVENT, detail: { title } }),
    title: () => desk.desk.windows()[0]?.querySelector("h2")?.textContent,
  };
}

describe("what the window is called while a run has it", () => {
  test("a build takes the window over and says so, remembering the name it took", async () => {
    // A window titled after the capability that happens to be open is wrong while a build is
    // making something else, so the desk says `Thinking…` and remembers the name it took over.
    const desk = await startedDesk();
    desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never);
    desk.submit();
    expect(desk.title()).toBe(THINKING_WINDOW_TITLE);
    desk.name(null);
    expect(desk.title()).toBe("Notes");
  });

  test("a window a run stood up has no earlier name, and is given the desk's own", async () => {
    // A noun, not a gerund: the one case with no earlier name to put back and no capability to
    // be named after is a window a run opened and then failed in.
    const desk = await startedDesk();
    desk.submit();
    expect(desk.title()).toBe(THINKING_WINDOW_TITLE);
    desk.name(null);
    expect(desk.title()).toBe(BUILD_WINDOW_TITLE);
  });

  test("a build that finds a window brings it forward", async () => {
    // Rather than leaving its narration behind another window, which below the breakpoint is
    // out of the page (5.6/04).
    const desk = await startedDesk();
    const [capability] = [desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never)];
    const other = desk.desk.desk.windows()[0] as El;
    other.classList.remove("is-focused");
    desk.submit();
    expect(capability?.closest(".window")?.classList.contains("is-focused")).toBe(true);
  });

  test("the run names the window, and the desk is what writes it", async () => {
    // The shell forwards; the desk decides. A name it can use is written, and anything else hands
    // the earlier name back, which is how a run that did not activate returns it.
    const desk = await startedDesk();
    desk.desk.module.openWindow("Notes", desk.desk.desk.doc as never);
    desk.submit();
    desk.name("Building…");
    expect(desk.title()).toBe("Building…");
    desk.name("");
    expect(desk.title()).toBe("Notes");
  });

  test("the name the server streams reaches the desk as the event the desk listens for", () => {
    const scene = shellDesk();
    expect(streamRestoration(scene, renderBuildWindowTitle("Journal"))).toBe(true);
    expect(scene.dispatched).toContainEqual({
      type: NAME_THE_WINDOW_EVENT,
      detail: { title: "Journal" },
    });
  });
});
