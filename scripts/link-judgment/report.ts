// What the pass prints: a block per case as it lands, and a results table. The
// Targets column scores the capability and field each relation points at. Which of the new
// capability's fields it starts from is a judgment of meaning, so Linked shows it for the owner.

import { LINK_STEP_GRACE_MS } from "../../src/pipeline/build/linking.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../../src/registry/index.ts";
import { EIGHT_CASES, STAGES } from "./cases.ts";
import type { Call, CaseResult, Rehearsal, Stage, Target } from "./pass.ts";

type Verdict =
  | "hit"
  | "miss"
  | "either"
  | "not a build"
  | "not measured"
  | "interrupted"
  | "failed";

/**
 * A hit links exactly the expected targets, one relation each, on a new capability: any other
 * answer is a miss against an expected relation. "none" is a hit when a new capability links
 * nothing, and an answer that builds nothing is not scored, nor is one the build would refuse.
 */
function verdictOf(result: CaseResult): Verdict {
  if (result.interrupted) return "interrupted";
  if (result.failure) return "failed";
  if (result.targets === null) return "either";
  if (result.refused) return "not measured";
  if (result.duplicate || result.intent?.type !== "new_capability") {
    return result.targets.length > 0 ? "miss" : "not a build";
  }
  const key = ({ capability, field }: Target) => JSON.stringify([capability, field]);
  const linked = result.relations.map(({ to }) => key(to)).sort();
  const expected = result.targets.map(key).sort();
  return linked.length === expected.length && linked.every((each, i) => each === expected[i])
    ? "hit"
    : "miss";
}

/** Where a pass or a case failed, as a sentence's subject. */
export const failedWhere = (stage: Stage | "script") =>
  stage === "script" ? "the script itself" : `the ${stage}`;

const VERDICT_TEXT: Record<Verdict, (result: CaseResult) => string> = {
  hit: () => "hit",
  miss: () => "miss",
  either: () => "—",
  "not a build": () => "— (not a build)",
  "not measured": () => "— (not measured: the build refuses it)",
  interrupted: () => "— (interrupted)",
  failed: ({ failure }) => `${failedWhere(failure?.stage ?? "script")} failed`,
};

function labelOf(desk: readonly CapabilityRow[], id: string | null | undefined): string {
  const row = desk.find((capability) => capability.id === id);
  return row ? canonicalCapabilityLabel(row) : String(id);
}

function resolvedAs(result: CaseResult): string {
  const { intent, desk } = result;
  if (!intent) return "—";
  const target = labelOf(desk, intent.target_capability);
  if (result.duplicate) return `already on the desk as ${target}`;
  switch (intent.type) {
    case "new_capability":
      return intent.resolution === "namespace"
        ? `new capability apart from ${target}`
        : "new capability";
    case "extend_capability":
      return `extends ${target}`;
    case "link_capability":
      return `links the existing fields of ${target}`;
    case "ui_change":
      return `changes the presentation of ${target}`;
    case "data_query":
      return "a question";
    case "reject":
      return "refused";
  }
}

/** Why the Resolver's own filter dropped an id its answer flagged. */
function whyUnflagged(result: CaseResult, id: string): string {
  if (id === result.intent?.target_capability) return "its own target";
  if (!result.desk.some((row) => row.id === id)) return "not on the desk";
  return `flags are not kept on ${result.intent?.type}`;
}

function flaggedOf(result: CaseResult): string {
  const { intent } = result;
  if (!intent || result.duplicate) return "—";
  const kept = intent.related_capabilities;
  const shown = kept.length > 0 ? kept.map((id) => labelOf(result.desk, id)).join(", ") : "none";
  const dropped = [...new Set(result.answeredFlags ?? [])]
    .filter((id) => !kept.includes(id))
    .map((id) => `${labelOf(result.desk, id)} (${whyUnflagged(result, id)})`);
  return dropped.length > 0 ? `${shown}; the filter dropped ${dropped.join(", ")}` : shown;
}

function specFieldsOf(result: CaseResult): string {
  const { spec } = result;
  if (!spec) return "—";
  const fields = spec.schema.fields.map((field) => {
    const long = field.type === "string" && spec.ui_intent.form.long_text.includes(field.name);
    const kind = field.type === "string" ? (long ? "long text" : "text") : field.type;
    const limit = field.max_length === undefined ? "" : `, max ${field.max_length}`;
    return `${field.name} (${kind}${limit})`;
  });
  return `${spec.label}: ${fields.join(", ")}`;
}

function arrow(result: CaseResult, field: string, capability: string, target: string): string {
  return `${field} → ${labelOf(result.desk, capability)} · ${target}`;
}

