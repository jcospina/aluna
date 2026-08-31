// The design-lint rung: the Gate's last, always-on verdict. It renders the generated item
// renderer with **synthetic and hostile** field values, within the capability's declared
// collection layout, and rejects anything outside the closed-value design contract —
// off-token styling on the three closed axes (colour/type size/spacing), the four
// never-declared properties (font family, `border`, `border-radius`, `box-shadow`),
// forbidden style constructs (`url(...)`, item-escaping position), field
// values interpolated into `style`, fabricated classes, executable markup, and unsafe field
// interpolation. The axes and the bans are High Meadow's, re-derived in epic 5.1 against
// `design/styles/` — the token *names* come from `presentation/design-tokens.ts`, so this
// rung restates neither a name nor a value.
//
// Detection reuses the *render-time* enforcer as the *build-time* rejecter: the
// presentation adapter neutralizes off-contract markup on every rendered record, so a
// renderer whose output the enforcer has to change emitted something off-contract. This
// rung renders each probe record's inner markup and asks whether `enforceItemMarkup` left
// it byte-identical; when it didn't, the difference *is* the violation. Two build-time scans
// run ahead of that diff so the refusal reads in the contract's own words rather than as a
// before/after diff: the inline-style scan names the first off-contract declaration and the
// set it should have picked from, and closes the one enforcer residual — a *named* CSS colour
// inside a mixed shorthand (`background: white`), inert at render time but still off-token.
// Controlled benign contrasts also prove every declared item field affects perceivable
// composition, which AST access alone cannot.
//
// On a violation the item renderer re-enters the *same* bounded fix loop as the type-check
// rung: regenerate with the precise failure fed back, re-validate the fresh unit's
// shape/type, then re-render and re-detect. The loop is capped by `DEFAULT_UNIT_FIX_ATTEMPTS`.
// On exhaustion it throws; the Gate wraps that into a fail-closed `CapabilityGateError`, so
// the build rolls back with no version bump and no pointer flip.

import {
  createPlatformPresentationAdapter,
  enforceItemMarkup,
  PALETTE_COLOR_TOKENS,
  type PresentableRecord,
  type RenderableCapability,
  renderCollection,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "../../../presentation/index.ts";
import { isProviderAbortError, type Provider, type TokenUsage } from "../../../provider/index.ts";
import {
  type CapabilitySpec,
  choiceFieldOptions,
  type SpecField,
} from "../../../registry/index.ts";
import { checkGeneratedUnit } from "../../units/unit-checks.ts";
import {
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateUnitContent,
  ITEM_RENDERER_UNIT_NAME,
  type UnitDescriptor,
  type UnitGenerationFailure,
  UnitGenerationPassError,
} from "../../units/units.ts";
import type { CapabilityGateInput, DesignLintAttempt, DesignLintGateResult } from "../gate.ts";
import { normalizeGateAttempts } from "../gate-attempts.ts";
import { errorMessage, loadItemRenderer } from "../gate-internal.ts";
import { sumTokenUsages, TokenUsageAccumulator } from "../gate-token-usage.ts";
import { observableItemRecordContent } from "./gate-item-content.ts";
import { findInlineStyleViolation } from "./inline-style-scan.ts";

/** The affected unit the rung regenerates on a violation — the one creative surface. */
const ITEM_RENDERER_UNIT: UnitDescriptor = {
  kind: "item-renderer",
  name: ITEM_RENDERER_UNIT_NAME,
};

/** The structured detail a failed design-lint rung carries into the gate's diagnostic. */
export interface DesignLintDiagnostic {
  readonly attempts: readonly DesignLintAttempt[];
  readonly violation: string;
}

/** Thrown when the bounded fix loop exhausts without a clean item renderer. The gate turns
 *  it into a fail-closed {@link CapabilityGateError}; `diagnostic` rides into the preview. */
export class DesignLintRungError extends Error {
  override readonly name = "DesignLintRungError";
  readonly diagnostic: DesignLintDiagnostic;
  readonly measurement: { readonly usage: TokenUsage };

  constructor(diagnostic: DesignLintDiagnostic) {
    super(
      `Design-lint rung rejected the item renderer after ${diagnostic.attempts.length} attempt(s): ${diagnostic.violation}`,
    );
    this.diagnostic = diagnostic;
    this.measurement = {
      usage: sumTokenUsages(
        diagnostic.attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])),
      ),
    };
  }
}

