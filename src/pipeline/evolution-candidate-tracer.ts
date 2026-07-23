// The evolution-candidate dev tracer — Module 4.6/01 (PLAN decisions 1, 2, 4,
// 22; ADR-0006). The first visible half of evolution: target a live capability
// with a hand-typed intent, author one complete candidate spec, validate it
// totally, and surface the accepted candidate (or the warm rejection) in the
// developer preview. It deliberately stops before the Diff stage — 4.6/02 owns
// typed change facts, and nothing here performs DDL, unit work, publication,
// activation, a version bump, or a View swap.
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
  type DependencyGenerationCatalogEntry,
  generateCandidateSpec,
  handSuppliedEvolutionIntent,
} from "../builder/index.ts";
import type { Provider } from "../provider/index.ts";
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
  /** The validated canonical candidate — exactly what the Diff stage (4.6/02) receives. */
  readonly candidate: CapabilitySpec;
  /** The lease-frozen catalog the candidate was generated and validated against. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
}

/**
 * Run candidate generation + total validation under the caller-held build
 * lease. Streams the authoring preview (`spec-preview`) while the candidate
 * assembles; throws `CandidateValidationError` upward on rejection so the route
 * delivers the warm rejection presentation.
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
    return { candidate: generated.candidate, dependencyCatalog };
  } finally {
    // Every preview is on the wire before the terminal presentation either way.
    await settled;
  }
}
