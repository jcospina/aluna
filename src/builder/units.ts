// Unit generation — Module 2 Epic 2.5, re-cut by Module 3 Epic 3.4/02 (ARCH §6.2
// "Capability Builder" step 3, ADR-0003 bounded tool-loop, ADR-0004 generated
// artifact contract as amended by ADR-0005 §2).
//
// Module 4.4 extends Module 3's one item renderer + Handler model to the complete
// fixed Action inventory. The item renderer turns one record into the capability-specific inner
// markup, generated **knowing** the chosen `collection.layout`; the Handlers receive
// the presentation adapter (3.4/01) through their injected toolbox and call it instead
// of emitting their own row markup — so create and read render identical item markup by
// construction, and the list/create Views are gone (the platform renders them
// deterministically from the spec). Generation is agentic only inside one unit at a
// time: write -> check -> feed back the failure -> fix, capped by a small config knob.
// Across units the order and scope are fixed.
//
// This file owns the public contract and the orchestration; the per-unit prompts live
// in `unit-prompts.ts` and the static checks in `unit-checks.ts`.

import { z } from "zod";
import type { DeepPartial, Provider, TokenUsage } from "../provider/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  TRANSITIONAL_CAPABILITY_TOOLS,
} from "../registry/index.ts";

import { checkGeneratedUnit } from "./unit-checks.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

export const DEFAULT_UNIT_FIX_ATTEMPTS = 2;

// The single generated presentation unit's name — the stem of the version-keyed file
// the router loads it from (`item.ts`, `ITEM_RENDERER_FILE` in src/router/router.ts).
export const ITEM_RENDERER_UNIT_NAME = "item";

const generatedUnitSchema = z.strictObject({ content: z.string().min(1) });
type GeneratedUnitObject = z.infer<typeof generatedUnitSchema>;

export type HandlerUnitName = (typeof FULL_CAPABILITY_TOOLS)[number];
export type TransitionalHandlerUnitName = (typeof TRANSITIONAL_CAPABILITY_TOOLS)[number];
export type ItemRendererUnitName = typeof ITEM_RENDERER_UNIT_NAME;

export type GeneratedUnit =
  | {
      readonly kind: "handler";
      readonly name: HandlerUnitName;
      readonly filename: `${HandlerUnitName}.ts`;
      readonly content: string;
      readonly attempts: readonly UnitGenerationAttempt[];
      readonly durationMs: number;
      readonly usage: TokenUsage;
    }
  | {
      readonly kind: "item-renderer";
      readonly name: ItemRendererUnitName;
      readonly filename: `${ItemRendererUnitName}.ts`;
      readonly content: string;
      readonly attempts: readonly UnitGenerationAttempt[];
      readonly durationMs: number;
      readonly usage: TokenUsage;
    };

export interface UnitGenerationAttempt {
  readonly attempt: number;
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly error?: string;
}

export interface GenerateCapabilityUnitsInput {
  readonly provider: Provider;
  readonly spec: CapabilitySpec;
  readonly dependencyCatalog?: readonly CapabilityRow[];
  // Config knob from PLAN decision 5. Defaults to two attempts: the initial write
  // plus one fix pass. Reused (not new) for the item renderer (ADR-0005 decision 6).
  readonly maxAttempts?: number;
  readonly observer?: UnitGenerationObserver;
}

export interface GenerateCapabilityUnitsResult {
  readonly units: readonly GeneratedUnit[];
  readonly handlers: Readonly<Partial<Record<HandlerUnitName, string>>>;
  // The one generated presentation surface — the composition input the router binds
  // into each Handler's presentation adapter (3.4/01), and the content the commit
  // stage writes to `item.ts`.
  readonly itemRenderer: string;
}

export type UnitDescriptor =
  | { readonly kind: "handler"; readonly name: HandlerUnitName }
  | { readonly kind: "item-renderer"; readonly name: ItemRendererUnitName };

/** A failed unit check: the unit being generated, plus the message fed back to fix it. */
export type UnitGenerationFailure = UnitDescriptor & { readonly message: string };

