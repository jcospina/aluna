import { expect } from "bun:test";
import { type NarrationStage, PROGRESS_EVENT, type ProgressFact } from "./build-narration.ts";

/** The facts a run told its window, in the order it told them. */
export function toldFacts(events: readonly { event: string; data: string }[]): ProgressFact[] {
  return events
    .filter(({ event }) => event === PROGRESS_EVENT)
    .map(({ data }) => JSON.parse(data) as ProgressFact);
}

/** The stages a run entered, a mend among them when a check needed one. */
export function toldStages(facts: readonly ProgressFact[]): NarrationStage[] {
  return facts.flatMap((fact) => (fact.kind === "stage" ? [fact.stage] : []));
}

/**
 * The squares the window was last told to draw are `listen` and then every stage it entered, a
 * stage returned to after a mend counting once.
 */
export function expectThePlanKept(facts: readonly ProgressFact[]): void {
  const plans = facts.flatMap((fact) => (fact.kind === "plan" ? [fact.stages] : []));
  const entered = toldStages(facts)
    .filter((stage) => stage !== "mend")
    .filter((stage, index, all) => stage !== all[index - 1]);
  expect(plans.at(-1)).toStrictEqual(["listen", ...entered]);
}

/** Each of `sequence` was told after the one before it, with anything else between them. */
export function expectToldInOrder(
  facts: readonly ProgressFact[],
  sequence: readonly ProgressFact[],
): void {
  let from = 0;
  for (const fact of sequence) {
    const at = facts.findIndex((each, index) => index >= from && Bun.deepEquals(each, fact));
    expect(at, JSON.stringify(fact)).toBeGreaterThanOrEqual(from);
    from = at + 1;
  }
}

/** Every Action's house rules were told written before the first part was made. */
export function expectRulesWrittenBeforeMaking(facts: readonly ProgressFact[]): void {
  const making = facts.findIndex((fact) => fact.kind === "stage" && fact.stage === "make");
  expect(making).toBeGreaterThan(0);
  const shape = facts.find((fact) => fact.kind === "shape");
  const written = facts
    .slice(0, making)
    .flatMap((fact) => (fact.kind === "rules" && fact.state === "written" ? [fact.part] : []));
  const actions = shape?.kind === "shape" ? shape.parts.filter((part) => part !== "card") : [];
  expect(actions.length).toBeGreaterThan(0);
  expect(written.toSorted()).toStrictEqual(actions.toSorted());
}

/** How long the window was told the wait was. */
export function toldWait(facts: readonly ProgressFact[]): number | undefined {
  const finish = facts.find((fact) => fact.kind === "finish");
  return finish?.kind === "finish" ? finish.elapsedMs : undefined;
}
