import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import {
  createScratchDbEnv,
  notesCapabilityRow,
  teardownScratchDbEnv,
} from "../app/app.test-support.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import {
  fingerprintActiveRegistryCatalog,
  insertCapability,
  readActiveRegistryCatalog,
} from "../registry/index.ts";
import { classifyIntentWithUsage } from "./resolver.ts";

describe("intent resolver active catalog", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-resolver-catalog-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("classifies from one fingerprinted snapshot if the live registry changes later", async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const catalog = readActiveRegistryCatalog(conns.readonly);
    let providerPrompt = "";
    const response = {
      type: "reject",
      confidence: 0.7,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Do not build.",
      user_facing_label: "I'm not quite sure what to make from that yet.",
      requires_confirmation: false,
    } as const;
    const provider: Provider = {
      generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
        providerPrompt = prompt;
        async function* stream(): AsyncGenerator<DeepPartial<T>> {
          yield schema.parse(response) as DeepPartial<T>;
        }
        return {
          partialStream: stream(),
          object: Promise.resolve(schema.parse(response)),
          usage: Promise.resolve({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }),
        };
      },
    };
    insertCapability(
      notesCapabilityRow({
        id: "recipes",
        label: "Recipes",
        subject: "an open notebook",
        ground: "grass_green",
        companion: "coral_orange",
        noun: "note",
        incarnation_id: "22222222-2222-4222-8222-222222222222",
        artifacts_path: "capabilities/recipes/22222222-2222-4222-8222-222222222222/v1/",
        seed: 184206,
        logo: { status: "absent", attempts: 0 },
        prompt_context: "Stores recipes the user wants to cook again.",
      }),
      conns.readwrite,
    );

    const result = await classifyIntentWithUsage({
      provider,
      prompt: "purple semaphore",
      catalog,
    });

    expect(result.catalogFingerprint).toBe(catalog.fingerprint);
    expect(result.catalogFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(providerPrompt).toContain("Stores the user's text notes.");
    expect(providerPrompt).not.toContain("Stores recipes");
    expect(readActiveRegistryCatalog(conns.readonly).fingerprint).not.toBe(catalog.fingerprint);
  });

  test("fingerprints ignore the logo lifecycle, which moves out of band", () => {
    // A desk load claiming an attempt, or artwork landing, must never make an
    // unrelated in-flight build look classified-against-stale-state. What the
    // resolver reads is semantic registry content; whether a picture arrived is not.
    const row = notesCapabilityRow();
    const claimed = { ...row, logo: { status: "generating" as const, attempts: 1 } };
    const arrived = { ...row, logo: { status: "present" as const, attempts: 1 } };

    expect(fingerprintActiveRegistryCatalog([claimed])).toBe(
      fingerprintActiveRegistryCatalog([row]),
    );
    expect(fingerprintActiveRegistryCatalog([arrived])).toBe(
      fingerprintActiveRegistryCatalog([row]),
    );
    // The seed still counts: it is per-incarnation and never moves, so a different
    // one is a different capability lifetime, not out-of-band churn.
    expect(fingerprintActiveRegistryCatalog([{ ...row, seed: row.seed + 1 }])).not.toBe(
      fingerprintActiveRegistryCatalog([row]),
    );
  });

  test("fingerprints ignore object key insertion order", () => {
    const row = notesCapabilityRow();
    const reordered = {
      prompt_context: row.prompt_context,
      artifacts_path: row.artifacts_path,
      seed: row.seed,
      logo: row.logo,
      read_dependencies: row.read_dependencies,
      tools: row.tools,
      behavioral_errors: row.behavioral_errors,
      behavior: row.behavior,
      ui_intent: row.ui_intent,
      schema: row.schema,
      version: row.version,
      incarnation_id: row.incarnation_id,
      noun: row.noun,
      ground: row.ground,
      companion: row.companion,
      subject: row.subject,
      label: row.label,
      id: row.id,
    };

    expect(fingerprintActiveRegistryCatalog([row])).toBe(
      fingerprintActiveRegistryCatalog([reordered]),
    );
  });
});
