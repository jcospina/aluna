// Shared fixtures for the Module 4.6/05 consolidated engine battery. One committed
// `notes` v1 published on disk with a record already stored, a fake provider that answers
// whatever the engine asks for, and one `evolve` call that runs the whole engine over it.
// Not a test file itself; bun never runs it.

import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";
import { evolutionIntentFor } from "../../builder/evolution/candidate.test-support.ts";
import {
  behavioralResponseFor,
  createHandlerFor,
  DELETE_HANDLER,
  frozenTestsInput,
  fullBehavioralSuiteFor,
  fullHandlersFor,
  generatedUnitsFor,
  itemRendererFor,
  notesSpec,
  readHandlerFor,
  searchHandlerFor,
  updateHandlerFor,
} from "../../builder/gate/gate.test-support.ts";
import {
  activatePublishedSnapshot,
  type CapabilityGateResult,
  expectedAbsentCapability,
  publishCapabilitySnapshot,
  runCapabilityGate,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import { applyCapabilityTableDdl, deriveCapabilityTableDdl } from "../../capability-data/index.ts";
import type { StoredGenerationLifecycle } from "../../metrics/index.ts";
import { makeMetricsRecorder } from "../../metrics/metrics-test-recorder.ts";
import { openDatabase, type PlatformDatabase } from "../../persistence/db.ts";
import { runMigrations } from "../../persistence/migrations.ts";
import type { DeepPartial, GenerateResult, Provider } from "../../provider/index.ts";
import { type CapabilitySpec, getCapability } from "../../registry/index.ts";
import type { SendBuildEvent } from "../jobs/build-jobs.ts";
import { createMetricsRecorder } from "../metrics-recorder.ts";
import {
  type CapabilityEvolutionOutcome,
  type RunCapabilityEvolutionInput,
  runCapabilityEvolution,
} from "./evolution-run.ts";

export const INCARNATION_ID = "55555555-5555-4555-8555-555555555555";

/** One unit's substitute bytes: fixed for every generation, or a queue answered in order. */
export type UnitOverride = string | readonly string[];

/** The seeded record's text — written before any evolved column existed. */
export const HISTORICAL_TEXT = "written before the due date existed";

/** Notes v1: a required text field and an optional boolean. */
export function committedSpec(): CapabilitySpec {
  return notesSpec();
}

export function handlersFor(spec: CapabilitySpec) {
  return fullHandlersFor(spec, { create: createHandlerFor(spec), read: readHandlerFor(spec) });
}

export function committedGate(
  spec: CapabilitySpec = committedSpec(),
): Promise<CapabilityGateResult> {
  return runCapabilityGate({
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: handlersFor(spec),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: { enabled: false },
  });
}

/**
 * The same committed v1, published **tier-on** — the only base from which an evolution can
 * carry a frozen suite forward. It matters for more than coverage: a carried suite's setup
 * rows were written against v1's schema, so once an evolution adds a column those rows are
 * the Gate's *existing records*, holding a historical `null` in a column that did not exist
 * when the intent was frozen (4.7/04).
 */
export function committedTierOnGate(
  spec: CapabilitySpec = committedSpec(),
): Promise<CapabilityGateResult> {
  return runCapabilityGate({
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: handlersFor(spec),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: { enabled: true, frozen: frozenTestsInput(spec, behavioralSuiteFor(spec)) },
  });
}

export interface EngineEnv {
  readonly root: string;
  readonly artifactsRoot: string;
  readonly conns: PlatformDatabase;
  readonly gate: CapabilityGateResult;
}

/**
 * Publish + activate the committed v1 and seed the one historical record. `spec` lets a
 * case bring a different committed shape (it must keep the `notes` id, so the shared
 * path/table helpers still resolve); its gate must have been issued for that same spec.
 */
export async function setUpCommitted(
  gate: CapabilityGateResult,
  spec: CapabilitySpec = committedSpec(),
): Promise<EngineEnv> {
  const root = mkdtempSync(join(tmpdir(), "omni-crud-evolution-run-"));
  const artifactsRoot = join(root, "capabilities");
  const conns = openDatabase(join(root, "platform.db"));
  runMigrations(conns.readwrite);
  const publication = publishCapabilitySnapshot({
    buildId: "v1",
    spec,
    incarnationId: INCARNATION_ID,
    version: 1,
    units: generatedUnitsFor(spec, handlersFor(spec)),
    gate,
    artifactsRoot,
  });
  await activatePublishedSnapshot({
    database: conns.readwrite,
    spec,
    publication,
    expected: expectedAbsentCapability(),
    applyMigration: (database) => void applyCapabilityTableDdl(spec, database),
    finalizeMetrics: () => undefined,
  });
  conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text", "pinned") VALUES (?, ?, ?)', [
    "note-1",
    HISTORICAL_TEXT,
    0,
  ]);
  return { root, artifactsRoot, conns, gate };
}

