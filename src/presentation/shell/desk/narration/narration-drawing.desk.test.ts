// The drawing a narration makes of the window being built: a ghost from the first fact, each part
// drawn over it while it is made, gone over in ink by the checks, and left as it stood when a run
// stops. These follow whole runs; the pace of any one stroke is the stylesheet's to show.

import { describe, expect, test } from "bun:test";
import { USUAL_PART_MS } from "#design/narration/narrator.js";
import { listed, type Part, PARTS as SAID, STAGES, say } from "#design/narration/voice.js";
import { plannedStages } from "../../../../pipeline/streaming/build-narration.ts";
import { renderBuildEnding } from "../../../../server/http/fragments/fragments.ts";
import type { El } from "../../../controls/double/choice-picker.test-support.ts";
import {
  delayOf,
  deskWithARun,
  inkingOf,
  PARTS,
  PLAN,
  paceOf,
  reachOf,
  restoreDesk,
  runChecking,
  runMaking,
  shapeOf,
  shapesOf,
  stateOf,
  useNarrationDesk,
} from "./narration-desk.test-support.ts";

useNarrationDesk();

/** Every shape of the parts, each in this state. */
const allIn = (run: Awaited<ReturnType<typeof deskWithARun>>, state: string) =>
  PARTS.every((part) => shapesOf(run, part).every((node) => stateOf(node) === state));

