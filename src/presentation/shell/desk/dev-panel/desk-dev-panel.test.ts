// The developer panel: the second window.
//
// D13 is a named exception to D1, not the first step towards a window manager. What is
// pinned here is everything that would quietly turn it into one — a z-index that climbs,
// an address of its own, a panel that opens a window of its own — plus the two halves of
// "it is read-only": the panel carries no controls at all, nothing in it mutates canonical
// state, and the only thing it writes anywhere is the second of exactly two presentation
// records. Module 6's answer window is the other exception and has its own suite
// (`src/presentation/shell/window/answer/desk-answer-window.test.ts`); what it adds to this one is
// that it adds nothing — no third record, and no third slot in the stack.

import { describe, expect, test } from "bun:test";
import { EDGE, PROMPT_CLEARANCE } from "#design/desk/desk-geometry.js";
import { devTile } from "#design/desk/desk-logo.js";
import { DEV_STAGES } from "#design/desk/devpanel.js";
import {
  DEV_TILE_SELECTOR,
  devDefaultBox,
  storedOpenFlag,
} from "#shell/desk/window/desk-dev-panel.js";
import {
  BACK_Z,
  FRONT_Z,
  joinStack,
  leaveStack,
  standingCount,
} from "#shell/desk/window/desk-stack.js";
import { renderBuildSubscriber } from "../../../../server/http/fragments/fragments.ts";
import { elementsOf } from "../../../../server/http/served-page.test-support.ts";
import { El, parseHtml } from "../../../controls/double/choice-picker.test-support.ts";
import { readSource as read } from "../../../safety/source.test-support.ts";
import { stackMember } from "../../window/desk-window.test-support.ts";
import { type El as DeskEl, standingDesk } from "../../window/standing-desk.test-support.ts";

/** The mark a tile carries: its drawing box, its stroke, and the lines drawn in it. */
interface Mark {
  readonly viewBox: string | null;
  readonly stroke: string | null;
  readonly paths: readonly (string | null)[];
}

/** The mark the handbook's own tile draws, built by running `design/scripts/desk/desk-logo.js`. */
function designMark(): Mark {
  const desk = standingDesk();
  try {
    const svg = devTile(() => {}).querySelector("svg") as DeskEl;
    return {
      viewBox: svg.getAttribute("viewBox"),
      stroke: svg.getAttribute("stroke-width"),
      paths: svg.querySelectorAll("path").map((path) => path.getAttribute("d")),
    };
  } finally {
    desk.restore();
  }
}

/** The mark the shipped page's tile carries, read off the page as served. */
async function servedMark(): Promise<Mark> {
  const page = await elementsOf(read("public/index.html"));
  const hook = /^\[([\w-]+)\]$/.exec(DEV_TILE_SELECTOR)?.[1] ?? DEV_TILE_SELECTOR;
  const at = page.findIndex((element) => element.attributes.has(hook));
  const next = page.findIndex((element, index) => index > at && element.tag === "button");
  const tile = page.slice(at, next < 0 ? undefined : next);
  const svg = tile.find((element) => element.tag === "svg");
  return {
    viewBox: svg?.attributes.get("viewbox") ?? svg?.attributes.get("viewBox") ?? null,
    stroke: svg?.attributes.get("stroke-width") ?? null,
    paths: tile
      .filter((element) => element.tag === "path")
      .map((path) => path.attributes.get("d") ?? null),
  };
}

/** The desk, as the geometry module measures one. */
const desk = (width: number, height: number) =>
  ({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
  }) as unknown as Parameters<typeof devDefaultBox>[0];

describe("it is the second window, and it opens no window of its own", () => {
  test("the address wins on load; a restored panel stands behind it", () => {
    // Nobody asked for the panel on this visit, a remembered preference did, so the URL's
    // capability is in front. A lone restored panel is still raised: a phone shows one window.
    const address = stackMember();
    const panel = stackMember();
    joinStack(address);
    joinStack(panel, false);
    expect(panel.marks.z).toBe(BACK_Z);
    expect(panel.marks.focused).toBe(false);
    // The capability window keeps the front slot, and keeps being read as the window in front:
    // a panel counted as the front one cancels the next press on the window the person is in.
    expect(address.marks.z).toBe(FRONT_Z);
    leaveStack(panel);
    expect(address.marks.z).toBe(FRONT_Z);
    leaveStack(address);

    const alone = stackMember();
    joinStack(alone, false);
    expect(alone.marks.z, "a lone restored panel was left behind an empty desk").toBe(FRONT_Z);
    leaveStack(alone);
    expect(standingCount()).toBe(0);
  });
});