/** Publish and activate one additional v1 so evolution can exercise real dependencies. */
export async function addCommittedDependency(
  env: EngineEnv,
  spec: CapabilitySpec,
  incarnationId: string,
): Promise<ReturnType<typeof publishCapabilitySnapshot>> {
  const gate = await committedGate(spec);
  const publication = publishCapabilitySnapshot({
    buildId: `${spec.id}-v1`,
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
  return publication;
}

export function tearDownCommitted(env: EngineEnv): void {
  env.conns.readwrite.close();
  env.conns.readonly.close();
  rmSync(env.root, { recursive: true, force: true });
}

/**
 * Answer whatever the engine asks for, by reading the prompt: the candidate spec first,
 * then each unit the work plan regenerates, then the behavioral suite when the tier is
 * on. Dispatching on the prompt rather than on call order is deliberate — a case that
 * proves "these units were copied" must not depend on the test knowing the request order,
 * and it records exactly which units entered a generation prompt.
 */
export function engineProvider(
  candidate: CapabilitySpec,
  unitOverrides: Readonly<Record<string, UnitOverride>> = {},
  onRepairGeneration?: (unit: string) => Promise<void>,
): {
  provider: Provider;
  prompts: string[];
  generatedUnits: string[];
} {
  const prompts: string[] = [];
  const generatedUnits: string[] = [];
  const units: Record<string, string> = {
    item: itemRendererFor(candidate),
    create: createHandlerFor(candidate),
    read: readHandlerFor(candidate),
    update: updateHandlerFor(candidate),
    delete: DELETE_HANDLER,
    search: searchHandlerFor(candidate),
    ...Object.fromEntries(
      Object.entries(unitOverrides).flatMap(([name, override]) =>
        typeof override === "string" ? [[name, override]] : [],
      ),
    ),
  };
  // A queued override answers successive generations of the same unit in order and then
  // falls back to the good default — how a case drives the Gate into a *repairable*
  // failure: the build writes bad bytes, and the repair regeneration writes correct ones.
  const queues = new Map<string, string[]>(
    Object.entries(unitOverrides).flatMap(([name, override]) =>
      typeof override === "string" ? [] : [[name, [...override]]],
    ),
  );
  const suite = behavioralSuiteFor(candidate);
  const unitContent = (name: string): string | undefined => {
    const queued = queues.get(name);
    return (queued && queued.length > 0 ? queued.shift() : undefined) ?? units[name];
  };
  // A unit generated a second time is the Gate repairing it — the only point at which a
  // case can stop the run *inside* the repair loop.
  const generationCounts = new Map<string, number>();
  const isRepair = (name: string): boolean => {
    const next = (generationCounts.get(name) ?? 0) + 1;
    generationCounts.set(name, next);
    return next > 1;
  };

  const answer = (prompt: string): unknown => {
    const handler = /^Generate the (\w+)\.ts handler/u.exec(prompt);
    if (handler?.[1]) {
      generatedUnits.push(handler[1]);
      return { content: unitContent(handler[1]) };
    }
    if (prompt.startsWith("Generate the item.ts item renderer")) {
      generatedUnits.push("item");
      return { content: unitContent("item") };
    }
    // One fixture answers all five per-Action generation calls the freeze stage makes.
    if (prompt.startsWith("Generate deterministic black-box behavioral tests")) {
      return behavioralResponseFor(prompt, suite);
    }
    return candidate;
  };

  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const response = answer(prompt);
      const repairing = /^Generate the (\w+)\.ts handler/u.exec(prompt)?.[1];
      const held =
        repairing && onRepairGeneration && isRepair(repairing)
          ? onRepairGeneration(repairing)
          : Promise.resolve();
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        await held;
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: held.then(() => response as T),
        usage: held.then(() => ({ inputTokens: 32, outputTokens: 16, totalTokens: 48 })),
      };
    },
  };
  return { provider, prompts, generatedUnits };
}

