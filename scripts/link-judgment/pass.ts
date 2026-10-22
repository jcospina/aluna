// One case through the path a prompt takes in `src/pipeline/build/prompt-pipeline.ts`: the duplicate
// check, the Intent Resolver, and, for a new capability with something flagged, the spec writer and
// the link step, each read off the case's own scratch desk. Every check the build makes before the
// link step runs here too, so no case pays for a call the product would never make.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import {
  buildSpecPrompt,
  generateSpec,
  joinableTargets,
  readRelatedCapabilities,
  runLinkStep,
} from "../../src/builder/index.ts";
import { linkableField, linkRefusal } from "../../src/lifecycle/link/rules.ts";
import { duplicateIntentForPrompt } from "../../src/pipeline/build/admission/deflection.ts";
import {
  validateBuiltOverlapIdentity,
  validateProposedOverlapIdentity,
} from "../../src/pipeline/build/admission/overlap-identity.ts";
import {
  buildIntentPrompt,
  classifyIntentWithUsage,
  type IntentClassification,
} from "../../src/pipeline/intent/index.ts";
import { errorMessage } from "../../src/platform/errors.ts";
import { openDatabase, type PlatformDatabase } from "../../src/platform/persistence/db.ts";
import { runMigrations } from "../../src/platform/persistence/migrations.ts";
import type { GenerateResult, Provider, TokenUsage } from "../../src/platform/provider/index.ts";
import {
  type ActiveRegistryCatalog,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  insertCapability,
  isCapabilityIdAvailable,
  isLinkableField,
  listCapabilities,
  type Relation,
  readActiveRegistryCatalog,
} from "../../src/registry/index.ts";
import { DESKS, type DeskName, type EightCase, type STAGES } from "./cases.ts";

export type Stage = (typeof STAGES)[number];

export interface Call {
  readonly stage: Stage;
  usage: TokenUsage | null;
  /** The answer as the provider returned it, before any check of the platform's own. */
  answer: unknown;
  /** How long the answer took to arrive or fail. */
  ms: number | null;
}

interface Proposed {
  readonly field: string;
  readonly capability: string;
  readonly target_field: string;
}

interface Proposal extends Proposed {
  /** Why the link rules dropped it; null when it was kept. */
  readonly refused: string | null;
}

export interface Target {
  readonly capability: string;
  readonly field: string;
}

interface Failure {
  /** `script` is a fault of this script's own, not of a call. */
  readonly stage: Stage | "script";
  readonly message: string;
  readonly cause?: string;
  readonly finishReason?: string;
  /** The provider's HTTP status and the start of its response body, when it refused the call. */
  readonly status?: string;
  /** What the model answered, when an answer arrived and then failed a check. */
  readonly answer?: string;
}

export interface CaseResult {
  readonly eightCase: EightCase;
  readonly desk: readonly CapabilityRow[];
  /** The ids each expected target names on this desk. */
  readonly targets: readonly Target[] | null;
  /** Set when the duplicate check answered before the Resolver, as the product does. */
  readonly duplicate: boolean;
  readonly intent?: IntentClassification;
  /** The ids the Resolver answered, before its filter keeps only the other capabilities here. */
  readonly answeredFlags?: readonly string[];
  readonly spec?: CapabilitySpec;
  /** What the link step proposed, in its order; absent when it made no call. */
  readonly proposals?: readonly Proposal[];
  /** Set when replaying the link rules kept other relations than the step did. */
  readonly replayDiffers?: true;
  /** What passed the link rules. */
  readonly relations: readonly Relation[];
  /** Why the case ended before the link step answered, when nothing failed. */
  readonly stopped?: string;
  /** Why the build would refuse the request: the link judgment then goes unmeasured. */
  readonly refused?: string;
  /** What stopped the case midway, when a signal did. */
  readonly interrupted?: string;
  readonly failure?: Failure;
  readonly calls: readonly Call[];
}

/** What a rehearsal learns of a case without a call. */
export interface Rehearsal {
  readonly eightCase: EightCase;
  readonly desk: readonly CapabilityRow[];
  readonly duplicate: boolean;
}

/** How the caller follows a case: each call as it goes out, and what it has so far. */
export interface CaseWatch {
  readonly onCall: (stage: Stage) => void;
  /** Set by the case once it starts: its result so far, stopped by `interruption`. */
  partial?: (interruption: string) => CaseResult;
}

interface Reached {
  duplicate?: boolean;
  intent?: IntentClassification;
  spec?: CapabilitySpec;
  proposals?: readonly Proposal[];
  replayDiffers?: true;
  relations?: readonly Relation[];
  stopped?: string;
  refused?: string;
  fault?: { readonly stage: Failure["stage"]; readonly error: unknown };
}

