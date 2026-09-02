// Shared fixtures for the prompt-driven evolution suites. One committed `journal`
// capability plus the `shelves` capability its dependency catalog sees, both published
// and activated on disk; the fake providers the `/prompt` path is driven with; and the
// submit-then-stream helper. Not a test file itself; bun never runs it.
//
// The prompt bar is the only entrance to an evolution, so these suites drive
// `POST /prompt` → `GET /build/:id/stream` exactly as the browser does. The resolver leg
// is faked (see {@link resolvedBy}) rather than skipped: the engine must receive a real
// classification, because there is no longer any other way for it to receive one.
//
// Both capabilities get real snapshots on purpose: the engine reconciles every committed
// version before it treats a pointer as an evolution base, so a registry row with no
// artifacts behind it is corruption, not a convenient fixture shortcut.

import type { ZodType } from "zod";
import {
  type EvolutionIntentOverrides,
  evolutionIntentFor,
  JOURNAL_INCARNATION_ID,
  journalCapabilityRow,
  makeCandidateProvider,
  SHELVES_INCARNATION_ID,
  shelvesCapabilityRow,
} from "../builder/evolution/candidate.test-support.ts";
import {
  createHandlerFor,
  fullHandlersFor,
  generatedUnitsFor,
  itemRendererFor,
  makeSequenceProvider,
  readHandlerFor,
  searchHandlerFor,
  updateHandlerFor,
} from "../builder/gate/gate.test-support.ts";
import {
  activatePublishedSnapshot,
  BEHAVIORAL_TIER_ENV_VAR,
  type CapabilityGateResult,
  expectedAbsentCapability,
  publishCapabilitySnapshot,
  runCapabilityGate,
} from "../builder/index.ts";
import { applyCapabilityTableDdl, deriveCapabilityTableDdl } from "../capability-data/index.ts";
import {
  INTENT_RESOLVER_PROMPT_PREFIX,
  type IntentClassification,
} from "../intent-resolver/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "../platform/provider/index.ts";
import { type CapabilitySpec, capabilitySpecFromRow } from "../registry/index.ts";
import {
  buildJobIdFromSubscriber,
  createScratchDbEnv,
  makeMetricsRecorder,
  makeScratchApp,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";

export { JOURNAL_INCARNATION_ID } from "../builder/evolution/candidate.test-support.ts";

/** The classification the resolver would return for a change typed against `journal`. */
export function journalEvolutionIntent(
  intentText: string,
  overrides: EvolutionIntentOverrides = {},
): IntentClassification {
  return evolutionIntentFor(journalCapabilityRow(), intentText, overrides);
}

/**
 * Answer the Intent Resolver's one classification call with `intent`, and delegate every
 * other generation to `inner`. Matching on the resolver's own prompt rather than on call
 * position keeps the engine provider's recorded `prompts` exactly what it was when the
 * demo route called the engine directly — the resolver leg is added, not interleaved.
 */
export function resolvedBy(intent: IntentClassification, inner: Provider): Provider {
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      if (!prompt.startsWith(INTENT_RESOLVER_PROMPT_PREFIX)) {
        return inner.generate(prompt, schema);
      }
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield intent as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(intent as T),
        usage: Promise.resolve({ inputTokens: 30, outputTokens: 8, totalTokens: 38 }),
      };
    },
  };
}

/** The committed journal capability as a validated spec. */
export function journalSpec(): CapabilitySpec {
  return capabilitySpecFromRow(journalCapabilityRow());
}

export function shelvesSpec(): CapabilitySpec {
  return capabilitySpecFromRow(shelvesCapabilityRow());
}

export function handlersFor(spec: CapabilitySpec) {
  return fullHandlersFor(spec, { create: createHandlerFor(spec), read: readHandlerFor(spec) });
}

export function gateFor(spec: CapabilitySpec): Promise<CapabilityGateResult> {
  return runCapabilityGate({
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: handlersFor(spec),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: { enabled: false },
  });
}

export interface EvolutionRouteFixture {
  readonly journalGate: CapabilityGateResult;
  readonly shelvesGate: CapabilityGateResult;
}

/**
 * These suites own the route/presentation seam, not the behavioral tier — the tier is
 * proven on *and* off end to end by `pipeline/evolution/evolution-run.test.ts`. Pinning
 * the global toggle off keeps these runs fast and their fake providers focused on the
 * units the Diff selects.
 */
export function pinBehavioralTierOff(): () => void {
  const previous = process.env[BEHAVIORAL_TIER_ENV_VAR];
  process.env[BEHAVIORAL_TIER_ENV_VAR] = "off";
  return () => {
    if (previous === undefined) delete process.env[BEHAVIORAL_TIER_ENV_VAR];
    else process.env[BEHAVIORAL_TIER_ENV_VAR] = previous;
  };
}

