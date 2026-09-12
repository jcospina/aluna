import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import type { DeepPartial, GenerateResult, Provider } from "../../platform/provider/index.ts";
import {
  SECOND_INCARNATION_ID,
  THIRD_INCARNATION_ID,
} from "../../registry/incarnations.test-support.ts";
import { type CapabilityRow, fingerprintActiveRegistryCatalog } from "../../registry/index.ts";
import { notesCapabilityRow } from "../../server/app.test-support.ts";
import { buildIntentPrompt, classifyIntent, INTENT_DATA_QUERY_CONTEXT_RULE } from "./resolver.ts";
import type { IntentClassification } from "./schema.ts";

const contacts = notesCapabilityRow({
  id: "contacts",
  label: "Contacts",
  subject: "an open notebook",
  ground: "grass_green",
  companion: "coral_orange",
  noun: "note",
  incarnation_id: SECOND_INCARNATION_ID,
  artifacts_path: `capabilities/contacts/${SECOND_INCARNATION_ID}/v1/`,
  seed: 184206,
  logo: { status: "absent", attempts: 0 },
  prompt_context: "Stores personal contacts and how to reach them.",
});
const recipes = notesCapabilityRow({
  id: "recipes",
  label: "Recipes",
  subject: "an open notebook",
  ground: "grass_green",
  companion: "coral_orange",
  noun: "note",
  incarnation_id: THIRD_INCARNATION_ID,
  artifacts_path: `capabilities/recipes/${THIRD_INCARNATION_ID}/v1/`,
  seed: 184206,
  logo: { status: "absent", attempts: 0 },
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
      choice_inputs: [],
      long_text: [],
      guidance: [],
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
  /** What is standing in the window, or null for a desk showing none (PLAN decision 28). */
  readonly activeCapabilityId: string | null;
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
    // Nothing in the resolver knows what a logo is: "the icon" lands outside the closed ui_change
    // scope exactly the way a pixel offset does, so both fall to reject with no target.
    name: "art direction aimed at a logo is refused as ordinary presentation steering",
    prompt: "make the notes icon blue and bigger",
    activeCapabilityId: "notes",
    expected: {
      type: "reject",
      confidence: 0.96,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Decline to take art direction for presentation.",
      user_facing_label: "I look after how things look, so I'll leave that to me.",
      requires_confirmation: false,
    },
  },
  {
    name: "a pixel offset is refused by the same rule, not a different one",
    prompt: "move this 2px right and add more padding",
    activeCapabilityId: "notes",
    expected: {
      type: "reject",
      confidence: 0.96,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Decline to take art direction for presentation.",
      user_facing_label: "I look after how things look, so I'll leave that to me.",
      requires_confirmation: false,
    },
  },
  {
    // The three questions of decision 28. What they pin is the classification the desk then acts
    // on: `data_query` is the one intent whose target the schema neither requires nor forbids,
    // so these are where its contract is written down.
    name: "a loose word is resolved against the window it was asked in front of",
    prompt: "how many did I add this month?",
    activeCapabilityId: "recipes",
    expected: {
      type: "data_query",
      confidence: 0.93,
      target_capability: "recipes",
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Count this month's recipes.",
      user_facing_label: "Let me count what you added this month.",
      requires_confirmation: false,
    },
  },
  {
    name: "a question naming its own subject leaves the window out of it",
    prompt: "how many contacts do I have?",
    activeCapabilityId: "recipes",
    expected: {
      type: "data_query",
      confidence: 0.95,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Count the contacts.",
      user_facing_label: "Let me count your contacts.",
      requires_confirmation: false,
    },
  },
  {
    name: "the same loose question with nothing standing has nothing to lean on",
    prompt: "how many did I add this month?",
    activeCapabilityId: null,
    expected: {
      type: "data_query",
      confidence: 0.72,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Count this month's records.",
      user_facing_label: "Let me look at what you added this month.",
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
      expect(prompts[0]).toContain(
        fixture.activeCapabilityId === null
          ? "Active capability:\nnone"
          : `Active capability:\nid: ${fixture.activeCapabilityId}`,
      );
      expect(prompts[0]).toContain(INTENT_DATA_QUERY_CONTEXT_RULE);
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

  test("no logo-specific rule was added — the closed ui_change scope is the whole defence", () => {
    // The two refusal fixtures above are refused by the general rule, not one about logos. A
    // logo-specific branch in this prompt is the second rule the contract does not owe.
    const prompt = buildIntentPrompt({
      prompt: "make the notes icon blue and bigger",
      activeCapabilityId: "notes",
      capabilities: catalogRows,
    });
    // Only the rules the resolver states — the user's own words and the registry
    // context sit after this marker and are not the classifier's instructions.
    const rules = prompt.slice(0, prompt.indexOf("Registry context:")).toLowerCase();

    // The refusing rule is about presentation in general, so it names ordinary presentation words.
    // The logo's own vocabulary would be the second, logo-specific rule the contract never owes.
    for (const word of [
      "logo",
      "icon",
      "artwork",
      "drawing",
      "tile",
      "palette",
      "ground",
      "companion",
    ]) {
      expect(rules).not.toContain(word);
    }
    // What actually does the refusing: presentation choices the user may state are a
    // closed list, and art direction is not on it.
    expect(prompt).toContain(
      "ui_change is limited to capability labels, the word a capability calls one of its records, field labels, detail visibility/order, item direction/dependencies, feed or grid layout, active string[] list input modes, whether an active string field is typed into a multi-line box, and the one line of guidance shown under a field.",
    );
    expect(prompt).toContain(
      "Ignore requests to choose field types, migrations, frameworks, generated code, CSS tokens, or repair steps.",
    );
    expect(prompt).toContain(
      "A presentation request outside that closed list is reject, never ui_change.",
    );
  });
});
