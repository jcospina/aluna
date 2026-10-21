// The desk a linking-only request is tested on: Books and Authors from the Link control's
// demo desk, the authors seeded and the books typed against them, a request said through POST
// /prompt with Books standing, and a fake provider answering the resolver and the link step.

import type { ZodType } from "zod";
import { LINK_STEP_PROMPT_PREFIX } from "../../../../builder/link/link-step.ts";
import {
  INTENT_RESOLUTION_NARRATION,
  type IntentClassification,
} from "../../../../pipeline/intent/index.ts";
import {
  RESTORATION_CAPABILITY_ID_FIELD,
  RESTORATION_INCARNATION_ID_FIELD,
} from "../../../../pipeline/jobs/restoration.ts";
import { LINK_TABLE } from "../../../../platform/persistence/table-names.ts";
import type { GenerateResult, Provider } from "../../../../platform/provider/index.ts";
import type { Relation, SpecField } from "../../../../registry/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../../runtime/concurrency/mutation-coordinator.ts";
import { install } from "../../../../runtime/router/dispatch/router.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  lastEventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  postPrompt,
  promptBarSentences,
  readSse,
  responseText,
  type ScratchDbEnv,
} from "../../../app.test-support.ts";
import { createTestApp } from "../../../isolated-app.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  READING_LOG,
  SEEDED_AUTHORS,
} from "../../lifecycle/link.test-support.ts";

export const LINKING: IntentClassification = {
  type: "link_capability",
  confidence: 0.93,
  target_capability: BOOKS.id,
  resolution: "extend",
  proposed_identity: null,
  proposed_action: "Connect each book's author to Authors.",
  user_facing_label: "I'll connect your books to their authors.",
  related_capabilities: [AUTHORS.id],
  requires_confirmation: false,
};
export const AUTHOR_TO_NAME = { field: "author", capability: AUTHORS.id, target_field: "name" };
export const TITLE_TO_LOG = { field: "title", capability: READING_LOG.id, target_field: "title" };
export const authorTo = (field: string): Relation => ({
  field: "author",
  to: { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, field },
});
export const BOOK_NOUNS = { noun: BOOKS.noun, plural: BOOKS.plural };
export const RESOLVING = INTENT_RESOLUTION_NARRATION.trim();

export function bookField(name: string): SpecField {
  const field = BOOKS.fields.find((each) => each.name === name);
  if (!field) throw new Error(`Books has no ${name} field`);
  return field;
}

export const isLinkPrompt = (prompt: string) => prompt.startsWith(LINK_STEP_PROMPT_PREFIX);

/** One scratch desk and the coordinator the app runs on it, which a test may replace. */
export interface LinkingDesk {
  readonly env: ScratchDbEnv;
  coordinator: MutationCoordinator;
}

/** Books and Authors on the desk, the authors seeded, and the books typed against them. */
export function freshDesk(books: readonly (readonly [string, string | null])[]): LinkingDesk {
  const env = createScratchDbEnv("omni-crud-linking-only-");
  install(env.conns, deskRow(BOOKS));
  install(env.conns, deskRow(AUTHORS));
  SEEDED_AUTHORS.forEach((name, index) => {
    env.conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name") VALUES (?, ?)', [
      `author-${index}`,
      name,
    ]);
  });
  books.forEach(([title, author], index) => {
    env.conns.readwrite.run('INSERT INTO "cap_books" ("id", "title", "author") VALUES (?, ?, ?)', [
      `book-${index}`,
      title,
      author,
    ]);
  });
  return { env, coordinator: createMutationCoordinator() };
}

/** Say `prompt` with Books standing in the window, `provider` answering every call. */
export async function start(desk: LinkingDesk, provider: Provider, prompt = "connect these") {
  const metrics = makeMetricsRecorder();
  const app = createTestApp({
    getProvider: () => provider,
    recordMetrics: metrics.recordMetrics,
    buildDatabases: desk.env.conns,
    artifactsRoot: desk.env.artifactsRoot,
    capabilityRouter: { databases: desk.env.conns },
    mutationCoordinator: desk.coordinator,
  });
  const standing = {
    [RESTORATION_CAPABILITY_ID_FIELD]: BOOKS.id,
    [RESTORATION_INCARNATION_ID_FIELD]: BOOKS_INCARNATION,
  };
  const jobId = buildJobIdFromSubscriber(
    await responseText(await postPrompt(app, prompt, standing)),
  );
  const streaming = readSse(await app.request(`/build/${jobId}/stream`));
  const heard = async () => {
    const events = collectSseEvents(await streaming);
    const preview = JSON.parse(lastEventData(events, "metrics-preview") || "null") as unknown;
    return { events, sentences: promptBarSentences(events), preview, metrics };
  };
  const cancel = () => app.request(`/build/${jobId}/cancel`, { method: "POST" });
  return { jobId, heard, cancel };
}

/** Everything one request said, and the last sentence on the prompt bar. */
export async function ask(desk: LinkingDesk, provider: Provider) {
  const run = await start(desk, provider);
  const heard = await run.heard();
  return { ...heard, jobId: run.jobId, said: heard.sentences.at(-1) };
}

/** The fake provider: the resolver answers `intent`, the link step answers `link`. */
export function answering(link: unknown, intent: IntentClassification = LINKING) {
  return makePromptBuildProvider(intent, undefined, undefined, { link });
}

/** `base`, with the link step's call answered by `link` instead. */
export function withLinkStep(base: Provider, link: () => GenerateResult<never>): Provider {
  return {
    generate: <T>(prompt: string, schema: ZodType<T>): GenerateResult<T> =>
      isLinkPrompt(prompt) ? link() : base.generate(prompt, schema),
  };
}

export function linkRows(desk: LinkingDesk): number {
  const row = desk.env.conns.readonly.query(`SELECT COUNT(*) AS n FROM ${LINK_TABLE}`).get();
  return (row as { n: number }).n;
}