export async function buildEvolutionRouteGates(): Promise<EvolutionRouteFixture> {
  const [journalGate, shelvesGate] = await Promise.all([
    gateFor(journalSpec()),
    gateFor(shelvesSpec()),
  ]);
  return { journalGate, shelvesGate };
}

/** Publish + activate one committed v1 on disk. */
async function activateCommittedV1(
  env: ScratchDbEnv,
  spec: CapabilitySpec,
  incarnationId: string,
  gate: CapabilityGateResult,
): Promise<void> {
  const publication = publishCapabilitySnapshot({
    buildId: `v1-${spec.id}`,
    spec,
    incarnationId,
    version: 1,
    units: generatedUnitsFor(spec, handlersFor(spec)),
    gate,
    artifactsRoot: env.artifactsRoot,
  });
  await activatePublishedSnapshot({
    database: env.conns.readwrite,
    spec,
    publication,
    expected: expectedAbsentCapability(),
    applyMigration: (database) => void applyCapabilityTableDdl(spec, database),
    finalizeMetrics: () => undefined,
  });
}

export async function setUpEvolutionRouteEnv(
  fixture: EvolutionRouteFixture,
): Promise<ScratchDbEnv> {
  const env = createScratchDbEnv("aluna-evolution-");
  await activateCommittedV1(env, journalSpec(), JOURNAL_INCARNATION_ID, fixture.journalGate);
  await activateCommittedV1(env, shelvesSpec(), SHELVES_INCARNATION_ID, fixture.shelvesGate);
  return env;
}

export function tearDownEvolutionRouteEnv(env: ScratchDbEnv): void {
  teardownScratchDbEnv(env);
}

/**
 * An app whose provider classifies `intentText` as an evolution of `journal` and then
 * answers exactly one canned candidate. `submit` types that same text into the prompt bar,
 * so the classification and the prompt behind it can never drift apart.
 */
export function scratchApp(env: ScratchDbEnv, response: unknown, intentText: string) {
  const { recordMetrics, rows, lifecycles } = makeMetricsRecorder();
  const { provider, prompts } = makeCandidateProvider(response);
  const app = makeScratchApp(
    env,
    resolvedBy(journalEvolutionIntent(intentText), provider),
    recordMetrics,
  );
  return { app, prompts, rows, lifecycles, submit: () => submitEvolution(app, intentText) };
}

/** The candidate journal spec plus one new active string field. */
export function moodCandidate(): CapabilitySpec {
  const spec = journalSpec();
  return {
    ...spec,
    schema: {
      fields: [
        ...spec.schema.fields,
        { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
      ],
    },
  };
}

/** The queued responses one mood evolution asks for, in the order the assembler asks. */
export function moodResponses(candidate: CapabilitySpec): readonly unknown[] {
  return [
    candidate,
    { content: createHandlerFor(candidate) },
    { content: updateHandlerFor(candidate) },
    { content: searchHandlerFor(candidate) },
  ];
}

export function moodEvolutionApp(env: ScratchDbEnv, candidate: CapabilitySpec, intentText: string) {
  const metrics = makeMetricsRecorder();
  const { provider, prompts } = makeSequenceProvider(moodResponses(candidate));
  const app = makeScratchApp(
    env,
    resolvedBy(journalEvolutionIntent(intentText), provider),
    metrics.recordMetrics,
  );
  return { app, prompts, ...metrics, submit: () => submitEvolution(app, intentText) };
}

/**
 * Hold one generation call open so a test can act while the assembly is genuinely
 * mid-flight. The partials still stream; only the resolved object waits on `release`.
 */
export function pausingProvider(inner: Provider, pauseOnCall: number) {
  let calls = 0;
  let signalReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>) {
      calls += 1;
      const result = inner.generate(prompt, schema);
      if (calls !== pauseOnCall) return result;
      signalReached();
      return { ...result, object: released.then(() => result.object) };
    },
  };
  return { provider, reached, release: () => release() };
}

/**
 * Type one change into the prompt bar from the open `journal` surface and return its job's
 * stream path — the same POST the browser sends, restoration descriptor included, so a
 * non-activating terminal restores the View the person was actually looking at.
 */
export async function submitEvolution(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  intentText: string,
) {
  const res = await app.request("/prompt", {
    method: "POST",
    body: new URLSearchParams({
      prompt: intentText,
      __aluna_restore_capability_id: "journal",
      __aluna_restore_incarnation_id: JOURNAL_INCARNATION_ID,
    }),
  });
  if (res.status !== 200) throw new Error(`prompt admission failed with ${res.status}`);
  const fragment = await res.text();
  const jobId = buildJobIdFromSubscriber(fragment);
  return { fragment, jobId, streamPath: `/build/${jobId}/stream` };
}