export interface UnitGenerationStartEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: number;
}

export interface UnitGenerationPartialEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: number;
  readonly content: string;
}

export interface UnitGenerationAttemptEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: UnitGenerationAttempt;
}

export interface UnitGenerationObserver {
  readonly onUnitStart?: (event: UnitGenerationStartEvent) => void | Promise<void>;
  readonly onUnitPartial?: (event: UnitGenerationPartialEvent) => void | Promise<void>;
  readonly onUnitAttempt?: (event: UnitGenerationAttemptEvent) => void | Promise<void>;
  readonly onUnitGenerated?: (unit: GeneratedUnit) => void | Promise<void>;
}

export class UnitGenerationError extends Error {
  override readonly name = "UnitGenerationError";
  readonly unit: UnitDescriptor;
  readonly attempts: readonly UnitGenerationAttempt[];

  constructor(unit: UnitDescriptor, attempts: readonly UnitGenerationAttempt[]) {
    super(
      `Generated ${unit.kind} "${unit.name}" did not pass after ${attempts.length} attempt(s).`,
    );
    this.unit = unit;
    this.attempts = attempts;
  }
}

// Re-exported so the public builder surface (src/builder/index.ts) and callers can
// reach the prompt builder without depending on the prompts file directly.
export { buildUnitPrompt } from "./unit-prompts.ts";

/**
 * Generate the complete unit inventory declared by `spec`, in fixed order — the item
 * renderer first (the creative surface, generated knowing `collection.layout`), then
 * each canonical Action Handler through its bounded write→check→fix loop. During the
 * reset-bounded transition this still accepts the exact two-Action shape; prompt-built
 * 4.4 specs always declare all five. Returns the
 * generated units plus the handler map and item-renderer content the gate and commit
 * consume. Throws {@link UnitGenerationError} if any unit never passes its checks.
 */
export async function generateCapabilityUnits(
  input: GenerateCapabilityUnitsInput,
): Promise<GenerateCapabilityUnitsResult> {
  assertHandlerSpec(input.spec);
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const units: GeneratedUnit[] = [];

  units.push(
    await generateUnit(
      input.provider,
      input.spec,
      { kind: "item-renderer", name: ITEM_RENDERER_UNIT_NAME },
      maxAttempts,
      input.observer,
      input.dependencyCatalog,
    ),
  );

  for (const action of input.spec.tools) {
    units.push(
      await generateUnit(
        input.provider,
        input.spec,
        { kind: "handler", name: action },
        maxAttempts,
        input.observer,
        input.dependencyCatalog,
      ),
    );
  }

  return {
    units,
    handlers: Object.fromEntries(
      input.spec.tools.map((action) => [action, contentFor(units, "handler", action)]),
    ),
    itemRenderer: itemRendererContent(units),
  };
}

async function generateUnit(
  provider: Provider,
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  maxAttempts: number,
  observer: UnitGenerationObserver | undefined,
  dependencyCatalog: readonly CapabilityRow[] | undefined,
): Promise<GeneratedUnit> {
  const attempts: UnitGenerationAttempt[] = [];
  let previousFailure: UnitGenerationFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await observer?.onUnitStart?.({ unit, attempt });
    const startedAt = performance.now();
    const result = provider.generate(
      buildUnitPrompt(spec, unit, previousFailure, dependencyCatalog),
      generatedUnitSchema,
    );
    const partialsSettled = observeUnitPartials(unit, attempt, result.partialStream, observer);
    const generated = generatedUnitSchema.parse(await result.object);
    await partialsSettled;
    const usage = await result.usage;
    const durationMs = performance.now() - startedAt;
    const failure = checkGeneratedUnit(spec, unit, generated.content);
    const attemptRecord = {
      attempt,
      durationMs,
      usage,
      ...(failure ? { error: failure.message } : {}),
    };
    attempts.push(attemptRecord);
    await observer?.onUnitAttempt?.({ unit, attempt: attemptRecord });

    if (!failure) {
      const generatedUnit = toGeneratedUnit(unit, generated.content, attempts);
      await observer?.onUnitGenerated?.(generatedUnit);
      return generatedUnit;
    }

    previousFailure = failure;
  }

  throw new UnitGenerationError(unit, attempts);
}

