// The M2–M4 explicit-loop presenter: one implementation of {@link CoreBuilderPresenter}, the
// foreground story a person sees while watching Aluna work. It holds the active content area,
// narrates in product voice, and emits one View `commit`, only for a real pointer activation.
//
// Everything here is presentation: the Builder has finished mutating, gating and activating
// before any of these methods run. Module 10 replaces this file and nothing else to give the
// implicit loop a quieter face, while mutation, staging, Gate, activation and metrics stay put.
//
// Every non-activating terminal — stale, no_change, cancelled, failed — resolves the job's
// data-free restoration descriptor against the then-current registry and restores that canonical
// View through `fragment` with no desk sidecar. The restoration is re-resolved rather than
// remembered, because after a stale refusal the registry is precisely the thing that moved.

import { errorDetail } from "../../../platform/errors.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import { renderCachedCapabilityCommitSwap } from "../../../server/http/index.ts";
import {
  type ExplicitEvolutionPresentation,
  presentEvolutionFailure,
  presentEvolutionOutcome,
} from "../../evolution/intent/explicit-presentation.ts";
import type { BuildJob, BuildPipelineCompletion, SendBuildEvent } from "../../jobs/build-jobs.ts";
import { renderRestorationFragment } from "../../jobs/restoration.ts";
import type { RecordMetrics } from "../../metrics-recorder.ts";
import { buildCommitPreview } from "../../streaming/previews.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
  deliverStalePresentation,
} from "../../streaming/terminal-presentation.ts";
import type { CoreBuilderPresenter, CoreBuildTerminal } from "../core-builder.ts";

export interface ExplicitPresenterInput {
  readonly job: BuildJob;
  readonly send: SendBuildEvent;
  readonly canPresent: () => boolean;
  readonly isAborted: () => boolean;
  readonly buildDatabases: PlatformDatabase;
  readonly recordMetrics: RecordMetrics;
  readonly terminalPresenterTimeoutMs?: number;
}

/** The presentation state shared by every terminal shape this adapter can deliver. */
interface ExplicitPresenterContext extends ExplicitPresenterInput {
  readonly timeoutMs: number;
  /** Re-resolved per terminal, because the registry is what may have moved. */
  readonly restoration: () => string;
  /** The row's JSON, or undefined when this terminal has no durable row of its own. */
  readonly metricsPreview: (incarnationId: string | null) => string | undefined;
}

function contextFor(input: ExplicitPresenterInput): ExplicitPresenterContext {
  return {
    ...input,
    timeoutMs: input.terminalPresenterTimeoutMs ?? DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
    restoration: () =>
      renderRestorationFragment(input.job.restoration, input.buildDatabases.readonly),
    metricsPreview: (incarnationId) => {
      // A terminal reached before admission has no row, and the literal string "null" would blank
      // whatever the developer panel is showing, so send nothing and leave it standing.
      const lifecycle = input.recordMetrics.get(input.job.id, incarnationId);
      return lifecycle === null ? undefined : JSON.stringify(lifecycle);
    },
  };
}

// A timed-out non-activating terminal is let go: `sseTransport` serializes writes on one chain, so
// a follow-up `done` would queue behind the stall that timed out, and be paid for under the lease.

async function presentStale(
  context: ExplicitPresenterContext,
  terminal: Extract<CoreBuildTerminal, { kind: "stale" }>,
): Promise<BuildPipelineCompletion> {
  if (!context.canPresent()) return undefined;
  // The delivered/timed-out answer is deliberately dropped here and on the other non-activating
  // paths: nothing changed, and a reconnect gets `done`/`missing` on a fresh write chain.
  await deliverStalePresentation(
    context.send,
    context.job.id,
    context.restoration(),
    context.timeoutMs,
    context.metricsPreview(terminal.refusal.incarnationId),
  );
  return "terminal-sent";
}

