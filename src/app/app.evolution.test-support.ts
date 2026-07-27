// Shared fixtures for the Module 4.6/05 evolution-route suites. One committed `journal`
// capability plus the `shelves` capability its dependency catalog sees, both published
// and activated on disk; the fake providers the routes are driven with; and the
// admit-then-stream helper. Not a test file itself; bun never runs it.
//
// Both capabilities get real snapshots on purpose: the engine reconciles every committed
// version before it treats a pointer as an evolution base, so a registry row with no
// artifacts behind it is corruption, not a convenient fixture shortcut.

import type { ZodType } from "zod";
import {
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
import type { Provider } from "../provider/index.ts";
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

/** An app whose provider answers exactly one canned candidate. */
export function scratchApp(env: ScratchDbEnv, response: unknown) {
  const { recordMetrics, rows, lifecycles } = makeMetricsRecorder();
  const { provider, prompts } = makeCandidateProvider(response);
  const app = makeScratchApp(env, provider, recordMetrics);
  return { app, prompts, rows, lifecycles };
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

export function moodEvolutionApp(env: ScratchDbEnv, candidate: CapabilitySpec) {
  const metrics = makeMetricsRecorder();
  const { provider, prompts } = makeSequenceProvider(moodResponses(candidate));
  return { app: makeScratchApp(env, provider, metrics.recordMetrics), prompts, ...metrics };
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

/** Admit one evolution against `journal` and return its job's stream path. */
export async function admitTrace(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  intent: string,
) {
  const res = await app.request("/demo/evolution/journal", {
    method: "POST",
    body: new URLSearchParams({ intent }),
  });
  if (res.status !== 200) throw new Error(`admission failed with ${res.status}`);
  const fragment = await res.text();
  const jobId = buildJobIdFromSubscriber(fragment);
  return { fragment, jobId, streamPath: `/demo/evolution/build/${jobId}/stream` };
}