interface CaseContext {
  readonly eightCase: EightCase;
  readonly provider: Provider;
  readonly conns: PlatformDatabase;
  readonly catalog: ActiveRegistryCatalog;
  readonly calls: Call[];
  readonly settling: Promise<void>[];
  readonly reached: Reached;
  readonly onCall?: CaseWatch["onCall"];
}

const DESK_SEED = 184206;

/** The desk's spec, checked by the registry's own schema. */
function loadDeskSpec(name: DeskName): CapabilitySpec {
  const path = join(import.meta.dir, "desks", DESKS[name].file);
  return capabilitySpecSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** A migrated scratch database at `path` holding the case's desk and no records. */
function openDesk(path: string, eightCase: EightCase): PlatformDatabase {
  const conns = openDatabase(path);
  try {
    runMigrations(conns.readwrite);
    for (const name of eightCase.desk) {
      const spec = loadDeskSpec(name);
      const { version } = DESKS[name];
      const incarnation = randomUUID();
      insertCapability(
        {
          ...spec,
          incarnation_id: incarnation,
          version,
          artifacts_path: `capabilities/${spec.id}/${incarnation}/v${version}/`,
          seed: DESK_SEED,
        },
        conns.readwrite,
      );
    }
    return conns;
  } catch (error) {
    closeDesk(conns);
    throw error;
  }
}

function closeDesk(conns: PlatformDatabase): void {
  conns.readonly.close();
  conns.readwrite.close();
}

function targetsOn(eightCase: EightCase): readonly Target[] | null {
  return (
    eightCase.targets?.map(({ desk, field }) => ({ capability: loadDeskSpec(desk).id, field })) ??
    null
  );
}

const NO_CALL: Provider = {
  generate() {
    throw new Error("A rehearsal makes no call.");
  },
};

/** Throws unless every field the case expects a relation to point at is a target on its desk. */
function checkTargets(eightCase: EightCase, desk: readonly CapabilityRow[]): void {
  for (const { capability, field } of targetsOn(eightCase) ?? []) {
    const row = desk.find(({ id }) => id === capability);
    const spec = row?.schema.fields.find(({ name }) => name === field);
    if (!row || !spec || !isLinkableField(row.ui_intent.form, spec)) {
      throw new Error(
        `Case ${eightCase.number} expects a relation to ${capability}.${field}, which is not a ` +
          "single-line text field on its desk.",
      );
    }
  }
}

/**
 * What each case would send, checked without a call: every desk loads into the registry, the
 * Resolver's and the spec writer's prompts render, every expected target can hold a relation, and
 * the duplicate check says which cases end before any call.
 */
export function rehearse(cases: readonly EightCase[], scratch: string): Rehearsal[] {
  return cases.map((eightCase) => {
    const conns = openDesk(join(scratch, `rehearsal-${eightCase.number}.db`), eightCase);
    try {
      const catalog = readActiveRegistryCatalog(conns.readonly);
      const ids = catalog.capabilities.map(({ id }) => id);
      checkTargets(eightCase, catalog.capabilities);
      buildIntentPrompt({ prompt: eightCase.request, capabilities: catalog.capabilities });
      buildSpecPrompt({
        provider: NO_CALL,
        prompt: eightCase.request,
        intent: {
          type: "new_capability",
          confidence: 1,
          target_capability: null,
          resolution: "new",
          proposed_identity: null,
          proposed_action: "Rehearse the spec writer's prompt.",
          user_facing_label: "Rehearsing.",
          related_capabilities: ids,
          requires_confirmation: false,
        },
        send: async () => undefined,
        incarnationId: randomUUID(),
        relatedCapabilities: readRelatedCapabilities(ids, conns.readonly),
      });
      const duplicate = duplicateIntentForPrompt(eightCase.request, catalog.capabilities);
      return { eightCase, desk: catalog.capabilities, duplicate: duplicate !== undefined };
    } finally {
      closeDesk(conns);
    }
  });
}

/** The provider for `stage`, allowed one call: a second throws before it reaches the provider. */
function oneCall(context: CaseContext, stage: Stage): Provider {
  const { provider, calls, settling } = context;
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      if (calls.some((call) => call.stage === stage)) {
        throw new Error(`The ${stage} was called twice in one case.`);
      }
      context.onCall?.(stage);
      const startedAt = performance.now();
      const result = provider.generate(prompt, schema);
      const call: Call = { stage, usage: null, answer: undefined, ms: null };
      calls.push(call);
      const arrived = () => {
        call.ms = performance.now() - startedAt;
      };
      settling.push(
        result.object.then((answer) => {
          call.answer = answer;
          arrived();
        }, arrived),
        result.usage.then(
          (usage) => {
            call.usage = usage;
          },
          () => undefined,
        ),
      );
      return result;
    },
  };
}

const refusal = (error: unknown) => `the build refuses it: "${errorMessage(error)}"`;

