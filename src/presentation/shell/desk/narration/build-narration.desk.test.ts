// A build narrated in its window on the desk: how it lands, stops and ends, the line it says and
// the band over that line, with the facts arriving the way a build sends them.
import { describe, expect, test } from "bun:test";
import { clock, READY, say } from "#design/narration/voice.js";
import { plannedStages } from "../../../../pipeline/streaming/build-narration.ts";
import {
  CANDIDATE_NO_CHANGE_ENDING,
  FAILED_BUILD_ENDING,
} from "../../../../pipeline/streaming/terminal-presentation.ts";
import { renderBuildEnding } from "../../../../server/http/fragments/fragments.ts";
import type { El } from "../../../controls/double/choice-picker.test-support.ts";
import {
  deskWithARun,
  PLAN,
  restoreDesk,
  runChecking,
  runMaking,
  shapesOf,
  useNarrationDesk,
} from "./narration-desk.test-support.ts";

useNarrationDesk();

describe("a build narrated in its window", () => {
  test("one that lands holds its last line a moment, then the window becomes what it made", async () => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "check" });
    run.tell({ kind: "finish", elapsedMs: 83_000 });
    run.land('<div data-landed="recipes">Recipes</div>');
    run.close();
    await run.wait(500);

    expect(run.standing()).toBe(true);
    expect(run.line()).toBe(say(READY, { time: clock(83_000) }));

    await run.wait(5_000);
    expect(run.standing()).toBe(false);
    expect(run.region.querySelector('[data-landed="recipes"]')).not.toBeNull();
  });

  test("one whose stream goes without a last word stops talking where it stood", async () => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "plan" });
    run.tell({ kind: "opening", text: "I’ll make a place for your recipes." });
    await run.wait(3_000);
    const stoodAt = run.line();
    run.close();
    await run.wait(60_000);

    expect(stoodAt).toBeTruthy();
    expect(run.line()).toBe(stoodAt);
  });

  test.each([
    ["a failure is drawn as one", "failed", FAILED_BUILD_ENDING, true],
    ["nothing to change is not", "unchanged", CANDIDATE_NO_CHANGE_ENDING, false],
  ] as const)("its ending takes the line's place, and %s", async (_, ending, words, failed) => {
    const run = await deskWithARun();
    run.tell(PLAN);
    run.tell({ kind: "stage", stage: "plan" });
    run.end(renderBuildEnding("build-9", words, ending));
    await run.wait(1_000);

    expect(run.line()).toBe(words);
    expect(run.drawing().classList.contains("is-failed")).toBe(failed);
    // The one thing allowed more room than the line's box, now that nothing else will move.
    expect(run.drawing().classList.contains("is-concluded")).toBe(true);
  });

  test.each([
    ["one that failed keeps lit the square it stopped at", "failed", "now"],
    ["one with nothing to change counts that square done", "unchanged", "done"],
  ] as const)("an ending ends the band: %s, and no stage word or rule is left to go", async (_, ending, stoppedAt) => {
    const run = await runChecking();
    run.tell({ kind: "stage", stage: "mend" });
    run.tell({ kind: "part", part: "add", state: "mending" });
    await run.wait(3_000);
    const band = run.drawing();
    const squares = () =>
      band.querySelectorAll(".narration__dot").map((dot) => dot.getAttribute("data-state"));
    const stages = plannedStages({ rules: false, connect: false });
    const checking = stages.indexOf("check");
    const lit = (stopped: string, after: string) =>
      stages.map((_, i) => (i < checking ? "done" : i === checking ? stopped : after));
    // A mend has no square of its own, so the checks' square stays lit while it runs.
    expect(squares()).toStrictEqual(lit("now", ""));
    run.end(renderBuildEnding("build-9", "That one ended.", ending));
    await run.wait(1_000);

    expect(band.querySelector(".narration__stage")?.textContent).toBe("");
    const rule = band.querySelector(".narration__rule") as El;
    expect(rule.style["--narration-fill"]).toBe("100.00%");
    expect(squares()).toStrictEqual(lit(stoppedAt, "gone"));
  });

  test("whatever the run sends after its ending changes nothing", async () => {
    const run = await runMaking("add");
    run.end(renderBuildEnding("build-9", FAILED_BUILD_ENDING));
    const drawn = () => shapesOf(run, "open").map((node) => node.getAttribute("data-state"));
    const before = drawn();
    run.tell({ kind: "part", part: "add", state: "made" });
    run.tell({ kind: "part", part: "open", state: "making" });
    run.land('<div data-landed="recipes">Recipes</div>');
    await run.wait(20_000);

    expect(run.line()).toBe(FAILED_BUILD_ENDING);
    expect(run.drawing().querySelector(".narration__stage")?.textContent).toBe("");
    expect(drawn()).toStrictEqual(before);
    // The part it was making stopped where it stood.
    expect(
      shapesOf(run, "add").every((node) => node.style["--narration-pace"] === "0s linear"),
    ).toBe(true);
  });
});

describe("its line", () => {
  test("a sentence too long for the line's box is set smaller; one that fits is left be", async () => {
    const measured = Reflect.get(globalThis, "getComputedStyle") as (node: El) => object;
    const sized = (node: El) => ({ ...measured(node), fontSize: "24px" });
    Object.assign(globalThis, { getComputedStyle: sized });
    try {
      const sizes: string[] = [];
      for (const room of [10, 100]) {
        const run = await deskWithARun();
        run.tell(PLAN);
        run.tell({ kind: "stage", stage: "plan" });
        (run.drawing().querySelector(".narration__line") as El).clientHeight = room;
        await run.wait(3_000);
        const said = run.drawing().querySelector(".narration__said") as El;
        sizes.push(said.style.fontSize ?? "");
        restoreDesk();
      }
      const [tight, roomy] = sizes;
      expect(Number.parseFloat(tight ?? "")).toBeLessThan(24);
      expect(Number.parseFloat(tight ?? "")).toBeGreaterThan(0);
      expect(roomy ?? "").toBe("");
    } finally {
      Object.assign(globalThis, { getComputedStyle: measured });
    }
  });
});
