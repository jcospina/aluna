// A question through the real prompt path, and what the server has to show for it afterwards.
//
// The query-side suites prove the read loop creates nothing (`question-turn.test.ts`). This is the
// other half of 6.5/02's storage claim: the route the product actually runs — POST /prompt, the
// resolver, the deflection that opens the answer window — writes no answer text, no narration and
// no question anywhere a later visit could find it.
//
// One row is written, and it is the resolver's own best-effort measurement, the same row a refusal
// writes. What matters is what is in it, so the row is read back three ways: its schema is strict,
// so an added field is caught however it was encoded; every string it may hold is pinned to a shape
// the model did not choose; and the sentence itself is hunted across every cell in every table, in
// each form a leak would take. The measurement write is fired and not awaited, so every read here
// waits for it — otherwise the silence would be a race rather than a fact.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMetricsRecorder } from "../../../pipeline/metrics-recorder.ts";
import {
  carriedResolverMeasurementSchema,
  listIntentResolutionMetrics,
  questionCostSchema,
} from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { INTENT_RESOLUTION_METRICS_TABLE } from "../../../platform/persistence/table-names.ts";
import { resolveModel } from "../../../platform/provider/config.ts";
import {
  catalogueWithRecords,
  NOTES_CAPABILITY,
  NOTES_TABLE,
} from "../../../runtime/query/question.test-support.ts";
import {
  addedPaths,
  everythingStored,
  type PlatformStoreSweep,
  sweepPlatformStores,
} from "../../../runtime/query/store-sweep.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { escapeHtml } from "../../http/html.ts";
import { ANSWER_WINDOW_ATTRIBUTE } from "../../http/index.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

/** Deliberately carries an apostrophe and an ampersand: a stored copy would be escaped, and a
 * search for the plain sentence would walk past it. */
const QUESTION = "how many notes & letters did I write in July, and didn't finish?";

/**
 * Every shape a leak of the sentence would take. A row that carried the question would not
 * necessarily carry it in words: the way it gets written down is escaped, encoded, or as the head
 * of it, and a search for the sentence alone would read a base64 column as silence.
 */
const TRACES = [
  QUESTION,
  QUESTION.slice(0, 24),
  escapeHtml(QUESTION),
  btoa(QUESTION),
  encodeURIComponent(QUESTION),
  Buffer.from(QUESTION).toString("hex"),
];

