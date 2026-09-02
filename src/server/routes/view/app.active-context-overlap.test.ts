import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createHandlerFor,
  fullHandlersFor,
  generatedUnitsFor,
  itemRendererFor,
  makeSequenceProvider,
  readHandlerFor,
  updateHandlerFor,
} from "../../../builder/gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../../builder/index.ts";
import {
  activatePublishedSnapshot,
  expectedAbsentCapability,
  publishCapabilitySnapshot,
  runCapabilityGate,
} from "../../../builder/index.ts";
import type { IntentClassification } from "../../../pipeline/intent/index.ts";
import { type CapabilitySpec, getCapability } from "../../../registry/index.ts";
import { applyCapabilityTableDdl, deriveCapabilityTableDdl } from "../../../runtime/data/index.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  NOTES_SPEC,
  readSse,
  responseText,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { pinBehavioralTierOff } from "../evolution/app.evolution.test-support.ts";

const CONTACTS_INCARNATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACTS_SPEC: CapabilitySpec = {
  ...(NOTES_SPEC as CapabilitySpec),
  id: "contacts",
  label: "Contacts",
  prompt_context: "Stores the user's personal contacts and how to reach them.",
};
const WORK_CONTACTS_SPEC: CapabilitySpec = {
  ...CONTACTS_SPEC,
  id: "work_contacts",
  label: "Work contacts",
  prompt_context: "Stores the user's work contacts separately from personal contacts.",
};

let contactsGate: CapabilityGateResult;
let restoreBehavioralTier: () => void;
let env: ScratchDbEnv;

function handlersFor(spec: CapabilitySpec) {
  return fullHandlersFor(spec, {
    create: createHandlerFor(spec),
    read: readHandlerFor(spec),
  });
}

async function activateContacts(): Promise<void> {
  const publication = publishCapabilitySnapshot({
    buildId: "contacts-v1",
    spec: CONTACTS_SPEC,
    incarnationId: CONTACTS_INCARNATION,
    version: 1,
    units: generatedUnitsFor(CONTACTS_SPEC, handlersFor(CONTACTS_SPEC)),
    gate: contactsGate,
    artifactsRoot: env.artifactsRoot,
  });
  await activatePublishedSnapshot({
    database: env.conns.readwrite,
    spec: CONTACTS_SPEC,
    publication,
    expected: expectedAbsentCapability(),
    applyMigration: (database) => void applyCapabilityTableDdl(CONTACTS_SPEC, database),
    finalizeMetrics: () => undefined,
  });
}

function activePromptBody(prompt: string): URLSearchParams {
  return new URLSearchParams({
    prompt,
    __aluna_restore_capability_id: "contacts",
    __aluna_restore_incarnation_id: CONTACTS_INCARNATION,
  });
}

beforeAll(async () => {
  restoreBehavioralTier = pinBehavioralTierOff();
  contactsGate = await runCapabilityGate({
    spec: CONTACTS_SPEC,
    ddl: deriveCapabilityTableDdl(CONTACTS_SPEC),
    handlers: handlersFor(CONTACTS_SPEC),
    itemRenderer: itemRendererFor(CONTACTS_SPEC),
    behavioralTier: { enabled: false },
  });
});

afterAll(() => restoreBehavioralTier());

beforeEach(async () => {
  env = createScratchDbEnv("aluna-active-overlap-");
  await activateContacts();
});

afterEach(() => teardownScratchDbEnv(env));

