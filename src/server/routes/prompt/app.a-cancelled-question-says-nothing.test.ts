// What a question leaves behind when the person gives up on it (6.5/04, PLAN decisions 10, 27).
//
// The seam this suite exists for is the one a unit test cannot reach: the desk posts the run's
// cancel route, and that has to travel through the job's own cancellation into the read scope
// 6.2/03 built. `data-query.test.ts` proves what `scope.cancel()` does; this proves the desk can
// reach it at all, over the real routes, with the real pipeline in between.
//
// The other half of the claim is what the person is told, which is nothing: an abandoned question
// says nothing on its way out, and the question they asked instead answers.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import {
  QUESTION_COULD_NOT_FINISH,
  QUESTION_TURN_PROMPT_PREFIX,
} from "../../../runtime/query/index.ts";
import { catalogueWithRecords, NOTES_TABLE } from "../../../runtime/query/question.test-support.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

const FIRST = "which of my notes mention the garden?";
const SECOND = "how many notes do I have?";
const ANSWER = { answer: "You have three notes." };
const READ = { sql: `SELECT count(*) AS total FROM ${NOTES_TABLE}`, label: "counting" } as const;

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("aluna-question-cancelled-"));
  catalogueWithRecords(conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns });
});

/**
 * A model that parks the first question inside the loop and holds it there. The person gives up
 * while it is parked, which is the only moment a cancel has anything to stop.
 */
function parkingProvider(): { provider: Provider; parked: Promise<void>; release: () => void } {
  const staged = makeQuestionProvider({
    intent: DATA_QUERY_INTENT,
    asking: FIRST,
    reads: [READ],
    answer: ANSWER,
  });
  const arrived = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  return {
    parked: arrived.promise,
    release: () => held.resolve(),
    provider: {
      generate(prompt, schema) {
        const generated = staged.provider.generate(prompt, schema);
        // The classification goes straight through; the loop's own first turn is where the
        // question parks, which is the only moment a cancel has anything to stop.
        if (!prompt.startsWith(QUESTION_TURN_PROMPT_PREFIX)) return generated;
        const object = (async () => {
          arrived.resolve();
          await held.promise;
          return await generated.object;
        })();
        object.catch(() => undefined);
        return { ...generated, object };
      },
    } as Provider,
  };
}

/** Everything one run said, and the terminal it ended on. */
async function drain(app: ReturnType<typeof makeScratchApp>, jobId: string) {
  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
  return { fragments: eventData(events, "fragment"), done: eventData(events, "done") };
}

describe("a question the person gave up on", () => {
  test("says nothing on its way out, and the one asked instead answers", async () => {
    const parking = parkingProvider();
    const app = makeScratchApp(
      { dir, conns, artifactsRoot },
      parking.provider,
      makeMetricsRecorder().recordMetrics,
    );

    const jobId = buildJobIdFromSubscriber(await responseText(await postPrompt(app, FIRST)));
    const streaming = readSse(await app.request(`/build/${jobId}/stream`));
    await parking.parked;

    // The press: the same route the desk posts (`public/leaving-a-run.js`).
    expect((await app.request(`/build/${jobId}/cancel`, { method: "POST" })).status).toBe(202);
    parking.release();

    const abandoned = collectSseEvents(await streaming);
    const said = eventData(abandoned, "fragment");
    // Stopped, not broken. Nothing about it going wrong, nothing apologising, and no sentence
    // the platform reserves for a question it could not finish.
    expect(said).not.toContain(QUESTION_COULD_NOT_FINISH);
    expect(said.toLowerCase()).not.toContain("sorry");
    expect(said.toLowerCase()).not.toContain("error");
    expect(eventData(abandoned, "done")).toBe("error");

    // And the question they asked instead is answered, on a desk the abandoned one left nothing
    // of: the read gates it held are back, or this one could not have opened its own scope.
    const answering = makeQuestionProvider({
      intent: DATA_QUERY_INTENT,
      asking: SECOND,
      reads: [READ],
      answer: ANSWER,
    });
    const next = makeScratchApp(
      { dir, conns, artifactsRoot },
      answering.provider,
      makeMetricsRecorder().recordMetrics,
    );
    const secondId = buildJobIdFromSubscriber(await responseText(await postPrompt(next, SECOND)));
    const answered = await drain(next, secondId);
    expect(answered.fragments).toContain(ANSWER.answer);
    expect(answered.done).toBe("ok");
  });
});
