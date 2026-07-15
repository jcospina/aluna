// Tests for the design-lint gate rung (Epic 3.6).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is authored as string data; the `${...}` placeholders are TypeScript for the generated item.ts, not this file's template literals.
//
// Two surfaces: the detector (`findDesignViolation` — does the renderer's composition
// survive the platform enforcer, within the declared layout?) exercised directly across
// every forbidden category, and the rung inside the real gate (`runCapabilityGate`) proving
// a clean pass, a violation-then-fix through the bounded loop, and cap exhaustion. Every
// provider is fake; the behavioral tier is off so the only provider calls are the rung's own
// item-renderer regenerations — no real provider call anywhere.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ZodType } from "zod";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { CapabilityGateError, type CapabilityGateInput, runCapabilityGate } from "./gate.ts";
import { findDesignViolation } from "./gate-design-lint.ts";
import type { HandlerUnitName } from "./units.ts";

setDefaultTimeout(15_000);

const STUB_USAGE: TokenUsage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

const ESCAPE_HELPER = [
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

/** Assemble an item renderer whose body returns `bodyExpr` (an interpolated template). */
function renderer(bodyExpr: string): string {
  return [
    "export default function renderItem(record: Record<string, unknown>): string {",
    '  const text = escapeHtml(record.text ?? "");',
    `  return ${bodyExpr};`,
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");
}

// A design-clean renderer: allow-listed classes, token-disciplined inline style, every
// record value escaped. Survives the enforcer byte-for-byte → passes the rung.
const CLEAN_RENDERER = renderer(
  '`<div class="stack gap-1"><span class="text-lg text-bold truncate">${text}</span></div>`',
);

// Token-disciplined inline style on the owned axes (color/spacing) — the escape hatch used
// correctly. Must pass clean.
const TOKEN_STYLE_RENDERER = renderer(
  '`<div class="stack" style="padding: var(--space-1); color: var(--color-text);"><span class="text-bold">${text}</span></div>`',
);

const HANDLERS: Readonly<Partial<Record<HandlerUnitName, string>>> = {
  create: [
    "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
    '    const note = mutation.create({ text: input.values.text, pinned: input.values.pinned === "on" });',
    "  return present(note);",
    "}",
  ].join("\n"),
  read: [
    "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
    "  const notes = query.all({",
    '    sql: \'SELECT * FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
    '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "text", type: "string" }, { alias: "pinned", type: "boolean" }],',
    "  });",
    '  return notes.map((note) => present(note)).join("");',
    "}",
  ].join("\n"),
};

/** A fake provider that yields queued item-renderer `{ content }` objects — one per fix the
 *  design-lint rung asks for. Records every call so a test can assert the regeneration count. */
function makeRendererProvider(contents: readonly string[]): {
  provider: Provider;
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      calls.push(prompt);
      const content = contents[index];
      index += 1;
      if (content === undefined) {
        throw new Error(`fake renderer provider exhausted after ${calls.length} call(s)`);
      }
      const object = schema.parse({ content });
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield object as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(object),
        usage: Promise.resolve(STUB_USAGE),
      };
    },
  };
  return { provider, calls };
}

function gateInput(overrides: Partial<CapabilityGateInput> = {}): CapabilityGateInput {
  const spec = notesSpec();
  return {
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: HANDLERS,
    itemRenderer: CLEAN_RENDERER,
    behavioralTier: { enabled: false },
    ...overrides,
  };
}

async function expectGateFailure(input: CapabilityGateInput): Promise<CapabilityGateError> {
  try {
    await runCapabilityGate(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CapabilityGateError);
    return error as CapabilityGateError;
  }
  throw new Error("expected gate to fail");
}