/** What the step kept, and in its own order what it dropped and why, when the replay agrees. */
function linkedOf(result: CaseResult): string {
  const kept = result.relations.map(({ field, to }) =>
    arrow(result, field, to.capability, to.field),
  );
  const said =
    result.proposals && !result.replayDiffers
      ? result.proposals.map(({ field, capability, target_field, refused }) =>
          refused === null
            ? arrow(result, field, capability, target_field)
            : `dropped ${field} → ${capability}.${target_field} (${refused})`,
        )
      : kept;
  if (result.replayDiffers) {
    said.push("this script's replay of the link rules disagrees with the step, so no reasons");
  }
  if (said.length > 0) return said.join("; ");
  if (result.proposals) return "none";
  if (result.failure) return "—";
  return `not run: ${result.stopped ?? result.refused ?? result.interrupted ?? "no link step"}`;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function tokens(calls: readonly Call[]): { input: number; output: number; missing: number } {
  let input = 0;
  let output = 0;
  let missing = 0;
  for (const { usage } of calls) {
    if (usage?.inputTokens === undefined || usage.outputTokens === undefined) missing += 1;
    input += usage?.inputTokens ?? 0;
    output += usage?.outputTokens ?? 0;
  }
  return { input, output, missing };
}

function costOf(results: readonly CaseResult[], timed = false): string {
  const calls = results.flatMap((result) => result.calls);
  const { input, output, missing } = tokens(calls);
  const n = (value: number) => value.toLocaleString("en-US");
  const times = calls.map(({ stage, ms }) => `${stage} ${ms === null ? "?" : seconds(ms)}`);
  const took = timed && times.length > 0 ? ` (${times.join(", ")})` : "";
  const count = `${calls.length} ${calls.length === 1 ? "call" : "calls"}`;
  const partial =
    missing === 0
      ? ""
      : calls.length === 1
        ? " (it reported no token counts)"
        : ` (${missing} of the ${calls.length} calls reported no token counts)`;
  return `${count}${took}, ${n(input)} input and ${n(output)} output tokens${partial}`;
}

function deskOf({ desk, eightCase }: Pick<CaseResult, "desk" | "eightCase">): string {
  return desk.length > 0
    ? desk.map((row) => canonicalCapabilityLabel(row)).join(", ")
    : eightCase.desk.join(", ");
}

/** What a pass would send, printed before anything is. */
export function planText(rehearsed: readonly Rehearsal[], model: string | null): string {
  const perCase = STAGES.length;
  const calling = rehearsed.filter(({ duplicate }) => !duplicate).length;
  const lines = rehearsed.map((rehearsal) => {
    const { number, request } = rehearsal.eightCase;
    const ending = rehearsal.duplicate
      ? "ends at the duplicate check, no call"
      : `up to ${perCase} calls`;
    return `  ${number}  ${deskOf(rehearsal).padEnd(16)} "${request}": ${ending}`;
  });
  return [
    `The eight-case set: ${rehearsed.length} of ${EIGHT_CASES.length} cases, at most ` +
      `${calling * perCase} calls${model ? ` to ${model}` : ""}, each case on a scratch desk.`,
    "As in the product, the provider retries a rate-limited, overloaded or dropped request up to",
    "twice before any answer streams. Those retries are not counted as calls.",
    "",
    ...lines,
    "",
  ].join("\n");
}

const indented = (text: string) => text.replace(/\n/g, `\n${" ".repeat(13)}`);

function lateLinkStep(result: CaseResult): string[] {
  const ms = result.calls.find(({ stage }) => stage === "link step")?.ms;
  if (ms === null || ms === undefined || ms <= LINK_STEP_GRACE_MS) return [];
  return [
    `  Note       the link step answered in ${seconds(ms)}. A build waits ` +
      `${seconds(LINK_STEP_GRACE_MS)} for it after its units finish, so a build would have ` +
      `linked nothing only if its units took under ${seconds(ms - LINK_STEP_GRACE_MS)}.`,
  ];
}

function failureLines(result: CaseResult): string[] {
  const { failure } = result;
  if (!failure) return [];
  return [
    `  Failure    ${indented(failure.message)}`,
    ...(failure.status ? [`  Status     ${indented(failure.status)}`] : []),
    ...(failure.cause ? [`  Cause      ${indented(failure.cause)}`] : []),
    ...(failure.finishReason ? [`  Finished   ${failure.finishReason}`] : []),
    ...(failure.answer ? [`  Answer     ${indented(failure.answer)}`] : []),
  ];
}

/** The lines printed the moment a case lands. */
export function caseBlock(result: CaseResult): string {
  const { eightCase, intent } = result;
  const lines = [
    `Case ${eightCase.number} · ${deskOf(result)} · "${eightCase.request}"`,
    `  Resolved   ${resolvedAs(result)}`,
    `  Flagged    ${flaggedOf(result)}`,
    ...(intent && !result.duplicate ? [`  Action     ${intent.proposed_action}`] : []),
    `  Spec       ${specFieldsOf(result)}`,
    `  Linked     ${linkedOf(result)}`,
    `  Expected   ${eightCase.expected}`,
    `  Targets    ${VERDICT_TEXT[verdictOf(result)](result)}`,
    `  Cost       ${costOf([result], true)}`,
    ...lateLinkStep(result),
    ...failureLines(result),
  ];
  return lines.join("\n");
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** The results table, one row per case that ran, and the pass's total cost. */
export function resultsTable(results: readonly CaseResult[]): string {
  const header = [
    "| # | Desk | Request | Resolved | Flagged | Spec fields | Linked | Expected | Targets | Calls |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = results.map((result) => {
    const cells = [
      String(result.eightCase.number),
      deskOf(result),
      `"${result.eightCase.request}"`,
      resolvedAs(result),
      flaggedOf(result),
      specFieldsOf(result),
      linkedOf(result),
      result.eightCase.expected,
      VERDICT_TEXT[verdictOf(result)](result),
      String(result.calls.length),
    ];
    return `| ${cells.map(cell).join(" | ")} |`;
  });
  return [
    ...header,
    ...rows,
    "",
    "Targets scores the capability and field each relation points at. Which field of the new " +
      "capability it starts from is in Linked, for the owner to judge.",
    "",
    `Total: ${costOf(results)}.`,
  ].join("\n");
}