/**
 * Run the design-lint rung: render the item renderer against synthetic + hostile probes
 * within the declared collection layout and reject off-contract composition, regenerating
 * the renderer through the bounded fix loop on a violation. Returns the final (clean, or
 * fixed) item renderer; throws {@link DesignLintRungError} on exhaustion.
 */
export async function runDesignLintRung(input: CapabilityGateInput): Promise<DesignLintGateResult> {
  const knob = normalizeGateAttempts(
    input.designLint?.maxAttempts,
    DEFAULT_UNIT_FIX_ATTEMPTS,
    "design-lint",
  );
  const provider = input.provider;
  // Without a provider the rung can only detect once — it cannot regenerate to fix. In the
  // production pipeline a provider is always supplied; the no-provider path is the baseline
  // gate run, where a clean renderer passes on the first look and a dirty one fails closed.
  const maxAttempts = provider ? knob : 1;

  const attempts: DesignLintAttempt[] = [];
  const usages = new TokenUsageAccumulator();
  let candidate = input.itemRenderer;
  let previousFailure: UnitGenerationFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    // Attempt 1 reviews the renderer the gate was handed (already structural- and smoke-
    // clean). Later attempts regenerate it with the prior failure fed back — the same write
    // step the type-check loop runs — then re-validate the fresh unit's shape/type
    // (structural's job, re-applied) before the design review.
    const step = await designStep({
      attempt,
      candidate,
      provider,
      spec: input.spec,
      previousFailure,
      attempts,
      usages,
    });
    candidate = step.content;
    if (step.usage) usages.add(step.usage);

    const failure = step.failure ?? findDesignViolation(input.spec, candidate);
    attempts.push(makeAttempt(attempt, startedAt, failure, step.usage));
    if (!failure) {
      return {
        status: "passed",
        itemRenderer: candidate,
        fixed: attempt > 1,
        attempts,
        usage: usages.total(),
      };
    }
    previousFailure = { ...ITEM_RENDERER_UNIT, message: failure };
  }

  throw new DesignLintRungError({
    attempts,
    violation: previousFailure?.message ?? "unknown design violation",
  });
}

interface DesignStepInput {
  readonly attempt: number;
  readonly candidate: string;
  readonly provider: Provider | undefined;
  readonly spec: CapabilitySpec;
  readonly previousFailure: UnitGenerationFailure | undefined;
  readonly attempts: DesignLintAttempt[];
  readonly usages: TokenUsageAccumulator;
}

async function designStep(
  input: DesignStepInput,
): Promise<{ content: string; usage?: TokenUsage; failure?: string }> {
  if (input.attempt === 1) return { content: input.candidate };
  // `maxAttempts` is 1 without a provider, so a later attempt implies one. A platform bug
  // that broke that invariant used to fabricate a failure string and feed it to the fix
  // loop as if the provider had answered.
  if (!input.provider) throw new Error("A design-lint fix attempt was scheduled with no provider.");
  try {
    return await regenerateItemRenderer(input.provider, input.spec, input.previousFailure);
  } catch (error) {
    throw asDesignStepFailure(error, input);
  }
}

/** Turn a regeneration pass failure into the rung's own error, recording the attempt. A
 *  provider abort and anything that is not a pass failure travel on untouched. */
function asDesignStepFailure(error: unknown, input: DesignStepInput): unknown {
  if (isProviderAbortError(error)) return error;
  if (!(error instanceof UnitGenerationPassError)) return error;
  if (error.usage) input.usages.add(error.usage);
  input.attempts.push({
    attempt: input.attempt,
    durationMs: error.durationMs,
    ...(error.usage ? { usage: error.usage } : {}),
    error: error.message,
  });
  return new DesignLintRungError({ attempts: input.attempts, violation: error.message });
}

