// Unit generation — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder" step 3,
// ADR-0003 bounded tool-loop, ADR-0004 generated artifact contract).
//
// This stage derives the four M2 artifacts from the validated capability spec:
// `create` + `read` handlers and `list` + `create` views. Generation is agentic
// only inside one unit at a time: write -> check -> feed back the failure -> fix,
// capped by a small config knob. Across units the order and scope are fixed.
//
// This file owns the public contract and the orchestration; the per-unit prompts
// live in `unit-prompts.ts` and the static checks in `unit-checks.ts`.

import { z } from "zod";
import type { DeepPartial, Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec, CapabilityTool } from "../registry/index.ts";

import { checkGeneratedUnit } from "./unit-checks.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

export const DEFAULT_UNIT_FIX_ATTEMPTS = 2;

const HANDLER_UNITS = ["create", "read"] as const satisfies readonly CapabilityTool[];
const VIEW_UNITS = ["list", "create"] as const;
const generatedUnitSchema = z.strictObject({ content: z.string().min(1) });
type GeneratedUnitObject = z.infer<typeof generatedUnitSchema>;

export type HandlerUnitName = (typeof HANDLER_UNITS)[number];
export type ViewUnitName = (typeof VIEW_UNITS)[number];

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
      readonly kind: "view";
      readonly name: ViewUnitName;
      readonly filename: `${ViewUnitName}.html`;
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
  // Config knob from PLAN decision 5. Defaults to two attempts: the initial write
  // plus one fix pass.
  readonly maxAttempts?: number;
  readonly observer?: UnitGenerationObserver;
}

export interface GenerateCapabilityUnitsResult {
  readonly units: readonly GeneratedUnit[];
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  readonly views: Readonly<Record<ViewUnitName, string>>;
}

export type UnitDescriptor =
  | { readonly kind: "handler"; readonly name: HandlerUnitName }
  | { readonly kind: "view"; readonly name: ViewUnitName };

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
 * Generate all four temporary M2 units for `spec`, in fixed order (handlers then
 * views), each through its bounded write→check→fix loop. Module 3.3 reshaped
 * `ui_intent`, so the views are no longer model-authored spec state; they remain
 * generated unconditionally until the later M3 artifact recut replaces them with
 * the single item renderer. Returns the generated units plus the handler/view
 * content maps the gate and commit consume. Throws
 * {@link UnitGenerationError} if any unit never passes its checks.
 */
export async function generateCapabilityUnits(
  input: GenerateCapabilityUnitsInput,
): Promise<GenerateCapabilityUnitsResult> {
  assertM2UnitSpec(input.spec);
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const units: GeneratedUnit[] = [];

  for (const action of HANDLER_UNITS) {
    units.push(
      await generateUnit(
        input.provider,
        input.spec,
        { kind: "handler", name: action },
        maxAttempts,
        input.observer,
      ),
    );
  }

  for (const view of VIEW_UNITS) {
    units.push(
      await generateUnit(
        input.provider,
        input.spec,
        { kind: "view", name: view },
        maxAttempts,
        input.observer,
      ),
    );
  }

  return {
    units,
    handlers: {
      create: contentFor(units, "handler", "create"),
      read: contentFor(units, "handler", "read"),
    },
    views: {
      list: contentFor(units, "view", "list"),
      create: contentFor(units, "view", "create"),
    },
  };
}

async function generateUnit(
  provider: Provider,
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  maxAttempts: number,
  observer: UnitGenerationObserver | undefined,
): Promise<GeneratedUnit> {
  const attempts: UnitGenerationAttempt[] = [];
  let previousFailure: UnitGenerationFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await observer?.onUnitStart?.({ unit, attempt });
    const startedAt = performance.now();
    const result = provider.generate(
      buildUnitPrompt(spec, unit, previousFailure),
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
    const name = unit.name as HandlerUnitName;
    return {
      kind: "handler",
      name,
      filename: `${name}.ts`,
      ...base,
    };
  }

  const name = unit.name as ViewUnitName;
  return {
    kind: "view",
    name,
    filename: `${name}.html`,
    ...base,
  };
}

function contentFor(
  units: readonly GeneratedUnit[],
  kind: "handler",
  name: HandlerUnitName,
): string;
function contentFor(units: readonly GeneratedUnit[], kind: "view", name: ViewUnitName): string;
function contentFor(
  units: readonly GeneratedUnit[],
  kind: GeneratedUnit["kind"],
  name: HandlerUnitName | ViewUnitName,
): string {
  const unit = units.find((candidate) => candidate.kind === kind && candidate.name === name);
  if (!unit) throw new Error(`missing generated ${kind} ${name}`);
  return unit.content;
}

function assertM2UnitSpec(spec: CapabilitySpec): void {
  for (const action of HANDLER_UNITS) {
    if (!(spec.tools as readonly string[]).includes(action)) {
      throw new Error(`M2 unit generation requires the "${action}" handler in spec.tools.`);
    }
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