function namespaceIdentity(intent: IntentClassification) {
  return intent.resolution === "namespace" ? intent.proposed_identity : null;
}

/** The product's refusal of a namespace identity, checked before any build work. */
function proposedRefusal(intent: IntentClassification, catalog: ActiveRegistryCatalog) {
  const proposed = namespaceIdentity(intent);
  if (!proposed) return undefined;
  try {
    validateProposedOverlapIdentity({
      proposed,
      targetCapabilityId: intent.target_capability ?? "",
      capabilities: catalog.capabilities,
    });
    return undefined;
  } catch (error) {
    return refusal(error);
  }
}

/** The build's refusal of the spec it was handed, before the link step could answer. */
function builtRefusal(intent: IntentClassification, spec: CapabilitySpec, conns: PlatformDatabase) {
  try {
    const proposed = namespaceIdentity(intent);
    if (proposed) validateBuiltOverlapIdentity({ proposed, spec });
    if (!isCapabilityIdAvailable(spec.id, conns.readonly)) {
      throw new Error(`The id ${spec.id} is already taken on the desk.`);
    }
    return undefined;
  } catch (error) {
    return refusal(error);
  }
}

const isProposed = (entry: unknown): entry is Proposed =>
  typeof entry === "object" &&
  entry !== null &&
  ["field", "capability", "target_field"].every(
    (key) => typeof (entry as Record<string, unknown>)[key] === "string",
  );

function proposedRelations(answer: unknown): Proposed[] | undefined {
  if (typeof answer !== "object" || answer === null || !("relations" in answer)) return undefined;
  return Array.isArray(answer.relations) ? answer.relations.filter(isProposed) : undefined;
}

type LinkSource = Parameters<typeof runLinkStep>[0]["source"];

/** Why the step dropped `entry`, by the checks `runLinkStep` and `admittedRelations` make. */
function refusalOf(
  entry: Proposed,
  source: LinkSource,
  joinable: readonly CapabilityRow[],
  kept: readonly Relation[],
  desk: readonly CapabilityRow[],
): string | null {
  if (!linkableField({ row: source, field: entry.field })) return "source not linkable";
  const target = joinable.find(({ id }) => id === entry.capability);
  if (!target) return "not a flagged capability's id";
  const row = { ...source, relations: [...kept] };
  const rest = [...desk.filter(({ id }) => id !== source.id), row];
  const code = linkRefusal(
    { row, field: entry.field },
    { row: target, field: entry.target_field },
    rest,
  );
  return code ? code.replaceAll("_", " ") : null;
}

/** The step's answer replayed in its own order, so each dropped entry names the rule that dropped it. */
function replay(
  proposed: readonly Proposed[],
  source: LinkSource,
  flagged: readonly CapabilityRow[],
  desk: readonly CapabilityRow[],
): { proposals: Proposal[]; kept: Relation[] } {
  const joinable = joinableTargets(source, flagged);
  const kept: Relation[] = [];
  const proposals = proposed.map((entry) => {
    const refused = refusalOf(entry, source, joinable, kept, desk);
    const target = joinable.find(({ id }) => id === entry.capability);
    if (refused === null && target) {
      const to = {
        capability: target.id,
        incarnation: target.incarnation_id,
        field: entry.target_field,
      };
      kept.push({ field: entry.field, to });
    }
    return { ...entry, refused };
  });
  return { proposals, kept };
}

async function link(
  context: CaseContext,
  intent: IntentClassification,
  spec: CapabilitySpec,
  incarnationId: string,
): Promise<void> {
  const { reached } = context;
  const desk = listCapabilities(context.conns.readonly);
  const flagged = desk.filter(({ id }) => intent.related_capabilities.includes(id));
  const source = {
    ...spec,
    incarnation_id: incarnationId,
    display_label_override: null,
    relations: [],
  };
  const linked = await runLinkStep({
    provider: oneCall(context, "link step"),
    request: context.eightCase.request,
    source,
    flagged,
    catalog: desk,
  });
  await Promise.allSettled(context.settling);
  reached.relations = linked.relations;
  const call = context.calls.find(({ stage }) => stage === "link step");
  const proposed = call ? proposedRelations(call.answer) : undefined;
  if (proposed) {
    const { proposals, kept } = replay(proposed, source, flagged, desk);
    reached.proposals = proposals;
    if (JSON.stringify(kept) !== JSON.stringify(linked.relations)) reached.replayDiffers = true;
  }
  if (linked.failure !== undefined) reached.fault = { stage: "link step", error: linked.failure };
  else if (!call) reached.stopped = "the link step had nothing to join, so it made no call";
}