/** One regeneration step of the bounded fix loop: regenerate the item renderer through the
 *  shared write step with the prior failure fed back, then re-validate the fresh unit's
 *  shape/type. A structural failure comes back as `failure` so it feeds the next attempt
 *  exactly as a design violation does. */
async function regenerateItemRenderer(
  provider: Provider,
  spec: CapabilitySpec,
  previousFailure: UnitGenerationFailure | undefined,
): Promise<{ content: string; usage?: TokenUsage; failure?: string }> {
  const pass = await generateUnitContent(provider, spec, ITEM_RENDERER_UNIT, previousFailure);
  const structural = checkGeneratedUnit(spec, ITEM_RENDERER_UNIT, pass.content);
  return {
    content: pass.content,
    usage: pass.usage,
    ...(structural ? { failure: structural.message } : {}),
  };
}

function makeAttempt(
  attempt: number,
  startedAt: number,
  error: string | undefined,
  usage: TokenUsage | undefined,
): DesignLintAttempt {
  return {
    attempt,
    durationMs: performance.now() - startedAt,
    ...(usage ? { usage } : {}),
    ...(error ? { error } : {}),
  };
}

/**
 * Detect a design-contract violation in the item renderer by rendering it against the probe
 * records within the declared collection layout. Returns a precise, actionable message (fed
 * straight into the fix loop) or `undefined` when every probe renders clean. A renderer that
 * throws mid-render is itself a violation — a live view must never crash.
 */