async function presentBuilt(
  context: ExplicitPresenterContext,
  terminal: Extract<CoreBuildTerminal, { kind: "built" }>,
): Promise<BuildPipelineCompletion> {
  // Activation is durable, so a listener still has something true to hear — but the build lease
  // is held throughout, so a subscriber known to be gone must not cost queued builds a window.
  if (!context.canPresent()) return undefined;
  try {
    const delivered = await deliverActivatedPresentation(
      context.send,
      JSON.stringify(buildCommitPreview(terminal.commit)),
      renderCachedCapabilityCommitSwap(terminal.commit.row, terminal.commit.previousLabel),
      context.timeoutMs,
      context.metricsPreview(terminal.incarnationId),
    );
    // Their version is live and only the showing failed, short enough to land on a merely slow
    // chain. Re-check first: a departed subscriber is the likeliest reason the window ran out.
    if (!delivered && context.canPresent()) {
      await deliverActivatedRecoveryPresentation(context.send, context.timeoutMs);
    }
  } catch (error) {
    // Activation is already durable. A View that could not be prepared is an
    // observational loss, so say so warmly rather than implying a failed build.
    console.error("Aluna activated presentation could not be prepared:", errorDetail(error));
    await deliverActivatedRecoveryPresentation(context.send, context.timeoutMs);
  }
  return "terminal-sent";
}

async function presentCancelled(
  context: ExplicitPresenterContext,
  terminal: Extract<CoreBuildTerminal, { kind: "cancelled" }>,
): Promise<BuildPipelineCompletion> {
  if (!context.canPresent()) return undefined;
  await deliverRestoredPresentation(
    context.send,
    context.restoration(),
    "cancelled",
    context.timeoutMs,
    { metricsPreview: context.metricsPreview(terminal.incarnationId) },
  );
  return "terminal-sent";
}

async function presentFailed(
  context: ExplicitPresenterContext,
  terminal: Extract<CoreBuildTerminal, { kind: "failed" }>,
): Promise<BuildPipelineCompletion> {
  if (!context.canPresent()) return undefined;
  // Someone pressed Cancel, so whatever error surfaced on the way out is bookkeeping, not news:
  // give their View back rather than apologize for a failure that did not happen.
  if (context.isAborted()) {
    return presentCancelled(context, { kind: "cancelled", incarnationId: terminal.incarnationId });
  }
  await deliverFailedPresentation(
    context.send,
    context.job.id,
    terminal.error,
    context.restoration(),
    context.timeoutMs,
    context.metricsPreview(terminal.incarnationId),
  );
  return "terminal-sent";
}

function evolutionPresentation(
  context: ExplicitPresenterContext,
  active: CapabilityRow,
): ExplicitEvolutionPresentation {
  return {
    active,
    intentText: context.job.prompt,
    job: context.job,
    send: context.send,
    canPresent: context.canPresent,
    isAborted: context.isAborted,
    database: context.buildDatabases.readonly,
    recordMetrics: context.recordMetrics,
    terminalPresenterTimeoutMs: context.timeoutMs,
  };
}

function presentTerminal(
  context: ExplicitPresenterContext,
  terminal: CoreBuildTerminal,
): Promise<BuildPipelineCompletion> {
  switch (terminal.kind) {
    case "stale":
      return presentStale(context, terminal);
    case "built":
      return presentBuilt(context, terminal);
    case "evolved":
      return presentEvolutionOutcome(
        evolutionPresentation(context, terminal.active),
        terminal.outcome,
      );
    case "cancelled":
      return presentCancelled(context, terminal);
    case "failed":
      return presentFailed(context, terminal);
  }
}

export function createExplicitPresenter(input: ExplicitPresenterInput): CoreBuilderPresenter {
  const context = contextFor(input);
  return {
    send: input.send,
    canPresent: input.canPresent,
    isAborted: input.isAborted,
    present: (terminal) => presentTerminal(context, terminal),
  };
}

/**
 * The evolution engine's failure vocabulary — a rejected candidate, or a live version whose View
 * never arrived — needs the committed row the run aimed at, so `failed` routes there instead.
 */
export function createExplicitEvolutionPresenter(
  input: ExplicitPresenterInput & { readonly active: CapabilityRow },
): CoreBuilderPresenter {
  const context = contextFor(input);
  const presentation = evolutionPresentation(context, input.active);
  return {
    send: input.send,
    canPresent: input.canPresent,
    isAborted: input.isAborted,
    present: (terminal) =>
      terminal.kind === "failed"
        ? presentEvolutionFailure(presentation, terminal.error)
        : presentTerminal(context, terminal),
  };
}