async function writeAndLink(context: CaseContext, intent: IntentClassification): Promise<void> {
  const { reached } = context;
  const incarnationId = randomUUID();
  const relatedCapabilities = readRelatedCapabilities(
    intent.related_capabilities,
    context.conns.readonly,
  );
  let spec: CapabilitySpec;
  try {
    ({ spec } = await generateSpec({
      provider: oneCall(context, "spec writer"),
      prompt: context.eightCase.request,
      intent,
      send: async () => undefined,
      incarnationId,
      relatedCapabilities,
    }));
  } catch (error) {
    reached.fault = { stage: "spec writer", error };
    return;
  }
  reached.spec = spec;
  reached.refused = builtRefusal(intent, spec, context.conns);
  if (!reached.refused) await link(context, intent, spec, incarnationId);
}

async function walk(context: CaseContext): Promise<void> {
  const { eightCase, catalog, reached } = context;
  const duplicate = duplicateIntentForPrompt(eightCase.request, catalog.capabilities);
  if (duplicate) {
    reached.duplicate = true;
    reached.intent = duplicate;
    reached.stopped = "the duplicate check found it already on the desk";
    return;
  }
  let intent: IntentClassification;
  try {
    ({ intent } = await classifyIntentWithUsage({
      provider: oneCall(context, "resolver"),
      prompt: eightCase.request,
      catalog,
      activeCapabilityId: null,
    }));
  } catch (error) {
    reached.fault = { stage: "resolver", error };
    return;
  }
  reached.intent = intent;
  if (intent.type !== "new_capability") {
    reached.stopped = "it is not a new capability";
    return;
  }
  reached.refused = proposedRefusal(intent, catalog);
  if (reached.refused) return;
  if (intent.related_capabilities.length === 0) reached.stopped = "nothing was flagged";
  else await writeAndLink(context, intent);
}

/** A failed call's error, with the cause and the answer the provider's own error carries. */
function failureOf(fault: NonNullable<Reached["fault"]>, calls: readonly Call[]): Failure {
  const { stage, error } = fault;
  const parts = (typeof error === "object" && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const answered = calls.find((call) => call.stage === stage)?.answer;
  const text =
    typeof parts.text === "string"
      ? parts.text
      : answered === undefined
        ? undefined
        : JSON.stringify(answered, null, 2);
  return {
    stage,
    message: errorMessage(error),
    ...(parts.cause === undefined ? {} : { cause: errorMessage(parts.cause) }),
    ...(typeof parts.finishReason === "string" ? { finishReason: parts.finishReason } : {}),
    ...(typeof parts.statusCode === "number"
      ? { status: `${parts.statusCode} ${String(parts.responseBody ?? "").slice(0, 600)}`.trim() }
      : {}),
    ...(text === undefined ? {} : { answer: text }),
  };
}

function flagsAnswered(calls: readonly Call[]): readonly string[] | undefined {
  const answer = calls.find(({ stage }) => stage === "resolver")?.answer;
  if (typeof answer !== "object" || answer === null || !("related_capabilities" in answer)) {
    return undefined;
  }
  const flags = answer.related_capabilities;
  return Array.isArray(flags) ? flags.filter((id): id is string => typeof id === "string") : [];
}

function resultOf(
  eightCase: EightCase,
  known: Pick<CaseResult, "desk" | "targets">,
  reached: Reached,
  calls: readonly Call[],
): CaseResult {
  const { fault, ...outcome } = reached;
  const answeredFlags = flagsAnswered(calls);
  return {
    eightCase,
    ...known,
    duplicate: false,
    relations: [],
    calls: [...calls],
    ...outcome,
    ...(answeredFlags ? { answeredFlags } : {}),
    ...(fault ? { failure: failureOf(fault, calls) } : {}),
  };
}

/** Runs one case on its own scratch desk. It never rejects: whatever fails is the result's. */
export async function runCase(
  eightCase: EightCase,
  provider: Provider,
  scratch: string,
  watch?: CaseWatch,
): Promise<CaseResult> {
  const calls: Call[] = [];
  const settling: Promise<void>[] = [];
  const reached: Reached = {};
  let known: Pick<CaseResult, "desk" | "targets"> = { desk: [], targets: null };
  if (watch) {
    watch.partial = (interrupted) => ({
      ...resultOf(eightCase, known, reached, calls),
      interrupted,
    });
  }
  let conns: PlatformDatabase | undefined;
  try {
    conns = openDesk(join(scratch, `case-${eightCase.number}.db`), eightCase);
    const catalog = readActiveRegistryCatalog(conns.readonly);
    known = { desk: catalog.capabilities, targets: targetsOn(eightCase) };
    const onCall = watch?.onCall;
    await walk({ eightCase, provider, conns, catalog, calls, settling, reached, onCall });
  } catch (error) {
    reached.fault = { stage: "script", error };
  } finally {
    await Promise.allSettled(settling);
    if (conns) closeDesk(conns);
  }
  return resultOf(eightCase, known, reached, calls);
}