/** One unit's worth: the parsed content of a single generation pass, plus its cost. */
export interface UnitGenerationPass {
  readonly content: string;
  readonly usage: TokenUsage;
  readonly durationMs: number;
}

/**
 * Run one generation pass for a unit — build its prompt (feeding a prior failure back
 * when present, exactly as {@link generateUnit} does), stream a structured object, and
 * return the parsed `content` with its usage and wall time. This is the write step of the
 * bounded fix loop factored out for callers that drive their own loop rather than the
 * observer-driven `generateUnit`: the design-lint gate rung (3.6) reuses it to regenerate
 * the item renderer when it rejects the composition, so a design violation re-enters the
 * *same* mechanism the type-check rung uses. Awaits `object` (and `usage`) without draining
 * the partial stream — the spine self-drives, the established pattern for the non-preview
 * call sites (`generateBehavioralTests`).
 */
export async function generateUnitContent(
  provider: Provider,
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  previousFailure?: UnitGenerationFailure,
): Promise<UnitGenerationPass> {
  const startedAt = performance.now();
  const result = provider.generate(
    buildUnitPrompt(spec, unit, previousFailure),
    generatedUnitSchema,
  );
  const { content } = generatedUnitSchema.parse(await result.object);
  const usage = await result.usage;
  return { content, usage, durationMs: performance.now() - startedAt };
}

async function observeUnitPartials(
  unit: UnitDescriptor,
  attempt: number,
  partialStream: AsyncIterable<DeepPartial<GeneratedUnitObject>>,
  observer: UnitGenerationObserver | undefined,
): Promise<void> {
  if (!observer?.onUnitPartial) return;

  for await (const partial of partialStream) {
    if (typeof partial.content === "string") {
      await observer.onUnitPartial({ unit, attempt, content: partial.content });
    }
  }
}

function toGeneratedUnit(
  unit: UnitDescriptor,
  content: string,
  attempts: readonly UnitGenerationAttempt[],
): GeneratedUnit {
  const base = {
    content,
    attempts,
    durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
    usage: sumUsage(attempts.map((attempt) => attempt.usage)),
  };

  if (unit.kind === "handler") {
    const name = unit.name;
    return {
      kind: "handler",
      name,
      filename: `${name}.ts`,
      ...base,
    };
  }

  return {
    kind: "item-renderer",
    name: ITEM_RENDERER_UNIT_NAME,
    filename: `${ITEM_RENDERER_UNIT_NAME}.ts`,
    ...base,
  };
}

function contentFor(
  units: readonly GeneratedUnit[],
  kind: "handler",
  name: HandlerUnitName,
): string {
  const unit = units.find((candidate) => candidate.kind === kind && candidate.name === name);
  if (!unit) throw new Error(`missing generated ${kind} ${name}`);
  return unit.content;
}

function itemRendererContent(units: readonly GeneratedUnit[]): string {
  const unit = units.find((candidate) => candidate.kind === "item-renderer");
  if (!unit) throw new Error("missing generated item renderer");
  return unit.content;
}

function assertHandlerSpec(spec: CapabilitySpec): void {
  const expected =
    spec.tools.length === FULL_CAPABILITY_TOOLS.length
      ? FULL_CAPABILITY_TOOLS
      : TRANSITIONAL_CAPABILITY_TOOLS;
  if (
    spec.tools.length !== expected.length ||
    !spec.tools.every((action, index) => action === expected[index])
  ) {
    throw new Error("Unit generation requires one complete admitted Action shape.");
  }
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return DEFAULT_UNIT_FIX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }
  return maxAttempts;
}

function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  return {
    inputTokens: sumOptional(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumOptional(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumOptional(usages.map((usage) => usage.totalTokens)),
  };
}

function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  let seen = false;
  let sum = 0;
  for (const value of values) {
    if (value !== undefined) {
      seen = true;
      sum += value;
    }
  }
  return seen ? sum : undefined;
}
