// The desk a narration test runs a build on: the real `public/app.js` closing the run's stream,
// with `public/desk/build-narration.js` started beside it as the page starts it, and the facts
// arriving the way a build sends them. Timers are the test's, so a hold is waited out, not slept.

import { afterEach, beforeAll, jest } from "bun:test";
import { DRAWN_BY } from "#design/narration/sheet.js";
import type { Part } from "#design/narration/voice.js";
import { PROMPT_FIELD_ID, PROMPT_FORM_ID } from "#shell/core/shell-dom.js";
import {
  type ProgressFact,
  plannedStages,
} from "../../../../pipeline/streaming/build-narration.ts";
import { renderBuildSubscriber } from "../../../../server/http/fragments/fragments.ts";
import { installDomGlobals } from "../../../controls/double/choice-picker.fixture.test-support.ts";
import { type El, parseHtml } from "../../../controls/double/choice-picker.test-support.ts";
import { recordDesk, startTheGlue } from "../../../records/record-view/record-view.test-support.ts";

let desk: Awaited<ReturnType<typeof recordDesk>> | undefined;

/** Put the desk away and give the test its own clock back. */
export function restoreDesk(): void {
  jest.useRealTimers();
  desk?.restore();
  desk = undefined;
}

/** What a test file of the narration calls at its top: the DOM double, its styles, its cleanup. */
export function useNarrationDesk(): void {
  installDomGlobals();
  beforeAll(() => {
    Object.assign(globalThis, { getComputedStyle: (node: El) => ({ ...node.computed }) });
  });
  afterEach(restoreDesk);
}

/** A real event, aimed at a node of the desk, the way htmx sends its own. */
function send(node: El, type: string, detail: unknown): boolean {
  return node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: true }));
}

/** A desk whose window holds a run sent from the prompt bar, its stream open. */
export async function deskWithARun() {
  desk = await recordDesk("<p>Notes</p>", { modules: ["desk/build-narration.js"] });
  const { doc, region } = desk;
  parseHtml(`<form id="${PROMPT_FORM_ID}"><input id="${PROMPT_FIELD_ID}"></form>`, doc);
  const frames: (() => void)[] = [];
  startTheGlue(doc, frames);
  const bar = doc.getElementById(PROMPT_FORM_ID) as El;
  send(bar, "htmx:beforeSend", { elt: bar });
  parseHtml(renderBuildSubscriber("build-9"), region);
  const run = region.querySelector(".build-stream") as El;
  const narration = run.querySelector(".build-stream__narration") as El;
  const commit = run.querySelector(".build-stream__commit") as El;
  send(run, "htmx:sseOpen", null);
  jest.useFakeTimers();
  return {
    region,
    tell: (fact: ProgressFact) =>
      send(narration, "htmx:sseBeforeMessage", { type: "progress", data: JSON.stringify(fact) }),
    /** The run's own last words, swapped in after the drawing, its Continue out of band. */
    end: (raw: string) => {
      parseHtml(raw, narration);
      for (const elsewhere of narration.querySelectorAll("[hx-swap-oob]")) elsewhere.remove();
      send(narration, "htmx:sseMessage", { type: "narration" });
    },
    land: (raw: string) => {
      parseHtml(raw, commit);
      send(commit, "htmx:sseMessage", { type: "commit" });
    },
    close: () => send(run, "htmx:sseClose", { type: "message" }),
    /** Let `ms` pass, and whatever the passing time let go settle and paint. */
    wait: async (ms: number) => {
      jest.advanceTimersByTime(ms);
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
      for (const frame of frames.splice(0)) frame();
    },
    /** What the narration's line says now, a line on its way out not counted. */
    line: () => {
      const said = narration
        .querySelectorAll(".narration__said")
        .filter((node) => !node.classList.contains("is-leaving"));
      return (said.at(-1) ?? narration.querySelector(".narration__line"))?.textContent?.trim();
    },
    drawing: () => narration.querySelector(".narration") as El,
    standing: () => region.querySelector(".build-stream") !== null,
  };
}

export const PLAN: ProgressFact = {
  kind: "plan",
  stages: plannedStages({ rules: false, connect: false }),
};

export const PARTS: Part[] = ["card", "add", "open", "change", "remove", "search"];

/** @param parts which parts the spec asks for */
export function shapeOf(parts: Part[] = PARTS): ProgressFact {
  const fields = ["Name", "Serves"];
  return { kind: "shape", label: "Recipes", noun: "recipe", plural: "recipes", fields, parts };
}

export type Run = Awaited<ReturnType<typeof deskWithARun>>;

export const shapesOf = (run: Run, part: Part, kind: "part" | "ghost" = "part") =>
  DRAWN_BY[part].flatMap((name) =>
    run.drawing().querySelectorAll(`[data-${kind}="${name}"]:not([data-leaving])`),
  );
export const stateOf = (node: El) => node.getAttribute("data-state");
export const reachOf = (node: El) => Number(node.style["--narration-reach"]);
/** How long the stroke takes to reach where it is heading, in milliseconds. */
export const paceOf = (node: El) => Number.parseFloat(node.style["--narration-pace"] ?? "");
/** How long the stroke waits before it sets out, in milliseconds. */
export const delayOf = (node: El) => {
  const [, delay = "0"] = (node.style["--narration-pace"] ?? "").match(/[\d.]+(?=m?s)/g) ?? [];
  return Number(delay);
};

/** A run that has planned, shaped and started making, `parts` all made before `making`. */
export async function runMaking(making: Part, made: Part[] = []) {
  const run = await deskWithARun();
  run.tell(PLAN);
  run.tell({ kind: "stage", stage: "plan" });
  run.tell(shapeOf());
  run.tell({ kind: "stage", stage: "make" });
  for (const part of made) {
    run.tell({ kind: "part", part, state: "making" });
    run.tell({ kind: "part", part, state: "made" });
  }
  run.tell({ kind: "part", part: making, state: "making" });
  return run;
}

/** A run whose every part is made, its checks just begun. */
export async function runChecking() {
  const run = await runMaking("search", PARTS.slice(0, -1));
  run.tell({ kind: "part", part: "search", state: "made" });
  run.tell({ kind: "stage", stage: "check" });
  return run;
}

/** The parts the checks have gone over in ink, every one of their shapes. */
export const inkingOf = (run: Run) =>
  PARTS.filter((part) => shapesOf(run, part).every((node) => stateOf(node) === "inking"));
