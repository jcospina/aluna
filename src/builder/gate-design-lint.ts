// The design-lint rung — Module 3, Epic 3.6 (ADR-0005 §4 as amended 2026-07-01,
// PLAN decision 6 & flow step 5, ARCH §6.2 gate, docs/modules.md §3.6).
//
// The gate's last, always-on verdict: it renders the generated item renderer with
// **synthetic and hostile** field values, *within the capability's declared collection
// layout*, and rejects anything outside the closed-value design contract — off-token
// styling on the token-owned axes (color/font/type/spacing/border), forbidden style
// constructs (`url(...)`, item-escaping position), field values interpolated into
// `style`, fabricated/unknown classes, executable markup, and unsafe field interpolation.
//
// Detection reuses the *render-time* enforcer (epic 3.1/02) as the *build-time* rejecter:
// the presentation adapter neutralizes off-contract markup on every rendered record, so a
// renderer whose output the enforcer has to change emitted something off-contract. This
// rung renders each probe record's inner markup and asks whether `enforceItemMarkup` left
// it byte-identical; when it didn't, the difference *is* the violation. On top of that it
// closes the one documented enforcer residual — a *named* CSS color inside a mixed
// shorthand (`background: white`), which is inert at render time but still off-token — with
// a build-time raw-color scan (3.1/02 "caught at build time by the design-lint gate rung").
//
// On a violation the affected unit — the item renderer — re-enters the *same* bounded fix
// loop as the type-check rung: regenerate it with the precise failure fed back
// (`generateUnitContent`, the shared write step), re-validate the fresh unit's shape/type
// (`checkGeneratedUnit`, the structural rung's job re-applied — a regenerated renderer
// never saw structural), then re-render and re-detect. The loop is capped by the existing
// `DEFAULT_UNIT_FIX_ATTEMPTS` knob (default 2; reused, not new). On exhaustion it throws;
// the gate wraps that into a fail-closed `CapabilityGateError`, so the build rolls back
// with no version bump and no pointer flip. A clean pass — or a fix — returns the final
// item renderer, which the pipeline commits in place of the original.

import {
  collectionLayoutClass,
  createPresentationAdapter,
  enforceItemMarkup,
  type PresentableRecord,
  type RenderableCapability,
  renderCollection,
} from "../presentation/index.ts";
import type { Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec, SpecField } from "../registry/index.ts";
import type { CapabilityGateInput, DesignLintAttempt, DesignLintGateResult } from "./gate.ts";
import { errorMessage, loadItemRenderer } from "./gate-internal.ts";
import { checkGeneratedUnit } from "./unit-checks.ts";
import {
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateUnitContent,
  ITEM_RENDERER_UNIT_NAME,
  type UnitDescriptor,
  type UnitGenerationFailure,
} from "./units.ts";

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

  constructor(diagnostic: DesignLintDiagnostic) {
    super(
      `Design-lint rung rejected the item renderer after ${diagnostic.attempts.length} attempt(s): ${diagnostic.violation}`,
    );
    this.diagnostic = diagnostic;
  }
}

/**
 * Run the design-lint rung: render the item renderer against synthetic + hostile probes
 * within the declared collection layout and reject off-contract composition, regenerating
 * the renderer through the bounded fix loop on a violation. Returns the final (clean, or
 * fixed) item renderer; throws {@link DesignLintRungError} on exhaustion.
 */
export async function runDesignLintRung(input: CapabilityGateInput): Promise<DesignLintGateResult> {
  const knob = normalizeMaxAttempts(input.designLint?.maxAttempts);
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
    const step =
      attempt === 1
        ? { content: candidate }
        : await regenerateItemRenderer(provider, input.spec, previousFailure);
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

/** One regeneration step of the bounded fix loop: regenerate the item renderer through the
 *  shared write step with the prior failure fed back, then re-validate the fresh unit's
 *  shape/type. A structural failure comes back as `failure` so it feeds the next attempt
 *  exactly as a design violation does. Reached only when a provider is present. */
async function regenerateItemRenderer(
  provider: Provider | undefined,
  spec: CapabilitySpec,
  previousFailure: UnitGenerationFailure | undefined,
): Promise<{ content: string; usage?: TokenUsage; failure?: string }> {
  if (!provider)
    return { content: "", failure: "No provider is available to fix the item renderer." };
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
    schema: spec.schema,
    detail: spec.ui_intent.detail,
  };
  const records = buildProbeRecords(spec);

  for (const probe of records) {
    let inner: string;
    try {
      inner = renderItem(probe.record);
    } catch (error) {
      return offContractMessage(
        `the renderer threw when composing a ${probe.label} record: ${errorMessage(error)}`,
        probe,
      );
    }

    const enforced = enforceItemMarkup(inner);
    if (enforced !== inner) {
      return offContractMessage(
        `for a ${probe.label} record the platform enforcer had to neutralize the output, so the composition is off-contract.\nYour output:       ${clip(inner)}\nAfter enforcement: ${clip(enforced)}`,
        probe,
      );
    }

    const rawColor = findRawColorInStyle(inner);
    if (rawColor) {
      return offContractMessage(
        `for a ${probe.label} record the inline style uses the raw color "${rawColor}". Colors on the token-owned axis must be \`var(--color-*)\` (or transparent/currentcolor) — never a named color, hex, or color function.`,
        probe,
      );
    }
  }

  // Prove the clean composition renders within the *declared* collection layout — the real
  // adapter path (record → enforced inner → accessible wrapper → detail template) arranged
  // in the container class the layout maps to. A platform bug here surfaces loudly rather
  // than shipping a renderer that only ever ran outside its container.
  const present = createPresentationAdapter({ capability, renderItem });
  const layout = spec.ui_intent.collection.layout;
  const collection = renderCollection({
    capability,
    layout,
    items: records.map((probe) => present(probe.record)).join(""),
  });
  if (!collection.includes(collectionLayoutClass(layout))) {
    return `The item renderer did not compose within the declared "${layout}" collection layout.`;
  }

  return undefined;
}

