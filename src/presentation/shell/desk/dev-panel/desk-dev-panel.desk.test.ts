// The developer panel run on a started desk: `public/desk/window/desk-window.js` and `public/desk/window/desk-dev-panel.js`
// both started the way the page starts them, with the browser's store recording every write. What
// is settled here is what the pins in `desk-dev-panel.test.ts` used to read out of the file.

import { afterEach, describe, expect, test } from "bun:test";

import { DEV_STAGES } from "#design/desk/devpanel.js";
import { CONTENT_REGION_SELECTOR } from "#shell/core/region-scope.js";
import {
  DEV_SEED_SELECTOR,
  DEV_STORAGE_KEY,
  DEV_TILE_SELECTOR,
  STAGE_PAYLOAD_EVENT,
  STAGES_CLEARED_EVENT,
} from "#shell/desk/window/desk-dev-panel.js";
import {
  CAPABILITY_LOGO_SELECTOR,
  capabilityAddress,
  PROMPT_FORM_ID,
  WINDOW_STORAGE_KEY,
} from "#shell/desk/window/desk-window.js";
import { renderCapabilitySurface } from "../../../../server/http/fragments/fragments.ts";
import { descendantsOf, elementsOf } from "../../../../server/http/served-page.test-support.ts";
import {
  eventAt,
  desk as shellDesk,
} from "../../../../server/shell-glue/app.shell-double.test-support.ts";
import { readSource } from "../../../safety/source.test-support.ts";
import {
  dragBy,
  type El,
  everythingSaid,
  pressLamp,
} from "../../window/standing-desk.test-support.ts";
import {
  deskNodes,
  serverLogo,
  type ViewportDesk,
  type ViewportOptions,
  viewportDesk,
} from "../../window/viewport-desk.test-support.ts";

/** The attribute a selector of the form `[name]` or `[name="value"]` asks for. */
const attributeOf = (selector: string) => /^\[([\w-]+)/.exec(selector)?.[1] ?? "";

const TILE = `<button type="button" ${attributeOf(DEV_TILE_SELECTOR)}>Developer</button>`;

let screen: ViewportDesk | undefined;
afterEach(() => {
  screen?.restore();
  screen = undefined;
});

async function deskWithPanel(options: ViewportOptions = {}) {
  screen = await viewportDesk({
    panel: true,
    logos: [serverLogo("notes", "Notes")],
    furniture: [TILE],
    ...options,
  });
  const started = screen;
  const find = (selector: string) => started.desk.root.querySelector(selector) as El;
  const press = (on: El) => on.dispatchEvent({ type: "click", target: on } as never);
  const windowOf = (panel: boolean) =>
    started.desk.windows().filter((el) => el.classList.contains("window--dev") === panel);
  return {
    ...started,
    tile: () => find(DEV_TILE_SELECTOR),
    notes: () => find('[aria-label="Open Notes"]'),
    press,
    panels: () => windowOf(true),
    capabilityWindows: () => windowOf(false),
    front: () => started.desk.windows().filter((el) => el.classList.contains("is-focused")),
    record: () => started.desk.store.contents()[DEV_STORAGE_KEY],
  };
}

describe("it is the second window, and it opens no window of its own", () => {
  test("a window that is already up still comes forward when it is asked for", async () => {
    // The press that opens nothing is still a press on the logo of the thing you want to look at,
    // and below the breakpoint only the frontmost window is in the page at all.
    const desk = await deskWithPanel();
    desk.press(desk.notes());
    const [capability] = desk.capabilityWindows();
    capability
      ?.querySelector(CONTENT_REGION_SELECTOR)
      ?.append(
        ...deskNodes(renderCapabilitySurface({ id: "notes", incarnation_id: "i", version: 1 }, "")),
      );
    desk.press(desk.tile());
    expect(desk.front()).toEqual(desk.panels());

    desk.press(desk.notes());
    expect(desk.front()).toEqual([capability as El]);

    // And every opening raises, so a capability swapped into a standing window is never left
    // behind the panel either.
    desk.press(desk.tile());
    desk.module.openWindow("Recipes", desk.desk.doc as never);
    expect(desk.front()).toEqual([capability as El]);
  });

  test("the address wins on load; a restored panel stands behind it", async () => {
    // Nobody asked for the panel on this visit, a remembered preference did, so the URL's
    // capability is in front.
    const desk = await deskWithPanel({
      pathname: capabilityAddress("notes"),
      stored: { [DEV_STORAGE_KEY]: '{"open":true}' },
      answer: () => new Promise(() => {}),
    });
    expect(desk.panels()).toHaveLength(1);
    expect(desk.front()).toEqual(desk.capabilityWindows());
  });

  test("a lone restored panel is still raised, since a phone shows one window", async () => {
    const desk = await deskWithPanel({ stored: { [DEV_STORAGE_KEY]: '{"open":true}' } });
    expect(desk.front()).toEqual(desk.panels());
  });

  test("the panel builds exactly one window, however often its tile is pressed", async () => {
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    desk.press(desk.tile());
    expect(desk.panels()).toHaveLength(1);
  });

  test("re-pressing the open panel's tile focuses it; only the clay lamp puts it away", async () => {
    // A tile that toggled would put away the panel a developer pressed while reading it.
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    desk.press(desk.notes());
    desk.press(desk.tile());
    expect(desk.front()).toEqual(desk.panels());
    pressLamp(desk.panels()[0] as El, "putaway");
    expect(desk.panels()).toEqual([]);
  });
});

describe("the second presentation record, and the last", () => {
  test("opening authors no box, a drag authors one, and closing keeps it", async () => {
    // Writing the full record at mount persisted `MIN_SIZE` in the corner on a cold load.
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: true });

    const panel = desk.panels()[0] as El;
    dragBy(panel.querySelector("header") as El, 40, 30);
    const dragged = JSON.parse(desk.record() ?? "null");
    // One box, the one on screen, the maximised flag, and whether it was open: nothing else.
    const [x, y, w, h] = ["--win-x", "--win-y", "--win-w", "--win-h"].map((name) =>
      Number.parseFloat(panel.props.get(name) ?? ""),
    );
    expect(dragged).toEqual({ x, y, w, h, max: false, open: true });

    pressLamp(desk.panels()[0] as El, "putaway");
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ ...dragged, open: false });
    // Its own key, and never the capability window's.
    expect(desk.desk.store.writes.filter((write) => write.includes(WINDOW_STORAGE_KEY))).toEqual(
      [],
    );
  });

  test("putting it away keeps a remembered maximise, as well as the box it gives back", async () => {
    const kept = { x: 20, y: 20, w: 520, h: 420, max: true };
    const desk = await deskWithPanel({
      stored: { [DEV_STORAGE_KEY]: JSON.stringify({ ...kept, open: true }) },
    });
    pressLamp(desk.panels()[0] as El, "putaway");
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ ...kept, open: false });
  });

  test("its leaf lamp maximises it, and only its clay lamp puts it away", async () => {
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    const panel = desk.panels()[0] as El;
    pressLamp(panel, "maximise");
    expect(desk.panels()).toEqual([panel]);
    expect(panel.querySelector('.lamp[data-action="maximise"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(JSON.parse(desk.record() ?? "null")).toMatchObject({ max: true, open: true });
  });

  test("putting it away is heard on a phone, where no box is ever authored", async () => {
    const desk = await deskWithPanel({ phone: true });
    desk.press(desk.tile());
    pressLamp(desk.panels()[0] as El, "putaway");
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: false });
  });
});

