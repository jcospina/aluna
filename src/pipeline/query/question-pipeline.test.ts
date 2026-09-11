// The two endings whose words are nobody's but the platform's: a question that could not be
// finished, and a question that was stopped (6.5/03). Plus the guard around the narration seam.
//
// Driven straight at `streamQuestion` rather than through a route, because all three turn on state
// a drained stream cannot stage — a catalog that cannot be read at all, `isAborted()` already
// true, and a stream write that rejects. The whole path from the prompt bar is proven in
// `app.question-answered-in-the-window.test.ts`.

import { describe, expect, test } from "bun:test";
import { NO_TOKEN_USAGE } from "../../platform/provider/usage.ts";
import { QUESTION_COULD_NOT_FINISH } from "../../runtime/query/index.ts";
import { unescapeHtml } from "../../server/http/html.ts";
import { ANSWER_WINDOW_SAYING_ATTRIBUTE } from "../../server/http/index.ts";
import { intentClassificationSchema } from "../intent/index.ts";
import { A_DATA_QUERY_CLASSIFICATION } from "../intent/intent.test-support.ts";
import { carriedResolverMeasurement } from "../metrics-recorder.ts";
import { type QuestionPipelineInput, streamQuestion } from "./question-pipeline.ts";

/** The shared fixture, through the schema that makes it one — so a drift in either reddens here. */
const ASKED = intentClassificationSchema.parse(A_DATA_QUERY_CLASSIFICATION);

interface Staged {
  readonly aborted?: () => boolean;
  readonly send?: QuestionPipelineInput["send"];
}

/**
 * A question that cannot start: there is no catalog to read, so the scope throws before a single
 * generation. What it throws is a real `TypeError` naming the registry read that failed — which is
 * the point, because the sweep below runs over words this path genuinely produces.
 */
function askedInto(sent: [string, string][], staged: Staged = {}): QuestionPipelineInput {
  return {
    promptJobId: "question-1",
    resolution: {
      intent: ASKED,
      outcome: "non_build",
      catalogFingerprint: "sha256:none",
      resolver: carriedResolverMeasurement(ASKED, NO_TOKEN_USAGE, 0, "sha256:none", []),
    },
    question: "how many notes did I add last week?",
    provider: {
      generate() {
        throw new Error("no generation is reached on this path");
      },
    },
    readGates: {} as never,
    recordMetrics: (() => {}) as never,
    send:
      staged.send ??
      (async (event, data) => {
        sent.push([event, data]);
      }),
    isAborted: staged.aborted ?? (() => false),
    canPresent: () => true,
    mutationCoordinator: {
      withPlatformWrite: async (work: () => unknown) => work(),
    } as never,
    databases: { readonly: {}, readwrite: {} } as never,
    terminalPresenterTimeoutMs: 2_000,
  };
}

/** What reached the desk. The resolver measurement rides its own developer channel and carries
 * the intent's own name, which is engineering language and never rendered (ARCH §9.7). */
const wire = (sent: [string, string][]) =>
  sent
    .filter(([event]) => event === "fragment")
    .map(([, data]) => data)
    .join("\n");

/** Everything said in the answer window, decoded the way the desk reads it. */
function saidInTheAnswerWindow(sent: [string, string][]): readonly string[] {
  const said = wire(sent).matchAll(
    new RegExp(`<div ${ANSWER_WINDOW_SAYING_ATTRIBUTE}>(.*?)</div>`, "gs"),
  );
  return [...said].map((match) => unescapeHtml(match[1] ?? ""));
}

/** What the failure on this path actually carries, and none of which may reach the desk. */
const MACHINERY = ["database", "query", "SELECT", "registry", "TypeError", "not a function"];

describe("a question that did not reach an answer", () => {
  test("says it could not finish, and says that and nothing else", async () => {
    const sent: [string, string][] = [];
    expect(await streamQuestion(askedInto(sent))).toBe("terminal-sent");

    // Equality rather than containment: a sentence with the thrown reason appended would satisfy
    // a `toContain`, and that reason is exactly what decision 15 bans from the desk.
    expect(saidInTheAnswerWindow(sent)).toEqual([QUESTION_COULD_NOT_FINISH]);
    for (const word of MACHINERY) {
      expect({ leaked: word, present: wire(sent).includes(word) }).toEqual({
        leaked: word,
        present: false,
      });
    }
    expect(sent.at(-1)).toEqual(["done", "ok"]);
  });

  test("stopped is not broken: a cancelled question says nothing about going wrong", async () => {
    const sent: [string, string][] = [];
    expect(await streamQuestion(askedInto(sent, { aborted: () => true }))).toBe("terminal-sent");

    // The window keeps the last thing she said. A person who stopped their own question is not
    // owed a sentence about it failing, and the run ends where they stopped it.
    expect(saidInTheAnswerWindow(sent)).toEqual([]);
    expect(wire(sent)).not.toContain(QUESTION_COULD_NOT_FINISH);
    expect(sent.at(-1)).toEqual(["done", "error"]);
  });

  test("a frame that could not be delivered never ships its reason to the desk", async () => {
    // Without a guard a rejected write leaves `streamQuestion` through the pipeline's own catch,
    // which ships the reason on `build-error-preview` — the leak the whole sweep exists to stop.
    // Frame 1 is the measurement, 2 opens the window, 3 is the ending, 4 closes the stream.
    for (const breaks of [1, 2, 3, 4]) {
      const sent: [string, string][] = [];
      let frames = 0;
      const send: QuestionPipelineInput["send"] = async (event, data) => {
        frames += 1;
        if (frames === breaks) throw new Error(`the socket went away on frame ${breaks}`);
        sent.push([event, data]);
      };

      expect(await streamQuestion(askedInto(sent, { send }))).toBe("terminal-sent");
      expect({ breaks, leaked: wire(sent).includes("the socket went away") }).toEqual({
        breaks,
        leaked: false,
      });
    }
  });
});