/** One probe fed through the renderer: a synthetic or hostile record and a human label. */
interface DesignProbe {
  readonly label: string;
  readonly record: PresentableRecord;
}

/**
 * Build the probe records the rung renders: one benign **synthetic** record (which catches
 * hard-coded off-token styling and fabricated classes — no interpolation needed) plus a
 * **hostile** record per injection family, each stuffing every user field with a payload
 * that probes a different interpolation context (HTML text, attribute breakout, event
 * handler, `style` injection, URL scheme, class smuggling). A correct renderer escapes every
 * value, so all probes render clean; an unsafe one lets a payload through, which the enforcer
 * then neutralizes — the difference the rung rejects on.
 */
function buildProbeRecords(spec: CapabilitySpec): readonly DesignProbe[] {
  const probes: DesignProbe[] = [
    { label: "synthetic", record: recordWith(spec, (field) => syntheticValue(field)) },
  ];
  for (const [index, payload] of HOSTILE_FIELD_VALUES.entries()) {
    probes.push({
      label: `hostile #${index + 1}`,
      record: recordWith(spec, (field) => (field.type === "string[]" ? [payload] : payload)),
    });
  }
  return probes;
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
    case "string[]":
      return [`Sample ${field.name} first`, `Sample ${field.name} second`];
  }
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
 * *value* there per record is the runtime enforcer's job (3.1/02), not a renderer contract
 * violation — injecting one would wrongly reject a legitimate media renderer. A renderer
 * that *hard-codes* a dangerous URL is still caught, by the synthetic probe.
 */
const HOSTILE_FIELD_VALUES: readonly string[] = [
  // Script/handler tag injection into a text or attribute context — must be escaped to text.
  '<script>alert(1)</script><img src=x onerror="alert(1)">',
  // Attribute breakout that smuggles an event handler and a fabricated class.
  '"><span class="fabricated-danger" onclick="alert(1)">x</span>',
  // Style-attribute injection: off-token color, item-escaping position, and a url().
  'red; position: fixed; background-image: url("https://evil.example/x.png")',
  // Interactive-element injection via tag breakout — links/buttons/inputs the platform owns.
  '</p><a>tap</a><button type="button">go</button><input value="x">',
  // Quote/markup soup probing single- and double-quoted attribute contexts + a raw hex color.
  '\'"><iframe title="x"></iframe><b style="color: #ff0000">bad</b>',
];

// ── Raw-color residual scan ────────────────────────────────────────────────────────────
// The render-time enforcer drops raw hex and color-function values everywhere and rejects
// named colors on the strict color-only properties, but a *named* color inside a mixed
// shorthand (`background: white`, a named-color gradient/shadow) is inert yet still passes
// it — the one documented residual 3.1/02 hands to this build-time rung. This scan closes
// it: any CSS named color appearing as a standalone token in a `style` value is off-token.

const STYLE_ATTR_PATTERN = /style\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** The standard CSS named colors. `transparent`/`currentcolor` are token-safe keywords and
 *  are deliberately absent, so they are never flagged. */
const NAMED_CSS_COLORS: readonly string[] = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

// A named color as a whole CSS token: not preceded or followed by a word char or hyphen, so
// `var(--color-tan)` (preceded by `-`) and `whitesmoke` (not matched as `white`) are safe.
const NAMED_COLOR_TOKEN = new RegExp(`(?<![\\w-])(?:${NAMED_CSS_COLORS.join("|")})(?![\\w-])`);

/** Return the first raw CSS named color used in any `style` attribute, or `undefined`. */
function findRawColorInStyle(markup: string): string | undefined {
  for (const match of markup.matchAll(STYLE_ATTR_PATTERN)) {
    const value = (match[2] ?? match[3] ?? "").toLowerCase();
    const hit = NAMED_COLOR_TOKEN.exec(value);
    if (hit) return hit[0];
  }
  return undefined;
}

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
    "- Escape every record value before placing it in markup; never interpolate a field into a `style` attribute (styles must be literal).",
    "- Use only the allow-listed primitive classes — no fabricated class names.",
    "- Inline `style` may set only token values on the owned axes: color `var(--color-*)`, spacing `var(--space-*)`, type scale `var(--type-*)`, border weight `var(--border-thin|--border-regular|--border-thick)`. No raw colors (named, hex, or color functions), no `url(...)`, no `position: fixed|absolute|sticky`.",
    "- Emit no `<script>`, event handlers (`on*=`), links, buttons, inputs, or other interactive/unknown elements — the platform owns the wrapper, payload, and click-to-open.",
  ].join("\n");
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return DEFAULT_UNIT_FIX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("design-lint maxAttempts must be a positive integer.");
  }
  return maxAttempts;
}

/** Accumulate token usage across regeneration passes into one honest total (a missing figure
 *  stays absent, never a fabricated zero — the provider-contract rule). */
class TokenUsageAccumulator {
  private input: number | undefined;
  private output: number | undefined;
  private totalTokens: number | undefined;

  add(usage: TokenUsage): void {
    this.input = addOptional(this.input, usage.inputTokens);
    this.output = addOptional(this.output, usage.outputTokens);
    this.totalTokens = addOptional(this.totalTokens, usage.totalTokens);
  }

  total(): TokenUsage {
    return { inputTokens: this.input, outputTokens: this.output, totalTokens: this.totalTokens };
  }
}

function addOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return (current ?? 0) + next;
}
