// Freezing behavioral intent — Module 4.7/01 (PLAN decision 23; ADR-0006).
//
// This stage runs *before* any Handler is generated or repaired. That ordering is the
// whole point: tests that exist before the first Handler byte cannot have been written to
// fit code, so the suite the Gate later executes is intent, not a description of whatever
// the model happened to produce. Repair answers to these tests; they never answer to it.
//
// Each Action is generated independently from its own closed input set
// (`behavioral-test-inputs.ts`), and the result is content-addressed to that input set. On
// a later build an Action whose total inputs are byte-identical carries its frozen cases
// forward untouched — a label rename or a field reorder changes no digest, so it
// regenerates nothing, while a new required field regenerates exactly `create`/`update`.
//
// Which frozen suites then *execute*, the impact-driven run/skip selection and its
// full-suite fallback, is 4.7/02 and deliberately not decided here.

import type { Provider, TokenUsage } from "../../../provider/index.ts";
import type { CapabilitySpec, CapabilityTool } from "../../../registry/index.ts";
import {
  type ActionTestInputs,
  actionFixtureVocabulary,
  actionTestInputDigest,
  isSearchSchemaInput,
  specActionTestInputs,
} from "./behavioral-test-inputs.ts";
import {
  assertActionSuiteContract,
  assertFrozenTestsContract,
} from "./gate-behavioral-full-contract.ts";
import { buildActionBehavioralTestPrompt } from "./gate-behavioral-full-prompt.ts";
import {
  actionBehavioralTestSuiteSchema,
  type FrozenActionTests,
  type FrozenBehavioralTests,
} from "./gate-behavioral-full-schema.ts";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * A behavioral suite that could not be authored or could not be admitted. Freezing now
 * happens before the Gate exists, so this is the typed error that keeps such a failure
 * attributable to the behavioral tier rather than to whichever stage happens to be next.
 */
export class BehavioralTestGenerationError extends Error {
  override readonly name = "BehavioralTestGenerationError";
  /** The Action whose suite failed; absent when the assembled artifact failed as a whole. */
  readonly action?: CapabilityTool;
  override readonly cause?: unknown;

