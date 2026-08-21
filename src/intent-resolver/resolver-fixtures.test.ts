import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { notesCapabilityRow } from "../app/app.test-support.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import { type CapabilityRow, fingerprintActiveRegistryCatalog } from "../registry/index.ts";
import { classifyIntent } from "./resolver.ts";
import type { IntentClassification } from "./schema.ts";

const contacts = notesCapabilityRow({
  id: "contacts",
  label: "Contacts",
  incarnation_id: "22222222-2222-4222-8222-222222222222",
  artifacts_path: "capabilities/contacts/22222222-2222-4222-8222-222222222222/v1/",
  prompt_context: "Stores personal contacts and how to reach them.",
});
const recipes = notesCapabilityRow({
  id: "recipes",
  label: "Recipes",
  incarnation_id: "33333333-3333-4333-8333-333333333333",
  artifacts_path: "capabilities/recipes/33333333-3333-4333-8333-333333333333/v1/",
  prompt_context: "Stores recipes, ingredients, genres, quotes, and source addresses.",
  schema: {
    fields: [
      {
        name: "title",
        label: "Title",
        type: "string",
        required: true,
        lifecycle: "active",
      },
      {
        name: "genres",
        label: "Genres",
        type: "string[]",
        required: false,
        lifecycle: "active",
      },
      {
        name: "quotes",
        label: "Quotes",
        type: "string[]",
        required: false,
        lifecycle: "active",
      },
      {
        name: "legacy_tags",
        label: "Legacy tags",
        type: "string[]",
        required: false,
        lifecycle: "inactive",
      },
    ],
  },
  ui_intent: {
    form: {
      list_inputs: [
        { field: "genres", mode: "comma_separated" },
        { field: "quotes", mode: "repeatable" },
      ],
    },
    item: { direction: "Show each recipe clearly.", shows: ["title", "genres", "quotes"] },
    collection: { layout: "feed" },
  },
});
const catalogRows: readonly CapabilityRow[] = [notesCapabilityRow(), contacts, recipes];
const catalog = {
  capabilities: catalogRows,
  fingerprint: fingerprintActiveRegistryCatalog(catalogRows),
};

interface Fixture {
  readonly name: string;
  readonly prompt: string;
  readonly activeCapabilityId: string;
  readonly expected: IntentClassification;
}

const fixtures: readonly Fixture[] = [
  {
    name: "active-context extension",
    prompt: "add a due date and make it stand out",
    activeCapabilityId: "notes",
    expected: {
      type: "extend_capability",
      confidence: 0.98,
      target_capability: "notes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add a due date and emphasize it in note items.",
      user_facing_label: "I'll add a due date and bring it forward.",
      requires_confirmation: false,
    },
  },
  {
    name: "explicit wording overrides active context",
    prompt: "make Recipes a grid",
    activeCapabilityId: "notes",
    expected: {
      type: "ui_change",
      confidence: 0.99,
      target_capability: "recipes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Present Recipes in a grid.",
      user_facing_label: "I'll arrange your recipes in a grid.",
      requires_confirmation: false,
    },
  },
  {
    name: "cosmetic phrasing cannot hide a data change",
    prompt: "show a new rating prominently on each recipe",
    activeCapabilityId: "recipes",
    expected: {
      type: "extend_capability",
      confidence: 0.99,
      target_capability: "recipes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add a rating and emphasize it in recipe items.",
      user_facing_label: "I'll add ratings and bring them forward.",
      requires_confirmation: false,
    },
  },
  {
    name: "comma-free list input may change presentation",
    prompt: "make entering recipe genres more compact",
    activeCapabilityId: "recipes",
    expected: {
      type: "ui_change",
      confidence: 0.94,
      target_capability: "recipes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Use compact comma-separated entry for comma-free genres.",
      user_facing_label: "I'll make genre entry more compact.",
      requires_confirmation: false,
    },
  },
  {
    name: "comma-bearing values retain repeatable entry",
    prompt: "make entering recipe quotes more compact",
    activeCapabilityId: "recipes",
    expected: {
      type: "ui_change",
      confidence: 0.94,
      target_capability: "recipes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Compact quote entry while preserving one repeatable value per quote.",
      user_facing_label: "I'll make quote entry tidier without changing your text.",
      requires_confirmation: false,
    },
  },
  {
    name: "distinct lifecycle becomes a separate capability",
    prompt: "track my work contacts separately",
    activeCapabilityId: "contacts",
    expected: {
      type: "new_capability",
      confidence: 0.99,
      target_capability: "contacts",
      resolution: "namespace",
      proposed_identity: { id: "work_contacts", label: "Work contacts" },
      proposed_action: "Create a separate capability named Work contacts.",
      user_facing_label: "I'll keep your work contacts in their own place.",
      requires_confirmation: false,
    },
  },
];

function fixtureProvider(response: IntentClassification, prompts: string[]): Provider {
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const parsed = schema.parse(response);
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield parsed as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(parsed),
        usage: Promise.resolve({ inputTokens: 5, outputTokens: 2, totalTokens: 7 }),
      };
    },
  };
}

describe("intent resolver fixture catalog", () => {
  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const prompts: string[] = [];
      const intent = await classifyIntent({
        provider: fixtureProvider(fixture.expected, prompts),
        prompt: fixture.prompt,
        activeCapabilityId: fixture.activeCapabilityId,
        catalog,
      });

      expect(intent).toEqual(fixture.expected);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(`Active capability:\nid: ${fixture.activeCapabilityId}`);
      expect(prompts[0]).toContain(`Prompt bar text:\n${fixture.prompt}`);
      for (const row of catalogRows) {
        expect(prompts[0]).toContain(`prompt_context: ${row.prompt_context}`);
      }
      expect(prompts[0]).toContain("title: string, lifecycle active");
      expect(prompts[0]).toContain(
        "genres: string[], lifecycle active, list_input comma_separated",
      );
      expect(prompts[0]).toContain("quotes: string[], lifecycle active, list_input repeatable");
      expect(prompts[0]).toContain("legacy_tags: string[], lifecycle inactive");
    });
  }
});
