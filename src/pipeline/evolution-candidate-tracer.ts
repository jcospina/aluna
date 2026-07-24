// The evolution-candidate dev tracer — Module 4.6/01–03 (PLAN decisions 1, 2, 4,
// 21, 22, 37; ADR-0006). The first visible half of evolution: target a live
// capability with a hand-typed intent, author one complete candidate spec,
// validate it totally, then run the Diff Engine (4.6/02) over the committed and
// candidate specs. It surfaces the validated candidate with its typed change
// facts and unioned work plan — or, when the Diff finds zero facts, reports the
// canonical no-op. A real change then assembles the executed work (4.6/03) and
// Gates it, streaming the whole thing into the developer panel as it runs. It
// still applies no DDL and performs no publication, activation, or version bump;
// the measured no-op's only durable effect is its own `success/no_change`
// metrics row (decision 37), finalized by the caller.
//
// TEMPORARY SEAM — the hand-supplied resolved intent. Epic 4.8 wires the real
// Intent Resolver (and stale-target admission) in front of evolution; until
// then `handSuppliedEvolutionIntent` stands in, and 4.6/05's tracer cleanup
// owns removing what remains. The catalog freeze is not temporary: the caller
// holds the exclusive build lease while this runs, so the dependency-generation
// catalog captured here is the immutable lease-frozen catalog decision 1
// requires.

import type { Database } from "bun:sqlite";

import type { SendBuildEvent } from "../build-jobs.ts";
import {
  buildDependencyGenerationCatalog,
  type CapabilityDiff,
  committedSpecView,
  type DependencyGenerationCatalogEntry,
  diffCapabilitySpec,
  type GeneratedUnit,
  generateCandidateSpec,
  handSuppliedEvolutionIntent,
} from "../builder/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import { type CapabilityRow, type CapabilitySpec, listCapabilities } from "../registry/index.ts";
import { previewingProvider } from "./build-run.ts";
import {
  type AssembledEvolutionCandidate,
  type AssembleEvolutionCandidateInput,
  assembleEvolutionCandidate,
  type EvolutionAssemblyPlan,
} from "./evolution-assembly.ts";
import {
  buildEvolutionCandidateAcceptedPreview,
  buildGatePreview,
  type EvolutionAssemblySummary,
} from "./previews.ts";
import { createUnitPreviewStream } from "./unit-preview-stream.ts";

export interface EvolutionCandidateTracerInput {
  /** The live committed capability being evolved — re-checked under the lease. */
  readonly active: CapabilityRow;
  /** The developer's hand-typed intent (the 4.8 resolver stand-in). */
  readonly intentText: string;
  readonly provider: Provider;
  /** The registry read connection the catalog freeze reads under the lease. */
  readonly registry: Database;
  readonly send: SendBuildEvent;
  /**
   * True once the subscriber is gone or the trace was cancelled. The liveness stream goes
   * quiet on it, exactly as a v1 build's does — the work itself is unwound by the
   * abortable provider rejecting its in-flight call.
   */
  readonly isAborted?: () => boolean;
}

export interface EvolutionCandidateTracerResult {
  /** The validated canonical candidate — exactly what the Diff stage compared. */
  readonly candidate: CapabilitySpec;
  /** The typed change facts and unioned work plan (or the no-op) the Diff produced. */
  readonly diff: CapabilityDiff;
  /** The lease-frozen catalog the candidate was generated and validated against. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
  /**
   * The assembled + Gate-cleared candidate for a real change (4.6/03): additive DDL,
   * per-unit copy/regenerate, provenance, and the Gate over the assembled snapshot.
   * Absent on the measured no-op (there is nothing to assemble).
   */
  readonly assembly?: AssembledEvolutionCandidate;
  /** The candidate authoring duration — the measured no-op's only real timing. */
  readonly durationMs: number;
  /** The candidate authoring token usage — the measured no-op's only real spend. */
  readonly usage: TokenUsage;
}

/**
 * Run candidate generation + total validation, then the Diff Engine, under the
 * caller-held build lease. Streams the authoring preview (`spec-preview`) while the
 * candidate assembles, then the executed work as it runs — the derived plan, the
 * regenerated units, the Gate; throws `CandidateValidationError` on a rejected
 * candidate (the warm rejection) and `UnmappedChangeFactError` on a difference
 * the matrix cannot map (fails closed, decision 21) — both upward to the route.
 */