export function findDesignViolation(
  spec: CapabilitySpec,
  itemRenderer: string,
): string | undefined {
  let renderItem: (record: PresentableRecord) => string;
  try {
    renderItem = loadItemRenderer(itemRenderer);
  } catch (error) {
    return `The item renderer could not be loaded for design review: ${errorMessage(error)}`;
  }

  const capability: RenderableCapability = {
    id: spec.id,
    label: spec.label,
    noun: spec.noun,
    schema: spec.schema,
    form: spec.ui_intent.form,
    actions: spec.tools,
  };
  const records = buildProbeRecords(spec);
  const rendered: { readonly probe: DesignProbe; readonly inner: string }[] = [];

  for (const probe of records) {
    const outcome = reviewProbe(probe, renderItem);
    if (outcome.violation) return outcome.violation;
    rendered.push({ probe, inner: outcome.inner });
  }

  const contentViolation = findRecordContentViolation(spec, rendered);
  if (contentViolation) return contentViolation;

  // Run the clean composition through the real adapter path — record → enforced inner →
  // accessible wrapper → detail template — arranged in the declared container. Asserting
  // the container's own class back would be a tautology: `renderCollection` writes it
  // unconditionally and the item renderer cannot affect it. What a renderer *can* do here
  // is throw, which used to escape the rung as a crash instead of a refusal.
  const present = createPlatformPresentationAdapter({ capability, renderItem });
  const layout = spec.ui_intent.collection.layout;
  try {
    renderCollection({
      capability,
      layout,
      items: records.map((probe) => present(probe.record)).join(""),
    });
  } catch (error) {
    return `The item renderer threw while composing into the "${layout}" collection: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

/**
 * Review one probe's rendered markup. The declaration-level scans run first: they can name
 * the axis or the ban a declaration broke, where the enforcer diff can only show a before
 * and an after. Both read the *raw* attribute text, so an entity-encoded value slips past
 * them — the enforcer diff is the backstop, because the parser decodes before
 * `sanitizeStyle` sees the value.
 */
function reviewProbe(
  probe: DesignProbe,
  renderItem: (record: PresentableRecord) => string,
): { readonly inner: string; readonly violation?: string } {
  let inner: string;
  try {
    inner = renderItem(probe.record);
  } catch (error) {
    return {
      inner: "",
      violation: offContractMessage(
        `the renderer threw when composing a ${probe.label} record: ${errorMessage(error)}`,
        probe,
      ),
    };
  }

  const style = findInlineStyleViolation(inner);
  if (style) {
    const detail =
      style.kind === "declaration"
        ? `the inline style is off-contract: ${style.detail}`
        : `the inline style uses the raw colour "${style.colour}". Colour is picked from the High Meadow palette and never written as a value — name one of ${tokenList(PALETTE_COLOR_TOKENS)} (or transparent/currentcolor), never a named colour, hex, or colour function.`;
    return {
      inner,
      violation: offContractMessage(`for a ${probe.label} record ${detail}`, probe),
    };
  }

  const enforced = enforceItemMarkup(inner);
  if (enforced !== inner) {
    return {
      inner,
      violation: offContractMessage(
        `for a ${probe.label} record the platform enforcer had to neutralize the output, so the composition is off-contract.\nYour output:       ${clip(inner)}\nAfter enforcement: ${clip(enforced)}`,
        probe,
      ),
    };
  }

  return { inner };
}

/** One probe fed through the renderer: a synthetic or hostile record and a human label. */
interface DesignProbe {
  readonly label: string;
  readonly record: PresentableRecord;
  readonly kind: "baseline" | "contrast" | "hostile";
  /** Set on a contrast probe: the one `item.shows` field this record varies. */
  readonly contrastFor?: string;
}

/**
 * Build the probe records the rung renders: one benign **synthetic** baseline plus one
 * benign contrast per declared item field. Each contrast changes only that field, proving
 * every `item.shows` value affects perceivable composition without prescribing its format.
 * Undeclared platform fields stay identical. These probes also catch hard-coded off-token
 * styling and fabricated classes. A **hostile** record per injection family stuffs every
 * user field with a payload
 * that probes a different interpolation context (HTML text, attribute breakout, event
 * handler, `style` injection, URL scheme, class smuggling). A correct renderer escapes every
 * value, so all probes render clean; an unsafe one lets a payload through, which the enforcer
 * then neutralizes — the difference the rung rejects on.
 */
function buildProbeRecords(spec: CapabilitySpec): readonly DesignProbe[] {
  const probes: DesignProbe[] = [
    {
      label: "synthetic",
      kind: "baseline",
      record: recordWith(spec, (field) => syntheticValue(field)),
    },
    ...spec.ui_intent.item.shows.map((fieldName) => ({
      label: `synthetic contrast for ${fieldName}`,
      kind: "contrast" as const,
      record: contrastingRecord(spec, fieldName),
      contrastFor: fieldName,
    })),
  ];
  for (const [index, payload] of HOSTILE_FIELD_VALUES.entries()) {
    probes.push({
      label: `hostile #${index + 1}`,
      kind: "hostile",
      record: recordWith(spec, (field) => (field.type === "string[]" ? [payload] : payload)),
    });
  }
  return probes;
}

function contrastingRecord(spec: CapabilitySpec, fieldName: string): PresentableRecord {
  const baseline = recordWith(spec, (field) => syntheticValue(field));
  if (fieldName === "created_at") {
    return { ...baseline, created_at: "2031-06-15T09:30:00.000Z" };
  }
  const field = spec.schema.fields.find((candidate) => candidate.name === fieldName);
  return field ? { ...baseline, [fieldName]: contrastingValue(field) } : baseline;
}

/** Assemble a data-tool-shaped record — the platform trio plus every spec field valued by
 *  `valueFor`. `id`/`created_at` stay benign (platform-controlled, never user-hostile). */
function recordWith(
  spec: CapabilitySpec,
  valueFor: (field: SpecField) => unknown,
): PresentableRecord {
  const record: Record<string, unknown> = {
    id: "design-lint-probe",
    created_at: "2026-01-01T00:00:00.000Z",
    extra: {},
  };
  for (const field of spec.schema.fields) {
    record[field.name] = valueFor(field);
  }
  return record;
}

