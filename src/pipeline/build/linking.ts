// A build's link step, run beside the tests and the units: started once
// the spec exists, read once the units are done, and stopped on every way out of the build, so no
// answer reaches a build that has ended. An evolution runs it the same way, for the fields it adds.

import { runLinkStep } from "../../builder/index.ts";
import { errorDetail } from "../../platform/errors.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  abortableProvider,
  isProviderAbortError,
  type Provider,
} from "../../platform/provider/index.ts";
import { buildConnecting } from "../../presentation/controls/link/link-copy.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  listCapabilities,
  type Relation,
} from "../../registry/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import type { IntentClassification } from "../intent/index.ts";
import type { DemoBuildAccumulator } from "../metrics-recorder.ts";

/**
 * How long a build or an evolution waits on the link step once its units are done. The step starts
 * before the tests and usually answers in seconds, so one still silent this late is stuck, and the
 * run goes on with no relations rather than hold the Gate and the build lease.
 */
export const LINK_STEP_GRACE_MS = 30_000;

/** What the link step answered, and the flagged capabilities it was read beside. */
export interface Linked {
  readonly relations: readonly Relation[];
  readonly flagged: readonly CapabilityRow[];
}

export interface LinkStepRun {
  /** The step's relations, once it answers or the grace runs out. Never rejects. */
  readonly settled: () => Promise<Linked>;
  /** Ends the step if it is still running: the build is over without it. */
  readonly stop: () => Promise<void>;
}

export interface LinkStepStart {
  readonly provider: Provider;
  readonly prompt: string;
  readonly intent: IntentClassification;
  readonly spec: CapabilitySpec;
  readonly incarnationId: string;
  readonly acc: DemoBuildAccumulator;
  readonly database: PlatformDatabase;
  readonly graceMs?: number;
  /**
   * On an evolution, the row it evolves, whose relations the step never re-decides, and the fields
   * the change adds, the only ones it may link.
   */
  readonly evolving?: { readonly committed: CapabilityRow; readonly fields: readonly string[] };
}

const NOT_LINKED: Linked = { relations: [], flagged: [] };

class GraceRanOut extends Error {}

/** Starts the step on the flagged capabilities as the registry holds them under the build lease. */
export function startLinkStep(input: LinkStepStart): LinkStepRun {
  const controller = new AbortController();
  const provider = abortableProvider(input.provider, controller.signal);
  const running = linkUnderLease(input, provider, controller.signal).catch((error: unknown) => {
    logNothingLinked(input.spec, error);
    return NOT_LINKED;
  });
  return {
    settled: async () => {
      const grace = new GraceRanOut("the link step did not answer in time");
      const timer = setTimeout(() => controller.abort(grace), input.graceMs ?? LINK_STEP_GRACE_MS);
      try {
        return await running;
      } finally {
        clearTimeout(timer);
      }
    },
    stop: async () => {
      controller.abort();
      await running;
    },
  };
}

async function linkUnderLease(
  input: LinkStepStart,
  provider: Provider,
  signal: AbortSignal,
): Promise<Linked> {
  const ids = input.intent.related_capabilities;
  if (ids.length === 0) return NOT_LINKED;
  const catalog = listCapabilities(input.database.readonly);
  const flagged = catalog.filter(({ id }) => ids.includes(id));
  const { evolving } = input;
  const source = {
    ...input.spec,
    incarnation_id: input.incarnationId,
    display_label_override: evolving?.committed.display_label_override ?? null,
    relations: evolving?.committed.relations ?? [],
  };
  const linked = await runLinkStep({
    provider,
    request: input.prompt,
    source,
    flagged,
    catalog,
    fields: evolving?.fields,
  });
  // The step's cost joins the build's when it lands before the build's row is written.
  if (linked.usage) input.acc.usages.push(linked.usage);
  // A build that ends, by its own stop, a cancel or a lost lease, aborts the call; only the grace's
  // abort is the step's own failure.
  const graceRanOut = signal.reason instanceof GraceRanOut;
  const stoppedByTheBuild = isProviderAbortError(linked.failure) && !graceRanOut;
  if (linked.failure !== undefined && !stoppedByTheBuild) {
    logNothingLinked(input.spec, linked.failure);
  }
  return { relations: linked.relations, flagged };
}

function logNothingLinked(spec: CapabilitySpec, failure: unknown): void {
  console.error(`omni-crud's link step linked nothing for ${spec.id}:`, errorDetail(failure));
}

/** The sentence about the fields a build or an evolution connects, in field order: "" for none. */
export function connectingNarration(spec: CapabilitySpec, linked: Linked): string {
  const connected = spec.schema.fields.flatMap((field) => {
    const relation = linked.relations.find((each) => each.field === field.name);
    const target = linked.flagged.find(({ id }) => id === relation?.to.capability);
    return target ? [{ field, targetPlural: target.plural_noun }] : [];
  });
  return escapeHtml(buildConnecting(spec.noun, connected));
}
