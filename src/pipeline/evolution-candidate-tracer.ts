// The evolution-candidate dev tracer — Module 4.6/01–02 (PLAN decisions 1, 2, 4,
// 21, 22, 37; ADR-0006). The first visible half of evolution: target a live
// capability with a hand-typed intent, author one complete candidate spec,
// validate it totally, then run the Diff Engine (4.6/02) over the committed and
// candidate specs. It surfaces the validated candidate with its typed change
// facts and unioned work plan — or, when the Diff finds zero facts, reports the
// canonical no-op. It still performs no DDL, unit work, publication, activation,
// or version bump; the measured no-op's only durable effect is its own
// `success/no_change` metrics row (decision 37), finalized by the caller.
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
  generateCandidateSpec,
  handSuppliedEvolutionIntent,
} from "../builder/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import { type CapabilityRow, type CapabilitySpec, listCapabilities } from "../registry/index.ts";
import { previewingProvider } from "./build-run.ts";

export interface EvolutionCandidateTracerInput {
  /** The live committed capability being evolved — re-checked under the lease. */
  readonly active: CapabilityRow;
  /** The developer's hand-typed intent (the 4.8 resolver stand-in). */
  readonly intentText: string;
  readonly provider: Provider;
  /** The registry read connection the catalog freeze reads under the lease. */
  readonly registry: Database;
  readonly send: SendBuildEvent;
}

export interface EvolutionCandidateTracerResult {
  /** The validated canonical candidate — exactly what the Diff stage compared. */
  readonly candidate: CapabilitySpec;
  /** The typed change facts and unioned work plan (or the no-op) the Diff produced. */
  readonly diff: CapabilityDiff;
  /** The lease-frozen catalog the candidate was generated and validated against. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
  /** The candidate authoring duration — the measured no-op's only real timing. */
  readonly durationMs: number;
  /** The candidate authoring token usage — the measured no-op's only real spend. */
  readonly usage: TokenUsage;
}

/**
 * Run candidate generation + total validation, then the Diff Engine, under the
 * caller-held build lease. Streams the authoring preview (`spec-preview`) while
 * the candidate assembles; throws `CandidateValidationError` on a rejected
 * candidate (the warm rejection) and `UnmappedChangeFactError` on a difference
 * the matrix cannot map (fails closed, decision 21) — both upward to the route.
 */
export async function runEvolutionCandidateTracer(
  input: EvolutionCandidateTracerInput,
): Promise<EvolutionCandidateTracerResult> {
  // Freeze the immutable active dependency-generation catalog — every other
  // capability's { capability_id, incarnation_id, label, prompt_context,
  // active_schema } — while mutation ownership is held (decision 1).
  const dependencyCatalog = buildDependencyGenerationCatalog(
    listCapabilities(input.registry),
    input.active.id,
  );
  const intent = handSuppliedEvolutionIntent(input.active, input.intentText);

  // Mirror the v1 build's liveness view: the developer watches the candidate
  // assemble in the panel's Spec block while the stage itself runs unchanged.
  const { provider: observed, settled } = previewingProvider(input.provider, input.send);
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
    return {
      candidate: generated.candidate,
      diff,
      dependencyCatalog,
      durationMs: generated.durationMs,
      usage: generated.usage,
    };
  } finally {
    // Every preview is on the wire before the terminal presentation either way.
    await settled;
  }
}