  constructor(cause: unknown, action?: CapabilityTool) {
    const subject = action ? `for ${action}` : "for this capability";
    super(`Behavioral test generation failed ${subject}: ${errorMessage(cause)}`);
    if (action) this.action = action;
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the build story shows per Action: whether this build generated the Action's tests
 * or carried the prior frozen ones forward, the content address of the inputs that decided
 * it, and — the "from which inputs" half — the closed input set itself, named rather than
 * dumped.
 */
export interface BehavioralTestActionReport {
  readonly action: CapabilityTool;
  readonly status: "generated" | "carried";
  readonly inputDigest: string;
  readonly caseCount: number;
  readonly inputs: BehavioralTestInputSummary;
}

export interface BehavioralTestInputSummary {
  /** Free-text `behavior` is conservatively an input to every Action, so this is always true. */
  readonly behavior: true;
  /** The Action's canonical schema projection, by field name (empty for read/delete). */
  readonly schemaFields: readonly string[];
  readonly behavioralErrorCodes: readonly string[];
  /** Declared dependency identities as `capability_id/incarnation_id` — never schemas. */
  readonly dependencies: readonly string[];
}

export interface FreezeBehavioralTestsInput {
  readonly provider: Provider;
  readonly spec: CapabilitySpec;
  /**
   * The prior version's frozen tests, when the committed snapshot was tier-on. An Action
   * whose total inputs are unchanged carries its cases forward from here instead of
   * regenerating them; absent, every Action generates (a v1 build, or an off→on transition).
   */
  readonly priorFrozenTests?: FrozenBehavioralTests;
}

export interface FrozenBehavioralTestsResult {
  readonly frozenTests: FrozenBehavioralTests;
  readonly report: readonly BehavioralTestActionReport[];
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly testCount: number;
}

/**
 * Generate, validate, and freeze one capability version's behavioral intent. Throws before
 * returning if any Action's suite contradicts the platform response-shape contract — an
 * inadmissible suite is never frozen and never reaches Handler repair.
 */
export async function freezeBehavioralTests(
  input: FreezeBehavioralTestsInput,
): Promise<FrozenBehavioralTestsResult> {
  const startedAt = performance.now();
  const prior = new Map(
    (input.priorFrozenTests?.actions ?? []).map((entry) => [entry.action, entry]),
  );
  const actions: FrozenActionTests[] = [];
  const report: BehavioralTestActionReport[] = [];
  const usages: TokenUsage[] = [];

  for (const inputs of specActionTestInputs(input.spec)) {
    const digest = actionTestInputDigest(inputs);
    const carried = prior.get(inputs.action);
    try {
      if (
        carried &&
        carried.input_digest === digest &&
        carriedSuiteIsAdmissible(input.spec, inputs.action, carried)
      ) {
        // Unchanged total inputs. The prior cases carry forward verbatim — but they are
        // re-admitted against the candidate contract first, so a suite the platform would
        // no longer accept can never survive by being old.
        actions.push(carried);
        report.push(actionReport(inputs, digest, "carried", carried.cases.length));
        continue;
      }
      const generated = await generateActionTests(input.provider, input.spec, inputs, digest);
      usages.push(generated.usage);
      actions.push(generated.frozen);
      report.push(actionReport(inputs, digest, "generated", generated.frozen.cases.length));
    } catch (error) {
      throw new BehavioralTestGenerationError(error, inputs.action);
    }
  }

  const frozenTests: FrozenBehavioralTests = { actions };
  try {
    assertFrozenTestsContract(input.spec, frozenTests);
  } catch (error) {
    throw new BehavioralTestGenerationError(error);
  }
  return {
    frozenTests,
    report,
    durationMs: performance.now() - startedAt,
    usage: usages.reduce(addTokenUsage, ZERO_USAGE),
    testCount: actions.reduce((count, entry) => count + entry.cases.length, 0),
  };
}

/**
 * Candidate fixture mechanics can invalidate a byte-addressed suite without changing its
 * versioned equality inputs (for example, read rows name a newly inactive field). That is
 * a cache miss: regenerate from current scratch vocabulary instead of permanently failing
 * every retry from the same committed base.
 */
function carriedSuiteIsAdmissible(
  spec: CapabilitySpec,
  action: CapabilityTool,
  carried: FrozenActionTests,
): boolean {
  try {
    assertActionSuiteContract(spec, action, carried.cases);
    return true;
  } catch {
    return false;
  }
}

async function generateActionTests(
  provider: Provider,
  spec: CapabilitySpec,
  inputs: ActionTestInputs,
  digest: string,
): Promise<{ readonly frozen: FrozenActionTests; readonly usage: TokenUsage }> {
  const result = provider.generate(
    buildActionBehavioralTestPrompt(inputs, actionFixtureVocabulary(spec)),
    actionBehavioralTestSuiteSchema,
  );
  const suite = actionBehavioralTestSuiteSchema.parse(await result.object);
  assertActionSuiteContract(spec, inputs.action, suite.cases);
  return {
    frozen: { action: inputs.action, input_digest: digest, cases: suite.cases },
    usage: await result.usage,
  };
}

function actionReport(
  inputs: ActionTestInputs,
  digest: string,
  status: BehavioralTestActionReport["status"],
  caseCount: number,
): BehavioralTestActionReport {
  return {
    action: inputs.action,
    status,
    inputDigest: digest,
    caseCount,
    inputs: {
      behavior: true,
      schemaFields: schemaFieldNames(inputs),
      behavioralErrorCodes: inputs.behavioral_errors.map((errorCase) => errorCase.code),
      dependencies: inputs.read_dependencies.map(
        (dependency) => `${dependency.capability_id}/${dependency.incarnation_id}`,
      ),
    },
  };
}

function schemaFieldNames(inputs: ActionTestInputs): readonly string[] {
  if (isSearchSchemaInput(inputs.schema)) {
    return inputs.schema.searchable_fields.map((field) => field.name);
  }
  return inputs.schema.map((field) => field.name);
}

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: addOptional(left.inputTokens, right.inputTokens),
    outputTokens: addOptional(left.outputTokens, right.outputTokens),
    totalTokens: addOptional(left.totalTokens, right.totalTokens),
  };
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}