describe("its drawing", () => {
  test("the whole window stands as a ghost from the first fact, before any part is drawn", async () => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "plan" });

    for (const part of PARTS) {
      expect(shapesOf(run, part, "ghost").length, part).toBeGreaterThan(0);
      expect(
        shapesOf(run, part).some((node) => stateOf(node) !== null),
        part,
      ).toBe(false);
    }
    // The frame is drawn over a ghost made in the same moment, which stays until it is done.
    const frame = (kind: string) => run.drawing().querySelector(`[data-${kind}="frame"]`) as El;
    expect([stateOf(frame("part")), stateOf(frame("ghost"))]).toEqual(["sketching", null]);
  });

  test("a build draws each part over its ghost, inks it in the checks and lands inked", async () => {
    const run = await runMaking("card");
    expect(shapesOf(run, "card").every((node) => stateOf(node) === "sketching")).toBe(true);
    expect(shapesOf(run, "card", "ghost").every((node) => stateOf(node) === "fading")).toBe(true);
    run.tell({ kind: "part", part: "card", state: "made" });
    for (const part of PARTS.slice(1)) {
      run.tell({ kind: "part", part, state: "making" });
      run.tell({ kind: "part", part, state: "made" });
    }
    expect(allIn(run, "sketched")).toBe(true);

    run.tell({ kind: "stage", stage: "check" });
    await run.wait(20_000);
    expect(inkingOf(run)).toEqual(PARTS);
    for (const part of PARTS) run.tell({ kind: "part", part, state: "checked" });
    run.tell({ kind: "stage", stage: "finish" });
    run.tell({ kind: "finish", elapsedMs: 100_000 });
    run.land('<div data-landed="recipes">Recipes</div>');
    expect(allIn(run, "inked")).toBe(true);
    expect(run.drawing().classList.contains("is-done")).toBe(true);
  });

  test("a part is drawn one stroke after another, each ghost going as its stroke is drawn", async () => {
    const run = await runMaking("card");
    const strokes = shapesOf(run, "card").toSorted((a, b) => delayOf(a) - delayOf(b));
    const last = strokes.at(-1) as El;
    expect(strokes.length).toBeGreaterThan(2);
    expect(delayOf(strokes[0] as El)).toBe(0);
    strokes.slice(1).forEach((stroke, i) => {
      const before = strokes[i] as El;
      expect(delayOf(stroke)).toBe(delayOf(before) + paceOf(before));
      expect(reachOf(before)).toBeLessThan(reachOf(last));
    });
    expect(delayOf(last) + paceOf(last)).toBeLessThanOrEqual(USUAL_PART_MS.card);
    expect(delayOf(last) + paceOf(last)).toBeGreaterThan(USUAL_PART_MS.card / 2);

    const where = (node: El) => ["x", "y", "d"].map((name) => node.getAttribute(name)).join();
    const fadesAfter = (ghost: El) =>
      Number.parseFloat(ghost.style["--narration-fade-delay"] ?? "");
    const ghosts = new Map(shapesOf(run, "card", "ghost").map((ghost) => [where(ghost), ghost]));
    const fadesOver = (ghost: El) => Number.parseFloat(ghost.style["--narration-fade"] ?? "");
    for (const stroke of strokes) {
      const ghost = ghosts.get(where(stroke)) as El;
      expect([fadesAfter(ghost), fadesOver(ghost)]).toEqual([delayOf(stroke), paceOf(stroke)]);
    }
  });

  test("a part made early finishes every stroke at once, those still waiting their turn too", async () => {
    const run = await runMaking("card");
    await run.wait(1_000);
    const strokes = shapesOf(run, "card");
    // Aimed short of its end, so finishing a stroke is a change even before it sets out.
    expect(strokes.every((node) => reachOf(node) > 0)).toBe(true);

    run.tell({ kind: "part", part: "card", state: "made" });
    expect(strokes.every((node) => reachOf(node) === 0 && delayOf(node) === 0)).toBe(true);
    expect(strokes.every((node) => paceOf(node) > 0 && paceOf(node) < 1_000)).toBe(true);
  });

  test("a part that runs long is still being drawn, and finishes only once it is made", async () => {
    const run = await runMaking("search");
    const drawing = shapesOf(run, "search");
    const last = drawing.at(-1) as El;
    const swept = reachOf(last);
    await run.wait(USUAL_PART_MS.search);
    const crawled = reachOf(last);
    expect(crawled).toBeLessThan(swept);
    expect(paceOf(last)).toBeGreaterThan(USUAL_PART_MS.search);
    await run.wait(10 * 60_000);
    expect(drawing.every((node) => stateOf(node) === "sketching")).toBe(true);
    expect(reachOf(last)).toBeGreaterThan(0);
    expect(reachOf(last)).toBeLessThan(crawled);

    run.tell({ kind: "part", part: "search", state: "made" });
    await run.wait(10 * 60_000);
    expect(drawing.every((node) => stateOf(node) === "sketched" && reachOf(node) === 0)).toBe(true);
    expect(paceOf(last)).toBeLessThan(USUAL_PART_MS.search);
  });

  test("a part remade while it is made goes on being drawn at the pace it was", async () => {
    /** Where the part's last stroke stands at each half of its usual time, remade or not. */
    const crawl = async (remade: boolean) => {
      const run = await runMaking("search");
      const drawing = shapesOf(run, "search");
      const reaches: number[] = [];
      for (let half = 1; half <= 6; half += 1) {
        await run.wait(USUAL_PART_MS.search / 2);
        if (remade && half === 1) {
          run.tell({ kind: "part", part: "search", state: "mending" });
          expect(drawing.every((node) => stateOf(node) === "mending")).toBe(true);
        }
        reaches.push(reachOf(drawing.at(-1) as El));
      }
      restoreDesk();
      return reaches;
    };
    const steady = await crawl(false);
    expect(steady.at(-1)).toBeLessThan(steady[0] as number);
    expect(await crawl(true)).toStrictEqual(steady);
  });
});