describe("the panel across the desk changing size", () => {
  test("it changes form with the screen, and only a crossing up writes its box", async () => {
    const desk = await deskWithPanel({ phone: true });
    desk.press(desk.tile());
    const panel = desk.panels()[0] as El;
    const lamp = panel.querySelector('.lamp[data-action="maximise"]') as El;
    expect(lamp.hasAttribute("hidden")).toBe(true);
    desk.setPhone(true);
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: true });
    desk.setPhone(false);
    expect(lamp.hasAttribute("hidden")).toBe(false);
    expect(Object.keys(JSON.parse(desk.record() ?? "null")).sort()).toEqual([
      "h",
      "max",
      "open",
      "w",
      "x",
      "y",
    ]);
  });

  test("a maximise before the desk has edges authors no box", async () => {
    // Fitted to a desk that measures nothing, the box it would write is `MIN_SIZE` in the corner.
    const desk = await deskWithPanel({
      laidOut: false,
      stored: { [DEV_STORAGE_KEY]: '{"open":true}' },
    });
    pressLamp(desk.panels()[0] as El, "maximise");
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: true });
  });

  test("a drag that ends after the panel was put away writes nothing", async () => {
    // Taking the frame down releases the pointer capture, and that ending arrives afterwards.
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    const bar = desk.panels()[0]?.querySelector("header") as El;
    bar.dispatchEvent({ type: "pointerdown", target: bar, pointerId: 1, clientX: 0, clientY: 0 });
    pressLamp(desk.panels()[0] as El, "putaway");
    const writes = desk.desk.store.writes.length;
    bar.dispatchEvent({ type: "pointerup", pointerId: 1, clientX: 90, clientY: 90 });
    expect(desk.desk.store.writes).toHaveLength(writes);
  });

  test("crossing down with the panel open writes no box, since a phone authors none", async () => {
    const desk = await deskWithPanel();
    desk.press(desk.tile());
    desk.setPhone(true);
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: true });
  });

  test("a panel restored on a cold load writes its first box when the desk has edges", async () => {
    // Fitted to a desk that measures nothing, a box is `MIN_SIZE` in the corner.
    const desk = await deskWithPanel({
      laidOut: false,
      stored: { [DEV_STORAGE_KEY]: '{"open":true}' },
    });
    // The flag it was restored by is already the flag it would write, so nothing is written yet.
    expect(desk.desk.store.writes).toEqual([]);
    expect(JSON.parse(desk.record() ?? "null")).toEqual({ open: true });
    desk.layOut();
    expect(JSON.parse(desk.record() ?? "null")).toMatchObject({ open: true, max: false });
    expect(JSON.parse(desk.record() ?? "null").w).toBeGreaterThan(0);
  });
});