export async function runEvolutionCandidateTracer(
  input: EvolutionCandidateTracerInput,
): Promise<EvolutionCandidateTracerResult> {
  // Freeze the immutable active dependency-generation catalog — every other
  // capability's { capability_id, incarnation_id, label, prompt_context,
  // active_schema } — while mutation ownership is held (decision 1).
  const activeRows = listCapabilities(input.registry);
  const dependencyCatalog = buildDependencyGenerationCatalog(activeRows, input.active.id);
  const intent = handSuppliedEvolutionIntent(input.active, input.intentText);

  // Mirror the v1 build's liveness view: the developer watches the candidate
  // assemble in the panel's Spec block while the stage itself runs unchanged.
  const { provider: observed, flushPreviews } = previewingProvider(input.provider, input.send);
  try {
    const generated = await generateCandidateSpec({
      provider: observed,
      committed: input.active,
      intent,
      dependencyCatalog,
      send: input.send,
    });
    // The Diff Engine (4.6/02): the committed row's authored view against the
    // validated candidate. Total and monotone — an unmapped difference throws.
    const diff = diffCapabilitySpec(committedSpecView(input.active), generated.candidate);
    // 4.6/03: a real change turns the work plan into executed work — additive DDL,
    // per-unit copy/regenerate, and the Gate over the assembled snapshot. The raw
    // provider (not the spec-preview wrapper) generates regenerated units so their
    // partials are not mislabeled as spec previews. No publication/activation here.
    //
    // This is the long half of a trace — several live regenerations plus the Gate — so it
    // streams exactly like a v1 build does: the plan lands in the Evolution candidate
    // block the instant the Diff resolves, then the regenerated units assemble in the
    // Units block and the Gate verdict lands in the Gate block. The terminal
    // `candidate-preview` then replaces the running plan with the complete one.
    const stream = diff.isNoop ? undefined : streamAssembly(input, generated.candidate, diff);
    const assembly = stream
      ? await assembleEvolutionCandidate({
          committed: input.active,
          candidate: generated.candidate,
          diff,
          provider: input.provider,
          // The same freeze the candidate's catalog uses, minus this capability: a
          // self-dependency is implicit and is never declared, so the row the freeze
          // deliberately drops must not reappear in unit-generation context either.
          dependencyCatalog: activeRows.filter((row) => row.id !== input.active.id),
          behavioralTierEnabled: false,
          ...(input.isAborted ? { isAborted: input.isAborted } : {}),
          ...stream.hooks,
        }).catch(async (error: unknown) => {
          // A failed unit, a failed Gate, or a cancel leaves a running plan on the panel
          // that nothing is working on any more. Close it out before the failure
          // presentation replaces the View.
          await stream.reportAbandoned();
          throw error;
        })
      : undefined;
    // The Gate is not abortable, so a cancel raised during it lets the assembly *resolve*
    // — the caller then discards the result and restores the View. Close the plan out here
    // too, or a developer who cancels mid-Gate is left staring at a running plan.
    if (stream && input.isAborted?.()) await stream.reportAbandoned();
    if (assembly) {
      await input.send(
        "gate-preview",
        JSON.stringify(
          buildGatePreview(
            assembly.gate.durationMs,
            assembly.gate.outcomes,
            assembly.gate.structural,
            assembly.gate.smoke,
            assembly.gate.behavioral,
          ),
        ),
      );
    }
    return {
      candidate: generated.candidate,
      diff,
      dependencyCatalog,
      ...(assembly ? { assembly } : {}),
      durationMs: generated.durationMs,
      usage: generated.usage,
    };
  } finally {
    // Every preview is on the wire before the terminal presentation either way.
    await flushPreviews();
  }
}

interface AssemblyStream {
  /** The liveness wiring handed to the assembler. */
  readonly hooks: Pick<AssembleEvolutionCandidateInput, "observer" | "progress">;
  /** Close out the plan the panel is showing when the assembly does not finish. */
  reportAbandoned(): Promise<void>;
}

/**
 * The assembly stage's liveness wiring: the same `units-preview` stream a v1 build drives,
 * plus a `candidate-preview` carrying the running plan. A byte-copied unit is `record`ed
 * straight into the live inventory — it lands complete because it *was* complete, never
 * having entered a generation prompt — so the developer sees the copy/regenerate split as
 * bytes rather than only as a list at the end.
 */
function streamAssembly(
  input: EvolutionCandidateTracerInput,
  candidate: CapabilitySpec,
  diff: CapabilityDiff,
): AssemblyStream {
  const unitPreviews = createUnitPreviewStream(input.send, input.isAborted);
  let planned: EvolutionAssemblyPlan | undefined;
  const sendPlan = (plan: EvolutionAssemblyPlan, status: EvolutionAssemblySummary["status"]) =>
    input.send(
      "candidate-preview",
      JSON.stringify(
        buildEvolutionCandidateAcceptedPreview(input.active, input.intentText, candidate, diff, {
          status,
          regeneratedUnits: plan.regeneratedUnits,
          copiedUnits: plan.copiedUnits,
          additiveMigration: plan.additiveMigration.statements,
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
      observer: unitPreviews.observer,
      progress: {
        onPlanned: (plan) => {
          planned = plan;
          return sendPlan(plan, "running");
        },
        onUnitCopied: async (unit) => {
          unitPreviews.record(unit);
          await unitPreviews.flush("running", true);
        },
        // The inventory is whole and the Gate is next: freeze the units view at complete
        // so the remaining wait is visibly the Gate's, not a stalled generation.
        onGateStart: () => unitPreviews.flush("complete", true),
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
