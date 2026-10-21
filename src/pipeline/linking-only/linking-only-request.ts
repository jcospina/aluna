// A linking-only request (ADR-0011): the link step runs alone on the
// capability as it is committed, under the build lease, and each relation it admits is written in
// place through the Link control's own write, the matching scan with it. No spec writer, no unit,
// no Gate and no version, and the prompt bar says what came of it. It stores no metrics row: no
// generation ran, and the developer panel reads what the request cost from its live preview.

import type { Database } from "bun:sqlite";
import { joinableTargets, runLinkStep } from "../../builder/index.ts";
import { writeLink } from "../../lifecycle/link/front-half.ts";
import { errorDetail } from "../../platform/errors.ts";
import { intentResolutionMetrics } from "../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  abortableProvider,
  type Provider,
  type TokenUsage,
} from "../../platform/provider/index.ts";
import {
  alreadyConnected,
  connectingNote,
  NOTHING_ELSE_TO_CONNECT,
  NOTHING_TO_CONNECT,
  type RequestConnectedField,
  requestConnected,
} from "../../presentation/controls/link/link-copy.ts";
import {
  type ActiveRegistryCatalog,
  type CapabilityRow,
  holdingRelations,
  listCapabilities,
  type Relation,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import { renderPromptNotice } from "../../server/http/fragments/fragments.ts";
import { type RevalidatedRequest, revalidateResolvedRequest } from "../build/core-builder.ts";
import { LINK_STEP_GRACE_MS } from "../build/linking.ts";
import type { IntentClassification } from "../intent/index.ts";
import type { BuildPipelineCompletion, BuildPipelineContext } from "../jobs/build-jobs.ts";
import { renderRestorationFragment } from "../jobs/restoration.ts";
import type { carriedResolverMeasurement } from "../metrics-recorder.ts";
import {
  deliverRestoredPresentation,
  FAILED_BUILD_ENDING,
  STALE_BUILD_ENDING,
} from "../streaming/terminal-presentation.ts";

export interface LinkingOnlyRequestInput {
  readonly context: BuildPipelineContext;
  /** Already bound to the job's signal; the lease's is added once it is held. */
  readonly provider: Provider;
  readonly intent: IntentClassification;
  readonly resolver: ReturnType<typeof carriedResolverMeasurement>;
  /** The catalog the request was classified against, which the lease head checks it by. */
  readonly catalog: ActiveRegistryCatalog;
  readonly buildDatabases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly terminalPresenterTimeoutMs: number;
  /** How long the step may decide before it is stuck, holding the lease and every save. */
  readonly graceMs?: number;
}

/**
 * How a request ended, and what the link step's call cost once one was made and its cost arrived.
 * Only `connected` changed anything; it and `already` say a sentence naming the fields.
 */
type Ending = (
  | { readonly kind: "connected" | "already"; readonly sentence: string }
  | { readonly kind: "nothing" | "failed" | "stale" | "cancelled" }
) & { readonly usage?: TokenUsage | null };

const SAID = {
  nothing: NOTHING_TO_CONNECT,
  failed: FAILED_BUILD_ENDING,
  stale: STALE_BUILD_ENDING,
  cancelled: "",
};

const DONE = {
  connected: "ok",
  already: "no_change",
  nothing: "no_change",
  failed: "failed",
  stale: "stale",
  cancelled: "cancelled",
} as const;

/** Takes the build lease, links under it, and tells the person while it is still held. */
export async function runLinkingOnlyRequest(
  input: LinkingOnlyRequestInput,
): Promise<BuildPipelineCompletion> {
  const { context, intent, catalog } = input;
  const target = catalog.capabilities.find(({ id }) => id === intent.target_capability);
  // A target the desk did not hold is the resolver's mistake, and nothing has been touched yet.
  if (!target) return present(input, { kind: "failed" });
  const request: RevalidatedRequest = {
    kind: "existing_capability",
    targetExpectation: {
      state: "active",
      capabilityId: target.id,
      incarnationId: target.incarnation_id,
      version: target.version,
    },
    catalogFingerprint: catalog.fingerprint,
  };
  try {
    return await input.mutationCoordinator.withBuildLease(
      input.mutationCoordinator.reserveBuild(),
      async (lease) => present(input, await linkUnderBuildLease(input, request, lease.signal)),
      context.signal ? { signal: context.signal } : {},
    );
  } catch (error) {
    // Nothing under the lease throws, so this is the lease never granted, and nothing was touched:
    // a cancel while it queued, or a coordinator that refused it, said on the bar as a failure.
    if (context.isAborted()) return present(input, { kind: "cancelled" });
    console.error("omni-crud could not take the build lease to link:", errorDetail(error));
    return present(input, { kind: "failed" });
  }
}

async function linkUnderBuildLease(
  input: LinkingOnlyRequestInput,
  request: RevalidatedRequest,
  leaseSignal: AbortSignal,
): Promise<Ending> {
  const { context } = input;
  const grace = new AbortController();
  const timer = setTimeout(() => grace.abort(), input.graceMs ?? LINK_STEP_GRACE_MS);
  let usage: TokenUsage | null = null;
  try {
    const revalidation = revalidateResolvedRequest(request, input.buildDatabases);
    if (revalidation.kind !== "existing_capability") return { kind: "stale" };
    const source = revalidation.active;
    const catalog = listCapabilities(input.buildDatabases.readonly);
    const flagged = catalog.filter(({ id }) => input.intent.related_capabilities.includes(id));
    const joinable = joinableTargets(source, flagged);
    sayConnecting(context, source, joinable);
    const step = await runLinkStep({
      provider: abortableProvider(input.provider, AbortSignal.any([leaseSignal, grace.signal])),
      request: context.job.prompt,
      source,
      flagged,
      catalog,
    });
    usage = step.usage;
    const asked = joinable.length > 0;
    return { ...settle(input, source, { flagged, catalog, asked }, step), usage };
  } catch (error) {
    console.error("omni-crud could not link as asked:", errorDetail(error));
    return { kind: "failed", usage };
  } finally {
    clearTimeout(timer);
  }
}

/** What the step's answer comes to: written relations, a sentence about ones already there, or none. */
function settle(
  input: LinkingOnlyRequestInput,
  source: CapabilityRow,
  desk: {
    readonly flagged: readonly CapabilityRow[];
    readonly catalog: readonly CapabilityRow[];
    /** Whether the step was asked about fields still open, beside any already connected. */
    readonly asked: boolean;
  },
  step: Awaited<ReturnType<typeof runLinkStep>>,
): Ending {
  // The person's cancel stops the call; a step out of time or lease is stopped too, and failed.
  if (input.context.isAborted()) return { kind: "cancelled" };
  if (step.failure !== undefined) {
    console.error(
      `omni-crud's link step linked nothing for ${source.id}:`,
      errorDetail(step.failure),
    );
    return { kind: "failed" };
  }
  const { flagged, catalog } = desk;
  const connected = writeRelations(input.buildDatabases.readwrite, source, flagged, step.relations);
  if (connected.length > 0) {
    const nouns = { noun: source.noun, plural: source.plural_noun };
    return { kind: "connected", sentence: requestConnected(nouns, connected) };
  }
  const already = alreadyConnected(source.noun, connectedTo(source, flagged, catalog));
  if (already === "") return { kind: "nothing" };
  // Fields the step was asked about but did not connect are said too, or the bar answers only one.
  const sentence = desk.asked ? `${already} ${NOTHING_ELSE_TO_CONNECT}` : already;
  return { kind: "already", sentence };
}

/** The prompt bar's note while the step decides, sent without holding the lease on the reader. */
function sayConnecting(
  context: BuildPipelineContext,
  source: CapabilityRow,
  joinable: readonly CapabilityRow[],
): void {
  if (joinable.length === 0 || !context.canPresent()) return;
  const note = connectingNote(
    source.plural_noun,
    ...joinable.map(({ plural_noun }) => plural_noun),
  );
  void context.send("fragment", renderPromptNotice(note)).catch(() => undefined);
}

/**
 * Each relation the step admitted, already checked by the Link control's rules against this lease's
 * desk, written through its write in field order, each on the row the one before left. All of them
 * or none: a write that fails undoes the ones before it.
 */
function writeRelations(
  database: Database,
  source: CapabilityRow,
  flagged: readonly CapabilityRow[],
  relations: readonly Relation[],
): RequestConnectedField[] {
  return database.transaction(() => {
    let row = source;
    return source.schema.fields.flatMap((field) => {
      const relation = relations.find((each) => each.field === field.name);
      const target = flagged.find(({ id }) => id === relation?.to.capability);
      if (!relation || !target) return [];
      const ends = {
        source: { row, field: field.name },
        target: { row: target, field: relation.to.field },
      };
      const written = writeLink(database, ends.source, ends.target);
      if (!written) throw new Error(`${source.id} moved under the build lease`);
      row = written.row;
      const nouns = { targetNoun: target.noun, targetPlural: target.plural_noun };
      return [{ field, ...nouns, matched: written.matched }];
    });
  })();
}

/** The source's fields that already pick from a flagged capability, in field order. */
function connectedTo(
  source: CapabilityRow,
  flagged: readonly CapabilityRow[],
  catalog: readonly CapabilityRow[],
) {
  const holding = holdingRelations(source, catalog);
  return source.schema.fields.flatMap((field) => {
    const relation = holding.find((each) => each.field === field.name);
    const target = flagged.find(({ id }) => id === relation?.to.capability);
    return target ? [{ field, targetPlural: target.plural_noun }] : [];
  });
}

async function present(
  input: LinkingOnlyRequestInput,
  ending: Ending,
): Promise<BuildPipelineCompletion> {
  const { context } = input;
  if (!context.canPresent()) return undefined;
  const sentence = "sentence" in ending ? ending.sentence : SAID[ending.kind];
  const answered = sentence === "" || ending.kind === "connected";
  await deliverRestoredPresentation(
    context.send,
    endingFragment(input, sentence, answered ? "answer" : "refusal"),
    DONE[ending.kind],
    input.terminalPresenterTimeoutMs,
    { metricsPreview: preview(input, ending) },
  );
  return "terminal-sent";
}

/**
 * The developer panel's reading of what the request cost: the resolver's measurement and the step's.
 * One the schema refuses is dropped rather than thrown, since a link may already be written.
 */
function preview(input: LinkingOnlyRequestInput, ending: Ending): string | undefined {
  try {
    const metrics = intentResolutionMetrics({
      promptJobId: input.context.job.id,
      outcome: ending.kind === "cancelled" ? "cancelled" : "completed",
      resolver: input.resolver,
    });
    return JSON.stringify({ ...metrics, linkStep: { usage: ending.usage ?? null } });
  } catch (error) {
    console.error("omni-crud could not measure a linking-only request:", errorDetail(error));
    return undefined;
  }
}

/**
 * The window drawn again from the registry as it now stands, with the bar's sentence. A window that
 * cannot be drawn takes nothing back that was written: the bar still says it, over the window as it
 * was, which shows the link once it is opened again.
 */
function endingFragment(
  input: LinkingOnlyRequestInput,
  sentence: string,
  tone: "answer" | "refusal",
): string {
  const { restoration } = input.context.job;
  try {
    return renderRestorationFragment(
      restoration,
      input.buildDatabases.readonly,
      sentence,
      "replace",
      tone,
    );
  } catch (error) {
    console.error("omni-crud could not draw the window again after linking:", errorDetail(error));
    return renderPromptNotice(sentence, tone);
  }
}
