// The M2–M4 explicit-loop presenter.
//
// One implementation of {@link CoreBuilderPresenter}: the foreground story a person sees
// when they typed a prompt and are watching Aluna work. It occupies the active content
// area, narrates in product voice, and emits exactly one View `commit` — and only for a
// real pointer activation.
//
// Everything here is presentation. The Builder behind it (`core-builder.ts`) has already
// finished mutating, gating, and activating by the time any of these methods run, and
// nothing in this file can change that outcome. That is the whole point of the split:
// Module 7 replaces this file and nothing else to give the implicit loop a quieter face
// for an already-confirmed proposal, while mutation, staging, Gate, activation, and
// metrics stay identical.
//
// Every non-activating terminal — stale, no_change, cancelled, or failed — resolves the
// job's data-free restoration descriptor against the *then-current* registry and restores
// that canonical View through `fragment` with no desk sidecar. The
// restoration is deliberately re-resolved rather than remembered: after a stale refusal
// the registry is precisely the thing that moved.

import type { PlatformDatabase } from "../../persistence/db.ts";
import type { CapabilityRow } from "../../registry/index.ts";
import { renderCachedCapabilityCommitSwap } from "../../web/index.ts";
import {
  type ExplicitEvolutionPresentation,
  presentEvolutionFailure,
  presentEvolutionOutcome,
} from "../evolution/explicit-presentation.ts";
import type { BuildJob, BuildPipelineCompletion, SendBuildEvent } from "../jobs/build-jobs.ts";
import { renderRestorationFragment } from "../jobs/restoration.ts";
import type { RecordMetrics } from "../metrics-recorder.ts";
import { buildCommitPreview } from "../streaming/previews.ts";
import {
  DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
  deliverStalePresentation,
} from "../streaming/terminal-presentation.ts";
import type { CoreBuilderPresenter, CoreBuildTerminal } from "./core-builder.ts";

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
      // A terminal reached before admission — a cancelled queue ticket, a resolution that
      // threw — has no row. Sending the literal string "null" would blank whatever the
      // developer panel was already showing, so send nothing and leave it standing.
      const lifecycle = input.recordMetrics.get(input.job.id, incarnationId);
      return lifecycle === null ? undefined : JSON.stringify(lifecycle);
    },
  };
}

// # Why a timed-out non-activating terminal is simply let go
//
// Every `deliver*` call below returns whether it finished inside its bound, and on the
// non-activating paths that answer is deliberately not acted on. The tempting repair —
// a second bounded window carrying just `done`, so the subscriber closes
// (`sse-close="done"`, `web/fragments.ts`) — cannot work: `sseTransport` serializes every
// write through one chain (`sse/transport.ts`), so a write that timed out because the
// reader stopped consuming is still sitting at the head of it. A follow-up `done` queues
// *behind* the stall and lands never, or lands so late that it arrives after the lease
// released and races the stream's own close.
//
// It would also be paid for twice over: terminal presentation runs while the exclusive
// build lease is held, so a second window doubles the worst case every queued build waits
// behind, to buy a write that already cannot arrive.
//
// Nothing is lost by letting it go. The refusal, the cancellation and the failure changed
// no product state, so there is no news being withheld — and the client is not stranded
// either: the connection ends when the route handler returns, the browser reconnects, and
// `BuildJobQueue.stream` answers a job that is no longer streamable with `done`/`missing`
// on a *fresh* write chain. That is the close, and it is the only one that can be
// delivered over a chain the stall has already blocked.

async function presentStale(
  context: ExplicitPresenterContext,
  terminal: Extract<CoreBuildTerminal, { kind: "stale" }>,
): Promise<BuildPipelineCompletion> {
  if (!context.canPresent()) return undefined;
  await deliverStalePresentation(
    context.send,
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
  // The one terminal worth a second attempt, and the one worth guarding. Activation is
  // durable, so a person who is still listening has something true left to hear — but the
  // build lease is held across all of this, so a subscriber already known to be gone must
  // not cost every queued build another bounded window.
  if (!context.canPresent()) return undefined;
  try {
    const delivered = await deliverActivatedPresentation(
      context.send,
      JSON.stringify(buildCommitPreview(terminal.commit)),
      renderCachedCapabilityCommitSwap(terminal.commit.row, terminal.commit.previousLabel),
      context.timeoutMs,
      context.metricsPreview(terminal.incarnationId),
    );
    // Their version *is* live, it just could not be shown — worth saying, and short enough
    // to still land on a chain that was merely slow rather than blocked. Re-check first:
    // a departed subscriber is the likeliest reason the first window ran out.
    if (!delivered && context.canPresent()) {
      await deliverActivatedRecoveryPresentation(context.send, context.timeoutMs);
    }
  } catch (error) {
    // Activation is already durable. A View that could not be prepared is an
    // observational loss, so say so warmly rather than implying a failed build.
    console.error(
      "Aluna activated presentation could not be prepared:",
      error instanceof Error ? error.message : error,
    );
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
  // Someone who pressed Cancel stopped this on purpose. Whatever error surfaced on the way
  // out is bookkeeping, not news — tell them what they already know and give their View
  // back, rather than apologizing for a failure that did not happen.
  if (context.isAborted()) {
    return presentCancelled(context, { kind: "cancelled", incarnationId: terminal.incarnationId });
  }
  await deliverFailedPresentation(
    context.send,
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
 * The evolution engine's richer failure vocabulary — a rejected candidate, or a version
 * that is already live but whose View could not be delivered — needs the committed row the
 * run was aimed at. A presenter built here routes `failed` there instead of to the generic
 * apology, and is otherwise identical.
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