let dir: string;
let path: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeEach(() => {
  ({ dir, path, conns, artifactsRoot } = createScratchDbEnv("omni-crud-question-store-"));
  // Two real collections with rows in them, so the question below runs to a real answer: a
  // question that stumbled would prove nothing was written by proving nothing happened.
  catalogueWithRecords(conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

/** Ask it for real, through the route the desk posts to, with the platform's own metrics writer. */
async function ask(question: string) {
  const { provider } = makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    reads: [{ sql: `SELECT count(*) AS total FROM ${NOTES_TABLE}`, label: "counting" }],
    answer: { answer: "I had a look at your notes — you wrote three in July." },
  });
  const app = makeScratchApp(
    { dir, conns, artifactsRoot },
    provider,
    createMetricsRecorder(conns.readwrite),
  );
  const jobId = buildJobIdFromSubscriber(await responseText(await postPrompt(app, question)));
  return collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
}

const measurements = () =>
  conns.readonly
    .query(`SELECT resolver_measurement FROM ${INTENT_RESOLUTION_METRICS_TABLE}`)
    .all() as { resolver_measurement: string }[];

/**
 * Wait for the writes a question fires and does not await. Without this every read below could
 * pass against a database nothing had reached yet, which is the shape of a proof that proves
 * nothing — and on a loaded machine, of a flake.
 */
async function settle(rows: number): Promise<{ resolver_measurement: string }[]> {
  for (let tries = 0; tries < 200 && measurements().length < rows; tries += 1) {
    await new Promise((wake) => setTimeout(wake, 5));
  }
  return measurements();
}

describe("the response carrying the question may not be stored", () => {
  test("the stream says no-store, not the framework's no-cache", async () => {
    // The one body on the desk that carries the user's own sentence. `no-cache` permits a browser
    // to store it and revalidate; `no-store` is what the other routes here say, and what a
    // disposable answer needs — otherwise the question outlives its window in a disk cache.
    const { provider } = makePromptBuildProvider(DATA_QUERY_INTENT);
    const app = makeScratchApp(
      { dir, conns, artifactsRoot },
      provider,
      makeMetricsRecorder().recordMetrics,
    );
    const jobId = buildJobIdFromSubscriber(await responseText(await postPrompt(app, QUESTION)));
    const response = await app.request(`/build/${jobId}/stream`);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("a question leaves nothing behind on the server", () => {
  test("the answer window opens, and the question is nowhere in the database", async () => {
    const events = await ask(QUESTION);
    await settle(1);

    // The question did reach the desk — otherwise the sweep below is about a run that never ran.
    expect(eventData(events, "fragment")).toContain(
      `${ANSWER_WINDOW_ATTRIBUTE}="${escapeHtml(QUESTION)}"`,
    );
    // And the sweep can see what this run did write, or the silence below would be its own doing.
    const stored = everythingStored(conns.readonly);
    expect(stored).toContain(DATA_QUERY_INTENT.type);
    for (const trace of TRACES)
      expect(stored, `the database holds "${trace}"`).not.toContain(trace);
  });

  test("no artifact, no file, and no table that was not there before", async () => {
    const before: PlatformStoreSweep = sweepPlatformStores(conns.readonly, path);
    await ask(QUESTION);
    await settle(1);
    const after = sweepPlatformStores(conns.readonly, path);

    expect(after.stores.map((store) => store.name)).toEqual(
      before.stores.map((store) => store.name),
    );
    expect(addedPaths(before, after)).toEqual([]);
  });

  test("one table changed, and only by the row the resolver always writes", async () => {
    // Compared by digest as well as by count: a question written into a row that already existed
    // would change no count at all, and the sweep computes the digest that catches exactly that.
    const before = sweepPlatformStores(conns.readonly, path);
    await ask(QUESTION);
    await settle(1);
    const after = sweepPlatformStores(conns.readonly, path);

    const changed = after.stores.filter((store) => {
      const was = before.stores.find((store_) => store_.name === store.name);
      return was?.rows !== store.rows || was?.digest !== store.digest;
    });
    expect(changed.map((store) => store.name)).toEqual([INTENT_RESOLUTION_METRICS_TABLE]);
    expect(changed[0]?.rows).toBe(1);
  });

  test("and a digest is what catches a question written into a row that already exists", async () => {
    // The control for the arm above. An edit inside an existing row moves no count, so a
    // comparison on counts alone would call a question written into one of them silence.
    await ask(QUESTION);
    await settle(1);
    const before = sweepPlatformStores(conns.readonly, path);
    conns.readwrite.run(`UPDATE ${INTENT_RESOLUTION_METRICS_TABLE} SET outcome = 'cancelled'`);
    const after = sweepPlatformStores(conns.readonly, path);

    const held = (sweep: PlatformStoreSweep) =>
      sweep.stores.find((store) => store.name === INTENT_RESOLUTION_METRICS_TABLE);
    expect(held(after)?.rows).toBe(held(before)?.rows);
    expect(held(after)?.digest).not.toBe(held(before)?.digest);
  });

  test("the row carries the fields its schema names and not one more", async () => {
    // Looking for the sentence catches a leak written in plain text; this catches one written in
    // any form at all. The measurement is validated where it is built and stringified where it is
    // written, so a field added at the write site reaches the database unchecked — and comes back
    // through a strict schema, which is where it is caught, encoded or not.
    await ask(QUESTION);
    const stored = await settle(1);

    expect(stored).toHaveLength(1);
    expect(() =>
      carriedResolverMeasurementSchema.parse(JSON.parse(stored[0]?.resolver_measurement ?? "null")),
    ).not.toThrow();
  });

  test("and what it cost is two integers the database itself keeps that way", async () => {
    // The half of the row 6.6/04 added, read where it is stored rather than where it was built,
    // so the two cells are proved integers by the database and not by the shape they came from.
    await ask(QUESTION);
    await settle(1);

    const cells = conns.readonly
      .query(
        `SELECT typeof(steps_taken) AS steps, typeof(elapsed_ms) AS elapsed
         FROM ${INTENT_RESOLUTION_METRICS_TABLE}`,
      )
      .all();
    expect(cells).toEqual([{ steps: "integer", elapsed: "integer" }]);
    // And back through the strict schema, so the cost is those two keys and no third.
    const [row] = listIntentResolutionMetrics(conns.readonly);
    expect(() => questionCostSchema.parse(row?.question)).not.toThrow();
  });

  test("and every word in it is one the model did not choose", async () => {
    // The strict schema stops a new field; it does not stop a sentence smuggled inside an allowed
    // one. So each string the row may hold is pinned: the model name is the configured one, the
    // fingerprint is a digest, and the target is an id off this desk — the registry's own word,
    // never anything the model wrote — or null when it named nothing that exists.
    await ask(QUESTION);
    const stored = await settle(1);
    const measurement = carriedResolverMeasurementSchema.parse(
      JSON.parse(stored[0]?.resolver_measurement ?? "null"),
    );

    expect(measurement.model).toBe(resolveModel());
    expect(measurement.catalogFingerprint ?? "sha256:").toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(measurement.intent.targetCapability).toBe(NOTES_CAPABILITY.id);
  });

  test("asking twice runs twice and remembers neither, so no answer accumulates", async () => {
    // The property ADR-0008 names: there is no conversation thread. Two askings of the same
    // sentence leave two measurements and nothing that could be read back as a history.
    await ask(QUESTION);
    await ask(QUESTION);
    expect(await settle(2)).toHaveLength(2);

    const stored = everythingStored(conns.readonly);
    expect(stored).toContain(DATA_QUERY_INTENT.type);
    for (const trace of TRACES)
      expect(stored, `the database holds "${trace}"`).not.toContain(trace);
  });
});
