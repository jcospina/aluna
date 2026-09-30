// The capability window run on a started desk rather than read: what the client builds when it
// opens one, what its lamps say and do, and what putting it away leaves behind (PLAN decisions 1
// and 2; design D1, D3, D12).

import { afterEach, describe, expect, test } from "bun:test";

import {
  PUT_WINDOW_AWAY_EVENT,
  WINDOW_CONTENT_ID,
  WINDOW_CONTENT_REGION,
  WINDOW_LAYER_SELECTOR,
  WINDOW_STORAGE_KEY,
} from "#shell/desk/window/desk-window.js";
import { elementsOf, moduleSources } from "../../../../server/http/served-page.test-support.ts";
import { readSource } from "../../../safety/source.test-support.ts";
import { dragBy, type El, pressLamp } from "../standing-desk.test-support.ts";
import { type ViewportDesk, viewportDesk } from "../viewport-desk.test-support.ts";

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

/** A started desk with one window opened on it, and the parts of that window a person meets. */
async function opened(title = "Notes") {
  screen = await viewportDesk();
  const desk = screen;
  desk.module.openWindow(title, desk.desk.doc as never);
  const el = desk.desk.windows()[0] as El;
  const heading = el.querySelector("h2") as El;
  return {
    desk,
    el,
    heading,
    lamps: () => el.querySelectorAll(".lamp"),
    lamp: (action: string) => el.querySelector(`.lamp[data-action="${action}"]`) as El,
    region: el.querySelector(`#${WINDOW_CONTENT_ID}`) as El,
  };
}

describe("the shell ships a window layer and no content area", () => {
  test("the layer is in the page, empty, and the module that fills it is loaded", async () => {
    const page = await elementsOf(readSource("public/index.html"));
    const layerClass = WINDOW_LAYER_SELECTOR.replace(/^\./, "");
    const layers = page.filter((element) =>
      (element.attributes.get("class") ?? "").split(/\s+/).includes(layerClass),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]?.text).toBe("");
    expect(moduleSources(page)).toContain("/static/desk/window/desk-window.js");
  });
});

describe("the window holds the one content region", () => {
  test("the region is created by the client, named, and marked", async () => {
    const window = await opened();
    expect(window.region.dataset.contentRegion).toBe(WINDOW_CONTENT_REGION);
    expect(window.region.getAttribute("aria-live")).toBe("polite");
  });

  test("the window is a named landmark, named by its own title", async () => {
    const window = await opened();
    expect(window.heading.id).not.toBe("");
    expect(window.el.getAttribute("aria-labelledby")).toBe(window.heading.id);
  });

  test("a window left holding nothing is put away when the glue says so", async () => {
    const window = await opened();
    window.desk.desk.doc.dispatchEvent({ type: PUT_WINDOW_AWAY_EVENT });
    expect(window.desk.desk.windows()).toEqual([]);
  });
});

describe("two lamps, and there is no minimise", () => {
  test("the frame carries exactly maximise and put away, both real buttons", async () => {
    const window = await opened();
    expect(window.lamps().map((lamp) => lamp.dataset.action)).toEqual(["maximise", "putaway"]);
    expect(window.lamps().map((lamp) => [lamp.tagName, lamp.type])).toEqual([
      ["button", "button"],
      ["button", "button"],
    ]);
  });

  test("maximise is drawn leaf and put away clay, the two lamps told apart by colour", async () => {
    // The class a lamp carries is only a colour through the stylesheet that paints it.
    const sheet = readSource("design/styles/components/window.css");
    const paint = (lamp: El) =>
      lamp
        .names()
        .map(
          (name) =>
            new RegExp(`\\.${name}\\s*\\{\\s*background:\\s*var\\(--([\\w-]+)\\)`).exec(sheet)?.[1],
        )
        .filter((colour) => colour !== undefined);
    const window = await opened();
    expect(paint(window.lamp("maximise"))).toEqual(["leaf"]);
    expect(paint(window.lamp("putaway"))).toEqual(["clay"]);
  });

  test("the leaf lamp reports whether it is pressed", async () => {
    // Maximise is a toggle. Without this the only way to know a window is maximised is to look
    // at it, which is not a way a screen reader has.
    const window = await opened();
    expect(window.lamp("maximise").getAttribute("aria-pressed")).toBe("false");
    pressLamp(window.el, "maximise");
    expect(window.lamp("maximise").getAttribute("aria-pressed")).toBe("true");
    pressLamp(window.el, "maximise");
    expect(window.lamp("maximise").getAttribute("aria-pressed")).toBe("false");
  });

  test("the clay lamp dismisses, and a dismissed window is not remembered", async () => {
    const window = await opened();
    dragBy(window.el.querySelector("header") as El, 40, 30);
    expect(window.desk.desk.store.keys()).toContain(WINDOW_STORAGE_KEY);
    pressLamp(window.el, "putaway");
    expect(window.desk.desk.windows()).toEqual([]);
    expect(window.desk.desk.store.keys()).not.toContain(WINDOW_STORAGE_KEY);
  });

  test("a window put away without being dismissed leaves the record exactly as it was", async () => {
    // The two ways a window goes away without the user asking are not decisions about where
    // windows go (design D3), so neither writes nor forgets.
    const window = await opened();
    dragBy(window.el.querySelector("header") as El, 40, 30);
    const kept = window.desk.desk.store.contents();
    const writes = window.desk.desk.store.writes.length;
    window.desk.module.putAway();
    expect(window.desk.desk.store.contents()).toEqual(kept);
    expect(window.desk.desk.store.writes).toHaveLength(writes);
  });
});

describe("the title bar", () => {
  test("the full title stays readable where a truncated one cannot be", async () => {
    const long = "A capability with a name far longer than any title bar could ever hold";
    const window = await opened(long);
    expect(window.heading.textContent).toBe(long);
    expect(window.heading.title).toBe(long);
  });

  test("a retitled window retitles its lamps", async () => {
    // A lamp announcing the capability before last is worse than one announcing nothing,
    // because it is confidently wrong.
    const window = await opened("Notes");
    window.desk.module.openWindow("Recipes", window.desk.desk.doc as never);
    expect(window.heading.title).toBe("Recipes");
    expect(window.lamps()).toHaveLength(2);
    for (const lamp of window.lamps()) {
      expect(lamp.getAttribute("aria-label")).toContain("Recipes");
      expect(lamp.getAttribute("aria-label")).not.toContain("Notes");
    }
  });
});