describe("homepage active context and semantic overlap", () => {
  test("the validated active capability reaches resolver classification", async () => {
    const intent: IntentClassification = {
      type: "data_query",
      confidence: 0.9,
      target_capability: "contacts",
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Count saved contacts.",
      user_facing_label: "I'll look through your contacts.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makeSequenceProvider([intent]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", { method: "POST", body: activePromptBody("how many are here") }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    await readSse(await app.request(`/build/${jobId}/stream`));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Active capability:\nid: contacts");
    expect(prompts[0]).toContain("Prompt bar text:\nhow many are here");
  });
});

describe("homepage existing-capability evolution", () => {
  test("the active Contacts capability evolves in place from the prompt bar", async () => {
    const intent: IntentClassification = {
      type: "extend_capability",
      confidence: 0.98,
      target_capability: "contacts",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add an optional due date and emphasize it in each contact item.",
      user_facing_label: "I'll add a due date and bring it forward.",
      requires_confirmation: false,
    };
    const candidate: CapabilitySpec = {
      ...CONTACTS_SPEC,
      schema: {
        fields: [
          ...CONTACTS_SPEC.schema.fields,
          {
            name: "due_date",
            label: "Due date",
            type: "date",
            required: false,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        ...CONTACTS_SPEC.ui_intent,
        item: {
          direction: "Emphasize the due date as timely contact follow-up metadata.",
          shows: [...CONTACTS_SPEC.ui_intent.item.shows, "due_date"],
        },
      },
    };
    const { provider } = makeSequenceProvider([
      intent,
      candidate,
      { content: itemRendererFor(candidate) },
      { content: createHandlerFor(candidate) },
      { content: updateHandlerFor(candidate) },
    ]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", {
        method: "POST",
        body: activePromptBody("add a due date and make it stand out in the list"),
      }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(events.map((event) => event.event)).toContain("commit");
    expect(eventData(events, "commit")).toContain('data-active-capability-id="contacts"');
    expect(eventData(events, "commit")).toContain('data-active-capability-version="2"');
    expect(getCapability("contacts", env.conns.readonly)?.version).toBe(2);
    expect(metrics.lifecycles.at(-1)?.resolver?.intent).toMatchObject({
      type: "extend_capability",
      targetCapability: "contacts",
    });
    expect(metrics.lifecycles.at(-1)?.resolver?.overlapResolution).toBe("extend");
  });

  test("a ui_change data escape is durably recorded as candidate validation", async () => {
    const intent: IntentClassification = {
      type: "ui_change",
      confidence: 0.98,
      target_capability: "contacts",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Make the contact list feel more compact.",
      user_facing_label: "I'll make your contacts more compact.",
      requires_confirmation: false,
    };
    const invalidCandidate: CapabilitySpec = {
      ...CONTACTS_SPEC,
      schema: {
        fields: [
          ...CONTACTS_SPEC.schema.fields,
          {
            name: "nickname",
            label: "Nickname",
            type: "string",
            required: false,
            lifecycle: "active",
          },
        ],
      },
    };
    const { provider } = makeSequenceProvider([intent, invalidCandidate]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", {
        method: "POST",
        body: activePromptBody("make this list more compact"),
      }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(events.map((event) => event.event)).not.toContain("units-preview");
    expect(events.map((event) => event.event)).not.toContain("commit");
    expect(getCapability("contacts", env.conns.readonly)?.version).toBe(1);
    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "spec_generation_failed",
      measurement: {
        failure: { stage: "spec_gen" },
        usage: { inputTokens: 14, outputTokens: 22, totalTokens: 36 },
        timings: { specGenMs: expect.any(Number) },
      },
    });
  });
});

describe("homepage separate semantic overlap", () => {
  test("work contacts reaches the provider and commits a meaningfully named separate capability", async () => {
    const intent: IntentClassification = {
      type: "new_capability",
      confidence: 0.99,
      target_capability: "contacts",
      resolution: "namespace",
      proposed_identity: { id: "work_contacts", label: "Work contacts" },
      proposed_action: "Create a separate capability for work contacts.",
      user_facing_label: "I'll keep your work contacts in their own place.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makeSequenceProvider([
      intent,
      WORK_CONTACTS_SPEC,
      { content: itemRendererFor(WORK_CONTACTS_SPEC) },
      ...Object.values(handlersFor(WORK_CONTACTS_SPEC)).map((content) => ({ content })),
    ]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", {
        method: "POST",
        body: activePromptBody("track my work contacts separately"),
      }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts[0]).toContain("track my work contacts separately");
    expect(prompts[0]).toContain("prompt_context: Stores the user's personal contacts");
    expect(prompts[1]).not.toContain("namespace");
    expect(prompts[1]).toContain("meaningful semantic label and id");
    expect(eventData(events, "commit")).toContain('data-capability-id="work_contacts"');
    expect(eventData(events, "commit")).toContain(
      '<span class="logo-label" data-logo-label>Work contacts</span>',
    );
    expect(eventData(events, "commit")).not.toContain("contacts_2");
    expect(getCapability("work_contacts", env.conns.readonly)?.label).toBe("Work contacts");
    expect(metrics.lifecycles.at(-1)?.resolver?.overlapResolution).toBe("namespace");
  });

  test("a mechanical overlap identity fails before migration or unit generation", async () => {
    const intent: IntentClassification = {
      type: "new_capability",
      confidence: 0.99,
      target_capability: "contacts",
      resolution: "namespace",
      proposed_identity: { id: "work_contacts", label: "Work contacts" },
      proposed_action: "Create a separate capability for work contacts.",
      user_facing_label: "I'll keep your work contacts in their own place.",
      requires_confirmation: false,
    };
    const mechanicalDuplicate: CapabilitySpec = {
      ...WORK_CONTACTS_SPEC,
      id: "contacts2",
      label: "Contacts",
    };
    const { provider, prompts } = makeSequenceProvider([intent, mechanicalDuplicate]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", {
        method: "POST",
        body: activePromptBody("track my work contacts separately"),
      }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts).toHaveLength(2);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).not.toContain("migration-preview");
    expect(eventNames).not.toContain("units-preview");
    expect(eventNames).not.toContain("commit");
    // The restoration fragment, not the desk sidecar an admitted build sends first — both
    // ride `fragment` (ADR-0002), and only one of them carries a restoration.
    const restoration = events.findIndex(
      ({ event, data }) => event === "fragment" && data.includes("data-build-restoration"),
    );
    expect(eventNames.indexOf("spec-preview")).toBeLessThan(restoration);
    expect(eventNames.at(-1)).toBe("done");
    expect(getCapability("contacts2", env.conns.readonly)).toBeNull();
    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "spec_generation_failed",
      measurement: { failure: { stage: "spec_gen" } },
    });
  });
});

describe("homepage namespace source admission", () => {
  test("a missing overlap source never enters Builder work", async () => {
    const intent: IntentClassification = {
      type: "new_capability",
      confidence: 0.99,
      target_capability: "missing_contacts",
      resolution: "namespace",
      proposed_identity: { id: "work_contacts", label: "Work contacts" },
      proposed_action: "Create a separate capability for work contacts.",
      user_facing_label: "I'll keep your work contacts in their own place.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makeSequenceProvider([intent]);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, metrics.recordMetrics);

    const fragment = await responseText(
      await app.request("/prompt", {
        method: "POST",
        body: activePromptBody("track my work contacts separately"),
      }),
    );
    const jobId = buildJobIdFromSubscriber(fragment);
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts).toHaveLength(1);
    expect(events.map((event) => event.event)).not.toContain("spec-preview");
    expect(events.map((event) => event.event)).not.toContain("migration-preview");
    expect(events.map((event) => event.event)).not.toContain("commit");
    expect(metrics.lifecycles).toEqual([]);
    expect(getCapability("work_contacts", env.conns.readonly)).toBeNull();
  });
});