describe("its drawing while the house rules are written", () => {
  test("each Action's part grows surer as its rules are written, the rest left as they were", async () => {
    const run = await deskWithARun();
    run.tell({ kind: "plan", stages: plannedStages({ rules: true, connect: false }) });
    run.tell({ kind: "stage", stage: "plan" });
    run.tell(shapeOf());
    run.tell({ kind: "stage", stage: "rules" });
    run.tell({ kind: "rules", part: "add", state: "writing" });
    run.tell({ kind: "rules", part: "open", state: "writing" });
    run.tell({ kind: "rules", part: "add", state: "written" });
    run.tell({ kind: "rules", part: "remove", state: "written" });

    const rulesOf = (part: Part) =>
      shapesOf(run, part, "ghost").map((node) => node.getAttribute("data-rules"));
    expect(rulesOf("add").every((state) => state === "written")).toBe(true);
    expect(rulesOf("open").every((state) => state === "writing")).toBe(true);
    // Rules written, however quickly, or carried over, finish growing sure at once.
    const fadeOf = (part: Part) =>
      Number.parseFloat((shapesOf(run, part, "ghost")[0] as El).style["--narration-fade"] ?? "");
    expect(fadeOf("add")).toBeLessThan(fadeOf("open"));
    expect(fadeOf("remove")).toBeLessThan(fadeOf("open"));
    for (const part of PARTS.filter((each) => !["add", "open", "remove"].includes(each))) {
      expect(
        rulesOf(part).every((state) => state === null),
        part,
      ).toBe(true);
    }
    // Their dashes edge along, written or not, for as long as the stage lasts (narration.css).
    const stage = () =>
      run.drawing().querySelector(".narration__sheet")?.getAttribute("data-stage");
    expect(stage()).toBe("rules");
    run.tell({ kind: "stage", stage: "make" });
    expect(stage()).toBe("make");
  });
});

/** A run whose checks found `part` wanting, and which is mending it now. */
async function runMending(part: Part) {
  const run = await runChecking();
  run.tell({ kind: "stage", stage: "mend" });
  run.tell({ kind: "part", part, state: "mending" });
  return run;
}

/** Past the moment a part being mended takes to be rubbed out. */
const RUBBED_OUT_MS = 1_000;

describe("its drawing while a part is mended", () => {
  test("the part is rubbed out over its ghost, drawn again stroke by stroke, and finished once mended", async () => {
    const run = await runMending("search");
    const strokes = shapesOf(run, "search");
    expect(strokes.every((node) => stateOf(node) === "mending" && reachOf(node) === 1)).toBe(true);
    expect(strokes.every((node) => delayOf(node) === 0 && paceOf(node) < RUBBED_OUT_MS)).toBe(true);
    expect(shapesOf(run, "search", "ghost").every((ghost) => stateOf(ghost) === null)).toBe(true);

    await run.wait(RUBBED_OUT_MS);
    const [first, last] = strokes.toSorted((a, b) => delayOf(a) - delayOf(b)) as [El, El];
    expect([delayOf(first), delayOf(last)]).toEqual([0, paceOf(first)]);
    expect(reachOf(first)).toBeLessThan(reachOf(last));
    expect(shapesOf(run, "search", "ghost").every((ghost) => stateOf(ghost) === "fading")).toBe(
      true,
    );
    const swept = reachOf(last);
    await run.wait(USUAL_PART_MS.search * 2);
    expect(reachOf(last)).toBeLessThan(swept);
    expect(reachOf(last)).toBeGreaterThan(0);

    run.tell({ kind: "stage", stage: "check" });
    expect(strokes.every((node) => stateOf(node) === "sketched" && reachOf(node) === 0)).toBe(true);
  });

  test("a part mended again is drawn again from the start, the first drawing left behind", async () => {
    /** Where the part's last stroke stands at each half of its usual time, once it is mended. */
    const crawl = async (again: boolean) => {
      const run = await runMending("card");
      if (again) {
        await run.wait(USUAL_PART_MS.card * 0.7);
        run.tell({ kind: "stage", stage: "check" });
        run.tell({ kind: "stage", stage: "mend" });
        run.tell({ kind: "part", part: "card", state: "mending" });
      }
      const last = shapesOf(run, "card").at(-1) as El;
      const reaches: number[] = [];
      for (let half = 0; half < 6; half += 1) {
        await run.wait(RUBBED_OUT_MS + USUAL_PART_MS.card / 2);
        reaches.push(reachOf(last));
      }
      restoreDesk();
      return reaches;
    };
    expect(await crawl(true)).toStrictEqual(await crawl(false));
  });

  test("a part mended again just as its old drawing crawls on is rubbed out all the same", async () => {
    let run = await runMending("card");
    const last = () => shapesOf(run, "card").at(-1) as El;
    await run.wait(RUBBED_OUT_MS);
    const swept = reachOf(last());
    let crawlsAt = RUBBED_OUT_MS;
    while (reachOf(last()) === swept) {
      await run.wait(100);
      crawlsAt += 100;
    }
    restoreDesk();

    run = await runMending("card");
    await run.wait(crawlsAt - 200);
    run.tell({ kind: "stage", stage: "check" });
    run.tell({ kind: "stage", stage: "mend" });
    run.tell({ kind: "part", part: "card", state: "mending" });
    await run.wait(300);
    expect(reachOf(last())).toBe(1);
  });

  test("a part mended before it is even rubbed out finishes at once, its ghost gone", async () => {
    const run = await runMending("search");
    await run.wait(RUBBED_OUT_MS / 5);
    run.tell({ kind: "stage", stage: "check" });
    await run.wait(USUAL_PART_MS.search);
    const strokes = shapesOf(run, "search");
    expect(strokes.every((node) => reachOf(node) === 0 && delayOf(node) === 0)).toBe(true);
    expect(shapesOf(run, "search", "ghost").every((ghost) => stateOf(ghost) === "gone")).toBe(true);
  });

  test.each([
    ["being rubbed out", RUBBED_OUT_MS / 5],
    ["being drawn again", RUBBED_OUT_MS * 2],
  ])("a run that stops while a part is %s leaves it where it stood", async (_, after) => {
    const run = await runMending("search");
    await run.wait(after);
    const strokes = shapesOf(run, "search");
    for (const stroke of strokes) Object.assign(stroke.computed, { strokeDashoffset: "0.6" });
    run.close();
    await run.wait(10 * 60_000);
    expect(strokes.map((node) => [reachOf(node), paceOf(node), delayOf(node)])).toStrictEqual(
      strokes.map(() => [0.6, 0, 0]),
    );
  });

  test("what it says names every piece being mended, and lasts as long as the slowest", async () => {
    const run = await runMending("search");
    run.tell({ kind: "part", part: "open", state: "mending" });
    const piece = listed([SAID.open.name, SAID.search.name]);
    const lines = STAGES.mend.lines.map((line) => say(line, { piece }));
    await run.wait(3_000);
    expect(run.line()).toBe(lines[0]);
    await run.wait(USUAL_PART_MS.search / 2);
    expect(run.line()).not.toBe(lines.at(-1));
    await run.wait(USUAL_PART_MS.search);
    expect(run.line()).toBe(lines.at(-1));
  });

  test("a part remade while it is made goes on saying its own lines", async () => {
    const run = await runMaking("search");
    const own = SAID.search.lines.map((line) => say(line, {}));
    await run.wait(3_000);
    expect(own).toContain(run.line() ?? "");
    run.tell({ kind: "part", part: "search", state: "mending" });
    await run.wait(USUAL_PART_MS.search / 2);
    expect(own).toContain(run.line() ?? "");
  });
});