describe("the tile is the way in, and it is not a capability", () => {
  test("both surfaces draw the same mark, and it is a drawing rather than type", async () => {
    // The handbook builds the tile in script and the shell ships it as static markup, so the mark
    // exists twice and a drifted pair checks the product against a tile that is not its.
    const drawn = designMark();
    const served = await servedMark();
    expect(drawn.paths.length).toBeGreaterThan(0);
    expect(served).toEqual(drawn);
    const stroke = drawn.stroke;
    // A subject's weight, not `--line`. The boundary on this tile is its edge; a
    // hairline on the glass reads as type someone left there rather than a drawing.
    expect(Number(stroke)).toBeGreaterThan(4);
  });
});

describe("the second presentation record, and the last", () => {
  test("a bad record still opens the panel, and a bad flag still opens the desk", () => {
    // A presentation preference is the shell's to keep and never to depend on. The flag is read
    // on its own, so a record whose box is nonsense still says whether the panel was standing.
    const store = (raw: string | null) => ({ getItem: () => raw, setItem: () => {} });
    expect(storedOpenFlag(store("{"))).toBe(false);
    expect(storedOpenFlag(store("null"))).toBe(false);
    expect(storedOpenFlag(store("[]"))).toBe(false);
    expect(storedOpenFlag(store('{"open":"yes"}'))).toBe(false);
    expect(storedOpenFlag(store('{"x":"nope","open":true}'))).toBe(true);
    expect(storedOpenFlag(null)).toBe(false);
    expect(
      storedOpenFlag({
        getItem() {
          throw new Error("site data blocked");
        },
        setItem: () => {},
      }),
    ).toBe(false);
  });
});

describe("where the panel opens", () => {
  test("a narrow column at the right edge, above the prompt bar's floor", () => {
    const bounds = desk(1280, 720);
    const box = devDefaultBox(bounds);

    // Against the edge, because the whole point of the exception is that it sits
    // beside what it is reporting on rather than over it.
    expect(box.x + box.w).toBe(bounds.width - EDGE);
    expect(box.y).toBe(EDGE);
    // Narrower than the capability window's 62%, because a payload is read a line at a
    // time and a wide column is worse.
    expect(box.w).toBeLessThan(Math.round(bounds.width * 0.62));
    // And it stops on the same floor the logo grid and the other window stop on.
    expect(box.y + box.h).toBeLessThanOrEqual(bounds.height - PROMPT_CLEARANCE);
  });

  test("a desk too small for the column still gets a clamped box, never a negative one", () => {
    const box = devDefaultBox(desk(320, 240));
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

describe("the seam a classic script reaches the panel across", () => {
  test("every preview listener names a stage the panel actually builds", () => {
    // The listeners used to name a `<pre>` in the shell. There is no such element now, so what a
    // listener names has to be one of the eight or its payload lands nowhere.
    const listeners = parseHtml(renderBuildSubscriber("build-7"), new El("div")).querySelectorAll(
      "[data-preview-stage]",
    );
    expect(listeners.length).toBeGreaterThan(0);
    const keys = new Set(DEV_STAGES.map((stage) => stage.key));
    for (const listener of listeners) {
      expect(keys.has(listener.getAttribute("data-preview-stage") ?? "")).toBe(true);
    }
    // The terminal error files under `commit`, not under the Gate whose verdict already arrived:
    // filing it there overwrote that verdict with the error that followed it.
    const error = listeners.find((node) => node.getAttribute("sse-swap") === "build-error-preview");
    expect(error?.getAttribute("data-preview-stage")).toBe("commit");
  });
});