/** The tier-on suite, derived from whichever notes-shaped candidate is under test. */
export function behavioralSuiteFor(candidate: CapabilitySpec) {
  const extras = Object.fromEntries(
    candidate.schema.fields
      .filter((field) => field.lifecycle === "active" && field.name !== "text")
      .map((field) => [field.name, field.type === "boolean" ? false : "2026-07-27"]),
  );
  const row = (text: string) => ({ ...extras, text });
  return fullBehavioralSuiteFor(candidate, {
    createValues: row("Behavioral note"),
    updateValues: row("Updated note"),
    readValues: row("Read me"),
    searchMatchValues: row("Matching note newest"),
    searchOlderMatchValues: row("Matching note older"),
    searchMissValues: row("Other entry"),
    markerField: "text",
    searchQuery: "matching",
  });
}

export interface EvolveResult {
  readonly outcome: CapabilityEvolutionOutcome;
  readonly events: { readonly event: string; readonly data: string }[];
  readonly prompts: string[];
  readonly generatedUnits: string[];
  readonly lifecycles: ReturnType<typeof makeMetricsRecorder>["lifecycles"];
  /** The durable row as it stands after the run — `null` when none was written. */
  readonly lifecycle: StoredGenerationLifecycle | null;
}

export type EvolveOptions = Partial<
  Pick<
    RunCapabilityEvolutionInput,
    | "behavioralTierEnabled"
    | "beforePublish"
    | "faults"
    | "firstPassHandlerFixture"
    | "isAborted"
    | "active"
    | "resolvedIntent"
  >
> & {
  readonly buildId: string;
  /** Observe delivery synchronously; cancellation tests use it to target an exact preview. */
  readonly onSend?: SendBuildEvent;
  /**
   * Replace one unit's generated bytes — how a case drives the Gate into failing. A string
   * answers every generation of that unit; an array answers them in order and then reverts
   * to the good default, which is how a case exercises a *repair* rather than a dead end.
   */
  readonly unitOverrides?: Readonly<Record<string, UnitOverride>>;
  /**
   * Write the lifecycle through the real SQLite recorder instead of the in-memory stub.
   * Required by any case that faults *inside* the activation transaction: the stub
   * mutates a Map, so it cannot model the rollback the whole point-of-no-return design
   * rests on, and would report `success/activated` for a run that rolled back.
   */
  readonly durableMetrics?: boolean;
  /**
   * Fires when the Gate asks the provider to *rewrite* a unit it already generated — the
   * only point from which a case can stop a run inside the bounded repair loop.
   */
  readonly onRepairGeneration?: (unit: string) => Promise<void>;
};

/** Run the whole engine once over the committed capability. */
export async function evolve(
  env: EngineEnv,
  candidate: CapabilitySpec,
  intentText: string,
  options: EvolveOptions,
): Promise<EvolveResult> {
  const { provider, prompts, generatedUnits } = engineProvider(
    candidate,
    options.unitOverrides ?? {},
    options.onRepairGeneration,
  );
  const active = options.active ?? getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");
  const events: { event: string; data: string }[] = [];
  const send: SendBuildEvent = async (event, data) => {
    events.push({ event, data });
    await options.onSend?.(event, data);
  };
  const captured = makeMetricsRecorder();
  const recordMetrics = options.durableMetrics
    ? createMetricsRecorder(env.conns.readwrite)
    : captured.recordMetrics;
  const { lifecycles } = captured;
  const outcome = await runCapabilityEvolution({
    active,
    intentText,
    // The engine only ever runs behind the resolver (4.8/04); a case that cares about the
    // classification itself passes its own.
    resolvedIntent: options.resolvedIntent ?? evolutionIntentFor(active, intentText),
    provider,
    buildId: options.buildId,
    database: env.conns,
    artifactsRoot: env.artifactsRoot,
    recordMetrics,
    send,
    ...(options.behavioralTierEnabled === undefined
      ? {}
      : { behavioralTierEnabled: options.behavioralTierEnabled }),
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
    ...(options.faults ? { faults: options.faults } : {}),
    ...(options.firstPassHandlerFixture
      ? { firstPassHandlerFixture: options.firstPassHandlerFixture }
      : {}),
    ...(options.isAborted ? { isAborted: options.isAborted } : {}),
  });
  return {
    outcome,
    events,
    prompts,
    generatedUnits,
    lifecycles,
    lifecycle: recordMetrics.get(options.buildId, active.incarnation_id),
  };
}

/**
 * The durable lifecycle row as SQLite actually holds it — the only reading that survives
 * a rolled-back activation transaction, and therefore the only one a fault case may
 * trust. Reads after a throw, when `evolve` returned nothing.
 */
export function durableLifecycle(
  env: EngineEnv,
  buildId: string,
): StoredGenerationLifecycle | null {
  return createMetricsRecorder(env.conns.readwrite).get(buildId, INCARNATION_ID);
}