describe("design-lint detector (findDesignViolation)", () => {
  const spec = notesSpec();

  test("passes an allow-listed, escaped, token-disciplined renderer", () => {
    expect(findDesignViolation(spec, CLEAN_RENDERER)).toBeUndefined();
    expect(findDesignViolation(spec, TOKEN_STYLE_RENDERER)).toBeUndefined();
  });

  test("passes a media renderer that interpolates an escaped field into <img src>", () => {
    // Flowing a user field into an allow-listed URL attribute is the intended media pattern
    // (the photo-grid exemplar does exactly this). A hostile URL *value* is sanitized
    // per-record by the runtime enforcer (3.1/02), not rejected here as a renderer violation
    // — this guards the false-positive that once flagged that exemplar.
    const media = renderer(
      '`<figure class="media-frame media-frame--square"><img src="${text}" alt="" loading="lazy" decoding="async"></figure>`',
    );
    expect(findDesignViolation(spec, media)).toBeUndefined();
  });

  test("rejects off-token color on the token-owned axis", () => {
    const bad = renderer('`<div style="color: red;">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects a named CSS color inside a mixed shorthand (the 3.1/02 residual)", () => {
    // `background: white` is inert at render time and slips past the runtime enforcer; the
    // build-time rung is where it is caught.
    const bad = renderer('`<div style="background: white;">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain('raw color "white"');
  });

  test("rejects url() in inline style", () => {
    const bad = renderer(
      "`<div style=\"background-image: url('https://evil.example/x.png');\">${text}</div>`",
    );
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects item-escaping position", () => {
    const bad = renderer('`<div style="position: fixed;">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects a fabricated/unknown class", () => {
    const bad = renderer('`<div class="totally-made-up-class">${text}</div>`');
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects an interactive descendant", () => {
    const bad = renderer('`<div><a href="https://example.com">${text}</a></div>`');
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects a field value interpolated into a style attribute", () => {
    // The renderer places a record value straight into `style` — a hostile probe value
    // makes the resulting declaration off-token, which the enforcer strips.
    const bad = renderer('`<div style="color: ${String(record.text)};">x</div>`');
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects unescaped field interpolation (executable markup)", () => {
    // No escaping: a hostile <script>/<img onerror> probe becomes real markup.
    const bad = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  return `<div class="stack">${String(record.text)}</div>`;',
      "}",
    ].join("\n");
    expect(findDesignViolation(spec, bad)).toContain("Design contract violation");
  });

  test("rejects a renderer that throws mid-render rather than crashing a live view", () => {
    const throws = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  throw new Error('boom');",
      "}",
    ].join("\n");
    expect(findDesignViolation(spec, throws)).toContain("threw when composing");
  });
});

describe("design-lint gate rung", () => {
  test("passes a clean renderer without asking the provider to fix anything", async () => {
    const { provider, calls } = makeRendererProvider([]);
    const result = await runCapabilityGate(gateInput({ provider }));

    expect(result.outcomes.map((o) => `${o.rung}:${o.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:passed",
    ]);
    expect(result.designLint.fixed).toBe(false);
    expect(result.designLint.itemRenderer).toBe(CLEAN_RENDERER);
    expect(result.designLint.attempts).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  test("passes with no provider at all when the renderer is already clean", async () => {
    // The baseline gate run supplies no provider; a clean renderer needs no fix.
    const result = await runCapabilityGate(gateInput({ provider: undefined }));
    expect(result.outcomes.at(-1)).toMatchObject({ rung: "design-lint", status: "passed" });
    expect(result.designLint.fixed).toBe(false);
  });

  test("feeds a violation through the bounded fix loop and commits the fixed renderer", async () => {
    const offToken = renderer('`<div style="color: red;">${text}</div>`');
    const { provider, calls } = makeRendererProvider([CLEAN_RENDERER]);

    const result = await runCapabilityGate(gateInput({ itemRenderer: offToken, provider }));

    expect(result.outcomes.map((o) => `${o.rung}:${o.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:passed",
    ]);
    expect(result.designLint.fixed).toBe(true);
    // The rung returns the regenerated, clean renderer — what the pipeline commits to disk.
    expect(result.designLint.itemRenderer).toBe(CLEAN_RENDERER);
    expect(result.designLint.attempts).toHaveLength(2);
    expect(result.designLint.attempts[0]?.error).toContain("Design contract violation");
    expect(result.designLint.attempts[1]?.error).toBeUndefined();
    // The fed-back prompt carried the precise failure so the model could fix it.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Design contract violation");
    expect(result.designLint.usage).toMatchObject({ inputTokens: 3 });
  });

  test("re-validates a regenerated renderer's type/shape before accepting it", async () => {
    // First fix regenerates a renderer that does not type-check; it must feed back (not
    // commit) and the second fix — clean — is what passes.
    const offToken = renderer('`<div style="color: red;">${text}</div>`');
    const brokenType = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  return record.text;", // unknown is not assignable to string
      "}",
    ].join("\n");
    const { provider, calls } = makeRendererProvider([brokenType, CLEAN_RENDERER]);

    const result = await runCapabilityGate(
      gateInput({ itemRenderer: offToken, provider, designLint: { maxAttempts: 3 } }),
    );

    expect(result.designLint.fixed).toBe(true);
    expect(result.designLint.itemRenderer).toBe(CLEAN_RENDERER);
    expect(result.designLint.attempts).toHaveLength(3);
    expect(result.designLint.attempts[1]?.error).toContain("not assignable to type 'string'");
    expect(calls).toHaveLength(2);
  });

  test("fails the build closed when the fix loop exhausts (no version bump / no pointer flip)", async () => {
    const offToken = renderer('`<div style="color: red;">${text}</div>`');
    const stillOffToken = renderer('`<div style="color: blue;">${text}</div>`');
    const { provider, calls } = makeRendererProvider([stillOffToken]);

    const error = await expectGateFailure(gateInput({ itemRenderer: offToken, provider }));

    expect(error.failedRung).toBe("design-lint");
    expect(error.outcomes.map((o) => `${o.rung}:${o.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:failed",
    ]);
    // maxAttempts defaults to 2: detect the original, then one regeneration that stays dirty.
    expect(calls).toHaveLength(1);
    expect(error.diagnostic).toMatchObject({
      violation: expect.stringContaining("Design contract violation"),
      attempts: expect.arrayContaining([expect.objectContaining({ attempt: 2 })]),
    });
  });

  test("with no provider a violation fails closed on the first look — it cannot fix", async () => {
    const offToken = renderer('`<div style="color: red;">${text}</div>`');
    const error = await expectGateFailure(
      gateInput({ itemRenderer: offToken, provider: undefined }),
    );

    expect(error.failedRung).toBe("design-lint");
    expect(error.outcomes.at(-1)).toMatchObject({ rung: "design-lint", status: "failed" });
  });
});
