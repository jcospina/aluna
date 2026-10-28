// The evolution assembly stage's liveness wiring: the developer panel's plan, units, tests and
// Gate previews, and the facts the window narrates between them, the link step's among them.

import type {
  BehavioralTestActionReport,
  BehavioralTestFreezeProgress,
  CapabilityDiff,
  GeneratedUnit,
} from "../../../builder/index.ts";
import type { CapabilityRow, CapabilitySpec } from "../../../registry/index.ts";
import type { LinkStepRun } from "../../build/linking.ts";
import type { SendBuildEvent } from "../../jobs/build-jobs.ts";
import { type BuildNarration, bothUnitObservers } from "../../streaming/build-narration.ts";
import {
  buildBehavioralTestProgressPreview,
  buildEvolutionCandidateAcceptedPreview,
  buildGatePreview,
  type EvolutionAssemblySummary,
} from "../../streaming/previews.ts";
import { createUnitPreviewStream } from "../../streaming/unit-preview-stream.ts";
import type {
  AssembledEvolutionCandidate,
  AssembleEvolutionCandidateInput,
  EvolutionAssemblyPlan,
} from "../assembly/evolution-assembly.ts";

/** What the wiring reads of the run it reports. */
export interface AssemblyStreamInput {
  readonly active: CapabilityRow;
  readonly intentText: string;
  readonly send: SendBuildEvent;
  readonly isAborted?: () => boolean;
}

/**
 * The developer-panel previews for an assembled candidate: the Gate block, then the complete plan
 * replacing the running `candidate-preview`. Both land before publication.
 */
export async function sendAssembledPreviews(
  input: AssemblyStreamInput,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
  assembly: AssembledEvolutionCandidate,
): Promise<void> {
  await input.send(
    "gate-preview",
    JSON.stringify(
      buildGatePreview(
        assembly.gate.durationMs,
        assembly.gate.outcomes,
        assembly.gate.structural,
        assembly.gate.smoke,
        assembly.gate.behavioral,
        assembly.behavioralTests,
      ),
    ),
  );
  await input.send(
    "candidate-preview",
    JSON.stringify(
      buildEvolutionCandidateAcceptedPreview(input.active, input.intentText, candidate, diff, {
        status: "complete",
        regeneratedUnits: assembly.regeneratedUnits,
        copiedUnits: assembly.copiedUnits,
        additiveMigration: assembly.additiveMigration.statements,
        priorSource: assembly.priorSource,
        behavioralTests: assembly.behavioralTests,
        // The run/skip half, settled by the Gate: which frozen suites this evolution had to
        // re-prove against new bytes, and which it left alone because nothing they cover moved.
        ...(assembly.behavioralExecution
          ? { behavioralExecution: assembly.behavioralExecution }
          : {}),
        // …and which row of the transition table the two halves together landed on.
        // The one line of the story a tier-off evolution can still tell.
        behavioralTierTransition: assembly.behavioralTierTransition,
        gate: assembly.gate.outcomes.map((outcome) => ({
          rung: outcome.rung,
          status: outcome.status,
        })),
      }),
    ),
  );
}

export interface AssemblyStream {
  /** The liveness wiring handed to the assembler. */
  readonly hooks: Pick<AssembleEvolutionCandidateInput, "observer" | "gateObserver" | "progress">;
  /** Close out the plan the panel is showing when the assembly does not finish. */
  reportAbandoned(): Promise<void>;
}

/**
 * The assembly stage's liveness wiring: a v1 build's `units-preview` stream plus a
 * `candidate-preview` carrying the running plan. A byte-copied unit is `record`ed complete.
 */
export function streamAssembly(
  input: AssemblyStreamInput,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
  linking: LinkStepRun,
  narration: BuildNarration,
): AssemblyStream {
  const unitPreviews = createUnitPreviewStream(input.send, input.isAborted);
  let writingRules = false;
  let planned: EvolutionAssemblyPlan | undefined;
  let behavioralTests: readonly BehavioralTestActionReport[] | undefined;
  let behavioralTestProgress: BehavioralTestFreezeProgress | undefined;
  const sendPlan = (plan: EvolutionAssemblyPlan, status: EvolutionAssemblySummary["status"]) =>
    input.send(
      "candidate-preview",
      JSON.stringify(
        buildEvolutionCandidateAcceptedPreview(input.active, input.intentText, candidate, diff, {
          status,
          regeneratedUnits: plan.regeneratedUnits,
          copiedUnits: plan.copiedUnits,
          additiveMigration: plan.additiveMigration.statements,
          // Already final in the `running` plan: admissibility is deterministic and decided
          // before the first regeneration, so the developer knows which units see old source.
          priorSource: plan.priorSource,
          ...(behavioralTests ? { behavioralTests } : {}),
          gate: [],
        }),
      ),
    );

  const recordFinal = async (units: readonly GeneratedUnit[]) => {
    for (const unit of units) unitPreviews.record(unit);
    await unitPreviews.flush("complete", true);
  };

  return {
    hooks: {
      observer: bothUnitObservers(unitPreviews.observer, narration.units),
      gateObserver: narration.gate,
      progress: {
        // The parts this change leaves alone are drawn finished from the start.
        onPlanned: async (plan) => {
          planned = plan;
          await sendPlan(plan, "running");
          await narration.shape(candidate);
          await narration.stage("room");
          for (const name of plan.copiedUnits) await narration.part({ name }, "kept");
        },
        onTestsProgress: async (progress) => {
          if (!writingRules) await narration.stage("rules");
          writingRules = true;
          await narration.rules(progress);
          behavioralTestProgress = progress;
          await input.send(
            "behavioral-tests-preview",
            JSON.stringify(buildBehavioralTestProgressPreview(progress, "running")),
          );
        },
        // Frozen intent lands between the plan and the first generated byte, so the panel shows
        // which Actions' tests this evolution wrote, and from which inputs, before any Handler.
        onTestsFrozen: async (frozen) => {
          behavioralTests = frozen.report;
          if (planned) await sendPlan(planned, "running");
          if (behavioralTestProgress) {
            await input.send(
              "behavioral-tests-preview",
              JSON.stringify(
                buildBehavioralTestProgressPreview(behavioralTestProgress, "complete"),
              ),
            );
          }
        },
        onUnitsStart: () => narration.stage("make"),
        onUnitCopied: async (unit) => {
          unitPreviews.record(unit);
          await unitPreviews.flush("running", true);
        },
        // The inventory is whole and the Gate is next: freeze the units view at complete so the
        // remaining wait is visibly the Gate's. The link step is read here, as a build reads it
        // once its units are done, so the fields it connects are said before the Gate runs.
        onGateStart: async () => {
          await unitPreviews.flush("complete", true);
          await narration.connect(candidate, await linking.settled());
          await narration.stage("check");
        },
        // …and re-send it if the Gate's repairs changed the bytes underneath that view.
        onUnitsFinalized: recordFinal,
      },
    },
    reportAbandoned: async () => {
      // A developer who pressed Cancel stopped this on purpose; that is not a failure.
      if (planned) await sendPlan(planned, input.isAborted?.() ? "cancelled" : "failed");
      planned = undefined;
    },
  };
}