export function activated(result: EvolveResult) {
  if (result.outcome.kind !== "activated") {
    throw new Error(`expected an activated evolution, got ${result.outcome.kind}`);
  }
  return result.outcome;
}

export function factKinds(result: EvolveResult): string[] {
  const { outcome } = result;
  if (outcome.kind === "cancelled") throw new Error("a cancelled run has no facts");
  return outcome.diff.facts.map((fact) => fact.kind);
}

/** The bytes one unit carries in a published version directory. */
export function publishedUnit(env: EngineEnv, version: number, filename: string): string {
  return readFileSync(
    join(env.artifactsRoot, "notes", INCARNATION_ID, `v${version}`, filename),
    "utf8",
  );
}

export function versionDirectory(env: EngineEnv, version: number): string {
  return join(env.artifactsRoot, "notes", INCARNATION_ID, `v${version}`);
}

export function tableColumns(env: EngineEnv, table: string): string[] {
  return env.conns.readonly
    .query('SELECT "name" FROM pragma_table_info(?)')
    .all(table)
    .map((column) => (column as { name: string }).name);
}

// ── The candidates the batteries share ──────────────────────────────────────

export const DUE_DATE_FIELD = {
  name: "due_date",
  label: "Due date",
  type: "date",
  required: false,
  lifecycle: "active",
} as const;

/**
 * The tracer's candidate: "add a due date to my notes and make it stand out in the list".
 * A nullable new field, the item's presentation dependency and design direction, the
 * detail order, and the behavior sentence that describes it — a genuinely multi-fact
 * evolution whose free-text `behavior` change pulls in decision 22's all-Handler fallback.
 */
export function dueDateCandidate(): CapabilitySpec {
  const base = committedSpec();
  return notesSpec({
    schema: { fields: [...base.schema.fields, DUE_DATE_FIELD] },
    ui_intent: {
      ...base.ui_intent,
      item: {
        direction: "A text-forward card whose due date stands out as a prominent badge.",
        shows: ["text", "due_date"],
      },
      detail: { shows: ["text", "due_date"] },
    },
    behavior:
      "Text is required. A due date is optional. Newest notes appear first, and a note " +
      "with a due date shows it prominently.",
  });
}

/** The same new column with nothing else touched — the behavior-neutral additive change. */
export function behaviorNeutralDueDateCandidate(): CapabilitySpec {
  const base = committedSpec();
  return notesSpec({ schema: { fields: [...base.schema.fields, DUE_DATE_FIELD] } });
}

/**
 * The three places one "nothing had to be re-proven" verdict has to agree: the Gate's own
 * run, the snapshot's durable tier metadata, and the metrics stage vector. They are asserted
 * together because a verdict that only one of them records is not a verdict a developer or a
 * later reader of the artifacts can trust.
 */
export function expectEveryFrozenSuiteSkipped(
  result: Awaited<ReturnType<typeof evolve>>,
  outcome: ReturnType<typeof activated>,
  directory: string,
): void {
  expect(outcome.assembly.behavioralExecution?.fullSuite).toBe(false);
  expect(
    outcome.assembly.behavioralExecution?.actions.map(
      (entry) => `${entry.action}:${entry.source}:${entry.execution}`,
    ),
  ).toEqual([
    "create:copied:skipped",
    "read:copied:skipped",
    "update:copied:skipped",
    "delete:copied:skipped",
    "search:copied:skipped",
  ]);
  if (outcome.assembly.gate.behavioral.tier !== "on") {
    throw new Error("expected a tier-on evolution");
  }
  expect(outcome.assembly.gate.behavioral.testRun.cases).toEqual([]);

  // The snapshot's tier metadata is the durable record — a later reader of the artifacts can
  // tell "carried and re-proven" from "carried and left alone".
  expect(verifyCapabilitySnapshot(directory).manifest.behavioral_tests).toEqual({
    full_suite: false,
    actions: (["create", "read", "update", "delete", "search"] as const).map((action) => ({
      action,
      source: "copied",
      execution: "skipped",
      reason: "no_covered_handler_change",
    })),
  });

  // And the durable metrics row says the same thing per Action, in the stage vocabulary.
  expect(result.lifecycles.at(-1)?.stages).toEqual(
    expect.arrayContaining([
      { stage: "behavioral_test_generation", state: "copied" },
      { stage: "behavioral_test_execution", state: "skipped" },
      {
        stage: "behavioral_test_generation",
        state: "copied",
        test: { kind: "behavioral-suite", name: "search" },
      },
      {
        stage: "behavioral_test_execution",
        state: "skipped",
        test: { kind: "behavioral-suite", name: "search" },
      },
    ]),
  );
}