describe("what the panel shows", () => {
  const [stage] = DEV_STAGES;

  test("a payload that arrives before it opens is shown when it does, and a new build clears it", async () => {
    // Kept whether the panel is open or not, so a developer who starts a build and then reaches
    // for the tile still finds every stage that has already run.
    const desk = await deskWithPanel();
    desk.desk.doc.dispatchEvent({
      type: STAGE_PAYLOAD_EVENT,
      detail: { stage: stage?.key, payload: '{"said":"early"}' },
    });
    desk.press(desk.tile());
    const panel = desk.panels()[0] as El;
    expect(everythingSaid(panel)).toContain("early");

    desk.desk.doc.dispatchEvent({ type: STAGES_CLEARED_EVENT });
    expect(everythingSaid(panel)).not.toContain("early");
  });

  test("the stage the server already knows rides the page, and an empty seed is resting", async () => {
    const seed = attributeOf(DEV_SEED_SELECTOR);
    const [first, second, third] = DEV_STAGES;
    const desk = await deskWithPanel({
      furniture: [
        TILE,
        `<div ${seed}="${first?.key}">{"seeded":"at load"}</div>`,
        `<div ${seed}="${second?.key}">   </div>`,
      ],
    });
    desk.press(desk.tile());
    const panel = desk.panels()[0] as El;
    const blockOf = (key: string | undefined) => panel.querySelector(`[data-stage="${key}"]`);
    expect(everythingSaid(blockOf(first?.key) as El)).toContain("at load");
    // Resting looks the same whether a seed was blank or never there at all.
    const payloadOf = (key: string | undefined) => blockOf(key)?.querySelector("code")?.textContent;
    expect(payloadOf(second?.key)).toBe(payloadOf(third?.key));
    expect(payloadOf(first?.key)).not.toBe(payloadOf(third?.key));
  });

  test("the shipped page carries the tile and the seed the panel starts from", async () => {
    const served = await elementsOf(readSource("public/index.html"));
    const tile = served.find((element) => element.attributes.has(attributeOf(DEV_TILE_SELECTOR)));
    if (tile === undefined) throw new Error("the shell serves no developer tile");
    // The desk's logo handlers key off a capability's marks, and find them by `closest`: neither
    // the tile nor anything drawn inside it carries one.
    for (const part of [tile, ...descendantsOf(served, tile)]) {
      expect(part.attributes.has(attributeOf(CAPABILITY_LOGO_SELECTOR))).toBe(false);
      expect(part.attributes.has("data-capability-id")).toBe(false);
    }
    expect(descendantsOf(served, tile).length).toBeGreaterThan(0);
    const seeded = served.filter((element) =>
      element.attributes.has(attributeOf(DEV_SEED_SELECTOR)),
    );
    expect(seeded.length).toBeGreaterThan(0);
    for (const one of seeded) {
      const key = one.attributes.get(attributeOf(DEV_SEED_SELECTOR));
      expect(DEV_STAGES.map((known) => known.key)).toContain(key as string);
    }
  });

  test("a prompt refused before it becomes a build leaves the panel's history alone", () => {
    // The whole round trip: the request, and the refusal swapped into a window no run stands in.
    const scene = shellDesk();
    const cleared = () => scene.dispatched.filter(({ type }) => type === STAGES_CLEARED_EVENT);
    const form = byIdDouble(scene);
    scene.fire("htmx:beforeRequest", eventAt("htmx:beforeRequest", form as never, { elt: form }));
    scene.subscriber.remove();
    scene.fire("htmx:afterSwap", eventAt("htmx:afterSwap", scene.region, {}));
    expect(cleared()).toEqual([]);
    // The same swap with a run standing in it is a build, and is what empties the panel.
    scene.region.append(scene.subscriber);
    scene.fire("htmx:afterSwap", eventAt("htmx:afterSwap", scene.region, {}));
    expect(cleared()).toHaveLength(1);
  });
});

/** The prompt bar in the shell double, found by the id the page gives it. */
function byIdDouble(scene: ReturnType<typeof shellDesk>) {
  return scene.root.getElementById(PROMPT_FORM_ID);
}