/** A benign, typed value for the synthetic probe — mirrors the smoke rung's sample shapes. */
function syntheticValue(field: SpecField): string | number | boolean | readonly string[] {
  switch (field.type) {
    case "string":
      return `Sample ${field.name}`;
    case "number":
      return 42;
    case "boolean":
      return true;
    case "datetime":
      return "2026-01-01T12:00:00.000Z";
    case "date":
      return "2026-01-01";
    case "choice":
      return firstChoiceValue(field);
    case "string[]":
      return [`Sample ${field.name} first`, `Sample ${field.name} second`];
  }
}

/** The probe's value for a choice: a declared option, since nothing else is renderable. */
function firstChoiceValue(field: SpecField): string {
  const first = choiceFieldOptions(field)[0];
  if (!first) throw new Error(`Choice field "${field.name}" declares no options.`);
  return first.value;
}

/** The contrasting probe's value: a *different* declared option where the field has one. */
function contrastingChoiceValue(field: SpecField): string {
  const options = choiceFieldOptions(field);
  const contrasting = options[1] ?? options[0];
  if (!contrasting) throw new Error(`Choice field "${field.name}" declares no options.`);
  return contrasting.value;
}

/** A second benign value with the same runtime type but different semantic content. The
 * pair proves composition depends on record data without prescribing wording or format. */
function contrastingValue(field: SpecField): string | number | boolean | readonly string[] {
  switch (field.type) {
    case "string":
      return `Different ${field.name}`;
    case "number":
      return 84;
    case "boolean":
      return false;
    case "datetime":
      return "2031-06-15T09:30:00.000Z";
    case "date":
      return "2031-06-15";
    case "choice":
      return contrastingChoiceValue(field);
    case "string[]":
      return [`Different ${field.name} first`, `Different ${field.name} second`];
  }
}

function findRecordContentViolation(
  spec: CapabilitySpec,
  rendered: readonly { readonly probe: DesignProbe; readonly inner: string }[],
): string | undefined {
  // Selected by what each probe *is*, not by where it sits. Slicing by index made the
  // probe ordering in `buildProbeRecords` an unwritten contract: reordering it would have
  // silently compared the wrong records and blamed the wrong field.
  const baseline = rendered.find(({ probe }) => probe.kind === "baseline");
  const contrasts = rendered.filter(({ probe }) => probe.kind === "contrast");
  if (!baseline || contrasts.length !== spec.ui_intent.item.shows.length) {
    return "The design-lint record-dependency probes could not be assembled.";
  }
  const baselineContent = observableItemRecordContent(baseline.inner);
  if (baselineContent.length === 0) {
    return offContractMessage(
      "the item renderer did not produce meaningful, record-dependent content for each benign record. Empty containers and presentation-only styling do not tell the user what the record contains.",
      baseline.probe,
    );
  }
  for (const contrast of contrasts) {
    const contrastContent = observableItemRecordContent(contrast.inner);
    const fieldName = contrast.probe.contrastFor ?? "unknown";
    if (contrastContent.length === 0 || baselineContent === contrastContent) {
      return offContractMessage(
        `the item renderer did not produce meaningful, record-dependent content for declared item field "${fieldName}": changing only that field did not change the perceivable text or media content.`,
        contrast.probe,
      );
    }
  }
  return undefined;
}

/**
 * Hostile field values, one per injection family. Each is placed into *every* user field of
 * a probe record, so wherever the renderer interpolates a field — text node, attribute
 * value, `style` — the payload is present to break out if the renderer failed to escape it.
 * A renderer that escapes correctly renders each as inert text.
 *
 * These probe what the *renderer* controls: escaping (so a field can't become markup),
 * allow-listed structure, and on-token style. They deliberately carry **no** dangerous URL
 * scheme (`javascript:` / `vbscript:` / `data:`): a field flowing into an allow-listed URL
 * attribute (`<img src>`) is the intended media pattern, and sanitizing a hostile URL
 * *value* there per record is the runtime enforcer's job, not a renderer contract
 * violation — injecting one would wrongly reject a legitimate media renderer. A renderer
 * that *hard-codes* a dangerous URL is still caught, by the synthetic probe.
 */