describe("its drawing through the checks", () => {
  test("a repair is drawn in clay, and the checks after it ink every part again", async () => {
    const run = await runChecking();
    await run.wait(1);
    run.tell({ kind: "stage", stage: "mend" });
    run.tell({ kind: "part", part: "change", state: "mending" });
    await run.wait(20_000);
    expect(shapesOf(run, "change").every((node) => stateOf(node) === "mending")).toBe(true);
    expect(inkingOf(run)).not.toContain("change");

    run.tell({ kind: "stage", stage: "check" });
    await run.wait(20_000);
    expect(inkingOf(run)).toEqual(PARTS);
  });

  test("a quick verdict keeps its ink, whatever inking was still on its way", async () => {
    const run = await runChecking();
    for (const part of PARTS) run.tell({ kind: "part", part, state: "checked" });
    await run.wait(20_000);
    expect(allIn(run, "inked")).toBe(true);
  });
});

describe("its drawing, when the run stops", () => {
  test("a run that goes without a last word leaves its pencil and its ghosts where they stood", async () => {
    const run = await runMaking("search");
    const stroke = shapesOf(run, "search").at(-1) as El;
    const [ghost] = shapesOf(run, "search", "ghost") as [El];
    Object.assign(stroke.computed, { strokeDashoffset: "0.4" });
    Object.assign(ghost.computed, { opacity: "0.13" });
    run.close();
    await run.wait(60_000);

    expect([reachOf(stroke), paceOf(stroke), delayOf(stroke)]).toEqual([0.4, 0, 0]);
    const { opacity, "--narration-fade": fade, "--narration-fade-delay": wait } = ghost.style;
    expect([opacity, fade, wait]).toEqual(["0.13", "0s", "0s"]);
    // The dashes of a ghost whose rules were being written stop with it (narration.css).
    expect(run.drawing().querySelector(".narration__sheet")?.hasAttribute("data-still")).toBe(true);
  });

  test.each([
    ["a run that failed lets go of every piece it had not inked, its ghost with it", "failed"],
    ["a run with nothing to change lets go of nothing", "unchanged"],
  ] as const)("%s", async (_, ending) => {
    const run = await runChecking();
    await run.wait(3_000);
    expect(inkingOf(run).length).toBeGreaterThan(0);
    run.tell({ kind: "part", part: "remove", state: "checked" });
    run.end(renderBuildEnding("build-9", "That one ended.", ending));

    // A piece leans as one, its shapes and its ghost's in one group each.
    const pieceOf = (node: El) => node.closest("[data-piece], [data-ghost-piece]") as El;
    const loose = (node: El) => pieceOf(node).hasAttribute("data-loose");
    const frame = run.drawing().querySelector('[data-part="frame"]') as El;
    expect(frame.closest("[data-piece]")).toBeNull();
    expect(shapesOf(run, "remove").some(loose)).toBe(false);
    const held = PARTS.filter((part) => part !== "remove").flatMap((part) => [
      ...shapesOf(run, part),
      ...shapesOf(run, part, "ghost"),
    ]);
    expect(held.filter(loose).length).toBe(ending === "failed" ? held.length : 0);
    if (ending === "unchanged") return;
    // The checks' ink, never confirmed, goes back to pencil: what holds is what is inked.
    expect(inkingOf(run)).toStrictEqual([]);
    expect(shapesOf(run, "add").every((node) => stateOf(node) === "sketched")).toBe(true);
    // One after another, each piece leaning by an angle of its own.
    const after = (node: El) =>
      Number.parseFloat(pieceOf(node).style["--narration-lean-delay"] ?? "");
    const inTurn = (["search", "add", "card", "open", "change"] as const).map(
      (part) => shapesOf(run, part)[0] as El,
    );
    const leaning = run.drawing().querySelectorAll("[data-loose]");
    expect(
      leaning.every((node) => /^[1-9][\d.]*deg$/.test(node.style["--narration-lean"] ?? "")),
    ).toBe(true);
    const cards = new Set(shapesOf(run, "card").map(pieceOf));
    expect(new Set([...cards].map((card) => card.style["--narration-lean"])).size).toBe(2);
    inTurn.slice(1).forEach((node, i) => {
      expect(after(node) - after(inTurn[i] as El)).toBeGreaterThanOrEqual(20);
    });
    expect(shapesOf(run, "add", "ghost").map(after)).toEqual(shapesOf(run, "add").map(after));
  });

  test("a failed run leaves be what it kept, and what it was never going to make", async () => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "plan" });
    run.tell(shapeOf(PARTS.filter((part) => part !== "remove")));
    run.tell({ kind: "stage", stage: "room" });
    run.tell({ kind: "part", part: "open", state: "kept" });
    run.tell({ kind: "stage", stage: "make" });
    run.tell({ kind: "part", part: "card", state: "making" });
    run.end(renderBuildEnding("build-9", "That one ended.", "failed"));

    const loose = (part: Part) =>
      (shapesOf(run, part)[0]?.closest("[data-piece]") as El).hasAttribute("data-loose");
    expect(["open", "remove", "change", "card"].map((part) => loose(part as Part))).toStrictEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  test("a part the build will not make loses its ghost once the shape is known", async () => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "plan" });
    run.tell(shapeOf(PARTS.filter((part) => part !== "remove")));

    expect(shapesOf(run, "remove", "ghost").every((node) => stateOf(node) === "gone")).toBe(true);
    expect(shapesOf(run, "change", "ghost").every((node) => stateOf(node) === null)).toBe(true);
  });
});
