// A capability built next to one the Intent Resolver flagged arrives with its field linked: the
// link step runs beside the tests and the units, its relations commit with the capability, and a
// failed step costs only the link. Scripted end to end through POST /prompt with a fake
// provider; no test calls a real one.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { LINK_STEP_PROMPT_PREFIX } from "../../../builder/link/link-step.ts";
import type { IntentClassification } from "../../../pipeline/intent/index.ts";
import type { GenerateResult, Provider } from "../../../platform/provider/index.ts";
import { ProviderStageTimeoutError } from "../../../platform/provider/spine.ts";
import { buildConnecting } from "../../../presentation/controls/link/link-copy.ts";
import { getCapability, type Relation } from "../../../registry/index.ts";
import { install } from "../../../runtime/router/dispatch/router.test-support.ts";
import {
  BEHAVIORAL_SUITE,
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  PROMPT_BUILD_USAGE,
  postPrompt,
  readSse,
  responseText,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { escapeHtml } from "../../http/html.ts";
import { AUTHORS, BOOKS, BOOKS_INCARNATION, deskRow } from "../lifecycle/link.test-support.ts";

let env: ScratchDbEnv;

const REQUEST = "track how many copies of each book I own";
const FLAGGING_BOOKS: IntentClassification = {
  ...NEW_CAPABILITY_INTENT,
  related_capabilities: [BOOKS.id],
};
const [NOTES_TEXT] = NOTES_SPEC.schema.fields;
const TEXT_TO_TITLE = { field: "text", capability: BOOKS.id, target_field: "title" };
const textTo = (field: string): Relation => ({
  field: "text",
  to: { capability: BOOKS.id, incarnation: BOOKS_INCARNATION, field },
});

/** What the narration says while a build connects its text field to Books. */
const connecting = (label = NOTES_TEXT?.label ?? "") =>
  ` ${escapeHtml(buildConnecting(NOTES_SPEC.noun, [{ field: { label }, targetPlural: BOOKS.plural }]))}`;

const isLinkPrompt = (prompt: string) => prompt.startsWith(LINK_STEP_PROMPT_PREFIX);
const narration = (events: ReturnType<typeof collectSseEvents>) =>
  events.filter(({ event }) => event === "narration").map(({ data }) => data);

function freshDesk(): void {
  env = createScratchDbEnv("omni-crud-build-arrives-linked-");
  install(env.conns, deskRow(BOOKS));
}

/** Build through the prompt bar on the scratch desk with `provider` answering every step. */
async function build(provider: Provider) {
  const metrics = makeMetricsRecorder();
  const app = makeScratchApp(env, provider, metrics.recordMetrics);
  const fragment = await responseText(await postPrompt(app, REQUEST));
  const stream = await app.request(`/build/${buildJobIdFromSubscriber(fragment)}/stream`);
  const events = collectSseEvents(await readSse(stream));
  const built = getCapability(NOTES_SPEC.id, env.conns.readonly);
  return { events, done: eventData(events, "done"), built, rows: metrics.rows };
}

/** A flagged build whose link step answers `link`. */
const answering = (link: unknown, spec: unknown = NOTES_SPEC) =>
  makePromptBuildProvider(FLAGGING_BOOKS, spec, BEHAVIORAL_SUITE, { link });

/** The scripted build, with the link step's call answered by `link` instead. */
function withLinkStep(base: Provider, link: () => GenerateResult<never>): Provider {
  return {
    generate: <T>(prompt: string, schema: ZodType<T>): GenerateResult<T> =>
      isLinkPrompt(prompt) ? link() : base.generate(prompt, schema),
  };
}

describe("a build arrives linked", () => {
  beforeEach(freshDesk);

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("the step's relation commits with the capability, and the form draws the field as a dropdown", async () => {
    install(env.conns, deskRow(AUTHORS));
    const label = "Text & <em>more</em>";
    const marked = { ...NOTES_SPEC, schema: { fields: [{ ...NOTES_TEXT, label }] } };
    const toUnflagged = { field: "text", capability: AUTHORS.id, target_field: "name" };
    const { provider, prompts } = answering({ relations: [toUnflagged, TEXT_TO_TITLE] }, marked);
    const { done, events, built, rows } = await build(provider);

    expect(done).toBe("ok");
    expect(built?.relations).toStrictEqual([textTo("title")]);
    expect(eventData(events, "commit")).toContain("data-linked-field");
    expect(narration(events)).toContain(connecting(label));
    expect(narration(events).join("")).not.toContain("<em>");
    expect(rows[0]?.usage?.totalTokens).toBe(prompts.length * PROMPT_BUILD_USAGE.totalTokens);
  });

  test("building next to Books links only the capability being built, and Books' author stays typed text", async () => {
    const booksBefore = getCapability(BOOKS.id, env.conns.readonly);
    const { provider } = answering({
      relations: [
        { field: "author", capability: NOTES_SPEC.id, target_field: "text" },
        { field: "text", capability: BOOKS.id, target_field: "author" },
      ],
    });
    const { done, built } = await build(provider);

    expect(done).toBe("ok");
    expect(built?.relations).toStrictEqual([textTo("author")]);
    expect(getCapability(BOOKS.id, env.conns.readonly)).toStrictEqual(booksBefore);
  });

  test.each([
    [
      "throws",
      (): GenerateResult<never> => {
        throw new Error("the provider is down");
      },
    ],
    [
      "times out",
      (): GenerateResult<never> => {
        const timedOut = Promise.reject(new ProviderStageTimeoutError("five minutes"));
        return { partialStream: (async function* () {})(), object: timedOut, usage: timedOut };
      },
    ],
  ])("a step that %s leaves the build published with no relations", async (_, link) => {
    const { provider } = makePromptBuildProvider(FLAGGING_BOOKS);
    const { done, events, built } = await build(withLinkStep(provider, link));

    expect(done).toBe("ok");
    expect(built?.relations).toStrictEqual([]);
    expect(eventData(events, "commit")).not.toContain("data-linked-field");
  });

  test("the step runs beside the tests and the units, which read the same prompts with or without it", async () => {
    const unflagged = makePromptBuildProvider(NEW_CAPABILITY_INTENT);
    const plain = await build(unflagged.provider);
    expect(plain.done).toBe("ok");
    expect(unflagged.prompts.some(isLinkPrompt)).toBe(false);

    teardownScratchDbEnv(env);
    freshDesk();
    // The answer is held until every other call has gone out (the fixture Gate calls no provider),
    // so a build that waited on it before the tests or the units would wait out the grace and
    // arrive with no relation.
    const held = Promise.withResolvers<unknown>();
    const flagged = answering(held.promise);
    const observed: Provider = {
      generate(prompt, schema) {
        const result = flagged.provider.generate(prompt, schema);
        if (flagged.prompts.length === unflagged.prompts.length + 1) {
          held.resolve({ relations: [TEXT_TO_TITLE] });
        }
        return result;
      },
    };
    const { done, built, events } = await build(observed);

    expect(done).toBe("ok");
    expect(built?.relations).toStrictEqual([textTo("title")]);
    // The sentence comes once the units are done, before the Gate's line, while it can be read.
    const said = narration(plain.events);
    expect(narration(events)).toStrictEqual([
      ...said.slice(0, -1),
      connecting(),
      ...said.slice(-1),
    ]);
    // Its call goes out right after the spec's, before any test or unit.
    expect(flagged.prompts.findIndex(isLinkPrompt)).toBe(2);
    const testsAndUnits = (prompts: readonly string[]) =>
      prompts.slice(2).filter((prompt) => !isLinkPrompt(prompt));
    expect(testsAndUnits(flagged.prompts)).toStrictEqual(testsAndUnits(unflagged.prompts));
  }, 60_000);
});