const HOSTILE_FIELD_VALUES: readonly string[] = [
  // Script/handler tag injection into a text or attribute context — must be escaped to text.
  '<script>alert(1)</script><img src=x onerror="alert(1)">',
  // Attribute breakout that smuggles an event handler and a fabricated class.
  '"><span class="fabricated-danger" onclick="alert(1)">x</span>',
  // Style-attribute injection: off-token color, item-escaping position, and a url.
  'red; position: fixed; background-image: url("https://evil.example/x.png")',
  // Interactive-element injection via tag breakout — links/buttons/inputs the platform owns.
  '</p><a>tap</a><button type="button">go</button><input value="x">',
  // Quote/markup soup probing single- and double-quoted attribute contexts + a raw hex color.
  '\'"><iframe title="x"></iframe><b style="color: #ff0000">bad</b>',
];

// ── Small helpers ──────────────────────────────────────────────────────────────────────

const MAX_MARKUP_IN_MESSAGE = 400;

/** Clip a rendered fragment so a fix-loop message stays readable, not a wall of markup. */
function clip(markup: string): string {
  const collapsed = markup.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_MARKUP_IN_MESSAGE
    ? `${collapsed.slice(0, MAX_MARKUP_IN_MESSAGE)}…`
    : collapsed;
}

/** The precise, actionable failure the fix loop feeds back to the model. */
function offContractMessage(detail: string, probe: DesignProbe): string {
  return [
    `Design contract violation: ${detail}`,
    `Field values used: ${clip(JSON.stringify(probe.record))}`,
    "",
    "Return a corrected item renderer whose output survives the platform enforcer unchanged:",
    "- Make every field declared by `ui_intent.item.shows` affect perceivable text, media, or accessible content; empty containers and styling-only differences are not record composition.",
    "- Escape every record value before placing it in markup; never interpolate a field into a `style` attribute (styles must be literal).",
    "- Use only the allow-listed primitive classes — no fabricated class names.",
    `- Inline \`style\` may set the three closed axes only by naming a High Meadow token: colour ${tokenList(PALETTE_COLOR_TOKENS)}; type size ${tokenList(TYPE_SIZE_TOKENS)}; spacing ${tokenList(SPACING_TOKENS)}. No raw colours (named, hex, or colour functions), no raw sizes, no \`url(...)\`, no \`position: fixed|absolute|sticky\`.`,
    "- Never declare `font-family`, `border`, `border-radius`, or a shadow of any kind (`box-shadow`, `text-shadow`, `drop-shadow(...)`). An item inherits the face of the surface it sits on; every boundary on this surface is drawn by hand by the platform, so a CSS edge — `border`, `outline` or `column-rule` — would sit beside the drawn one; every corner is mitred, so a square corner is the absence of a declaration; and nothing inside a window casts, so a shadow would be an invalid value that fails silently. `all` is out too — it resets that inheritance.",
    "- `--ink`, `--ink-2` and `--ink-3` draw lines and set type; they are never a background or a fill. A filled block names one of the five surfaces or one of the eight tints.",
    "- Nothing may take the record out of its own bounds: no `transform` (or its longhands), `translate`, `rotate`, `scale`, `zoom`, `perspective` or `offset`, and no rounded basic shape (`clip-path: inset(... round ...)`).",
    "- There is no thickness token, so a property whose value is a line weight has no value it may take: no `text-decoration-thickness`, `text-underline-offset` or `text-stroke-width`, and the `text-decoration`/`text-emphasis` shorthands may name only a line and a style.",
    "- Do not define a custom property inline (`--name: …`).",
    "- Emit no `<script>`, event handlers (`on*=`), links, buttons, inputs, or other interactive/unknown elements — the platform owns the wrapper, payload, and click-to-open.",
  ].join("\n");
}
