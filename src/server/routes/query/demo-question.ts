// The developer-gated exercise of one question (PLAN, 6.3/01). 6.3/02 turned that turn into the
// loop, and this page runs the whole of it.
//
// Scaffolding with a named owner: the module is invisible from 6.2/01 to 6.4/05, so the page makes
// the loop exercisable against the real database meanwhile. 6.5/05 deletes it once 6.5/03 has made
// the real path visible, re-homing every assertion that ran through it.
//
// It watches the loop through `onStep` rather than reading steps off the result: a spent budget
// hands back a count and no rows on purpose (`question-loop.ts`), and the page renders the
// platform's own ending sentence rather than a total computed from what was read (decision 15).
//
// Unreachable when `NODE_ENV` is `production`, and it lives under `/demo/*` (ADR-0002). Its style
// is inline: a diagnostic page that goes blank when a stylesheet fails lies about what it says.

import type { Hono } from "hono";
import { classifyIntent, type IntentClassification } from "../../../pipeline/intent/index.ts";
import { runDataQuery } from "../../../pipeline/query/data-query.ts";
import { errorMessage } from "../../../platform/errors.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import type { ReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import {
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_NO_HOME_FOR_THAT,
  QUESTION_NOTHING_FOUND,
  QUESTION_NOTHING_WORKED,
  QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
  QUESTION_STEP_BUDGET,
  QUESTION_STEP_LABELS,
  QUESTION_STEP_RESULT_CAP_BYTES,
  QUESTION_TOOLS,
  type QuestionLoopResult,
  type QuestionStep,
  questionLabelNarration,
  questionPayloadBytes,
  questionPayloadSpent,
  questionStepBytes,
  questionStepMatchedRows,
  questionStepNarration,
} from "../../../runtime/query/index.ts";
import { developerSurfacesEnabled } from "../../dev-surfaces/dev-surfaces.ts";
import { escapeHtml } from "../../http/html.ts";

export const DEMO_QUESTION_PATH = "/demo/question";

export interface DemoQuestionDeps {
  readonly getProvider: () => Provider;
  readonly readGates: ReadGateCoordinator;
  readonly registryReadonly: PlatformDatabase["readonly"];
}

interface QuestionExercise {
  readonly question: string;
  readonly intent?: IntentClassification;
  readonly steps: readonly QuestionStep[];
  readonly loop?: QuestionLoopResult;
  readonly failure?: string;
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 1.1rem; margin: 0 0 .35rem; }
  p.note { margin: 0 0 1.5rem; opacity: .7; max-width: 62ch; }
  form { margin-bottom: 2rem; }
  textarea { width: 100%; max-width: 62ch; min-height: 4.5rem; padding: .6rem; font: inherit; }
  button { margin-top: .6rem; padding: .45rem 1rem; font: inherit; }
  section { margin-bottom: 1.5rem; max-width: 100ch; }
  h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 0 0 .4rem; }
  pre { margin: 0; padding: .7rem .8rem; overflow-x: auto; border: 1px solid currentColor; }
  pre.failure { border-style: dashed; }
`;

/** The one class this page uses. A union rather than a string, so nothing can interpolate. */
type SectionClass = "failure";

function renderSection(heading: string, body: string, className?: SectionClass): string {
  return `<section><h2>${escapeHtml(heading)}</h2><pre${className ? ` class="${className}"` : ""}>${escapeHtml(body)}</pre></section>`;
}

function renderOfferedTools(): string {
  const body = QUESTION_TOOLS.map((tool) =>
    [tool.name, ...tool.description.map((line) => `  ${line}`)].join("\n"),
  ).join("\n");
  return renderSection(`Tools offered (${QUESTION_TOOLS.length})`, body);
}

/**
 * What a step costs, against the two numbers the cap is made of (decision 12) — the same two
 * functions the turn measures with. A refused step still costs; it rides into every later prompt.
 */
function renderPayload(step: QuestionStep, index: number, steps: readonly QuestionStep[]): string {
  const rows = step.result.outcome === "rows" ? questionPayloadBytes(step.result.rows) : 0;
  const spent = questionPayloadSpent(steps.slice(0, index + 1));
  return [
    `${rows} of ${QUESTION_STEP_RESULT_CAP_BYTES} bytes of rows`,
    `${questionStepBytes(step, index)} bytes into every later prompt`,
    `${spent} of ${QUESTION_RESULT_PAYLOAD_BUDGET_BYTES} spent by this question`,
  ].join("\n");
}

function renderStep(step: QuestionStep, index: number, steps: readonly QuestionStep[]): string {
  const { call, result } = step;
  const heading = `Step ${index + 1} of at most ${QUESTION_STEP_BUDGET}`;
  const asked =
    call === null
      ? [renderSection(heading, "no statement was recorded for this step", "failure")]
      : [
          renderSection(heading, `${call.tool}\n${call.sql}`),
          renderSection("Parameters", JSON.stringify(call.parameters)),
        ];
  return [
    ...asked,
    renderSection(STEP_NARRATION_HEADING, questionStepNarration(call)),
    renderSection(STEP_COLLECTIONS_HEADING, step.collections.join(", ") || NOTHING_OPENED),
    // A failed statement read nothing rather than matching nothing, so it gets no verdict here.
    ...(result.outcome === "rows"
      ? [
          renderSection(`Rows (${result.rows.length})`, JSON.stringify(result.rows, null, 2)),
          renderSection(STEP_MATCH, questionStepMatchedRows(step) ? ROWS_MATCHED : NOTHING_MATCHED),
        ]
      : [renderSection("Statement failed", result.message, "failure")]),
    renderSection("Payload", renderPayload(step, index, steps)),
  ].join("");
}

/** The heading the platform's own reading of a result renders under — decision 17's code check,
 * beside the rows it was made from, so a human at the gate can check one against the other. */
export const STEP_MATCH = "What the platform read off that";
export const ROWS_MATCHED = "rows matched";
export const NOTHING_MATCHED = "nothing matched";

/** The heading one step's sentence renders under. Exported so a test can pin the words that
 * appear beside a statement, rather than merely that the page mentions Aluna. */
export const STEP_NARRATION_HEADING = "What Aluna says";

/** The heading the collections a statement names render under — what 6.4/03's answer restates,
 * shown here so a human reading the answer can check it against what the statement reached for.
 * *Names*, not *read*: a statement refused for its size records these and never runs. */
export const STEP_COLLECTIONS_HEADING = "Collections the statement names";
const NOTHING_OPENED = "(none)";

/** The heading the whole vocabulary renders under — the block 6.3/04's sign-off gate reads. */
export const VOCABULARY_HEADING = "Everything Aluna says while she works";

const READS_SPENT_ROW = "(reads spent)";
const NOTHING_FOUND_ROW = "(nothing matched)";
const NOTHING_WORKED_ROW = "(nothing came back)";
/** The gap, with no subject in it: on a real question this person's own words stand there. */
const NO_HOME_ROW = "(nowhere for it)";

/**
 * Every sentence there is, rendered off `QUESTION_STEP_LABELS` so a seventh kind shows up the
 * moment it exists. The labels sit beside them because this is a developer's page.
 */
function renderVocabulary(): string {
  const width = Math.max(
    READS_SPENT_ROW.length,
    NOTHING_FOUND_ROW.length,
    NOTHING_WORKED_ROW.length,
    NO_HOME_ROW.length,
    ...QUESTION_STEP_LABELS.map((l) => l.length),
  );
  const said = (key: string, sentence: string) => `${key.padEnd(width)}  ${sentence}`;
  return renderSection(
    VOCABULARY_HEADING,
    [
      ...QUESTION_STEP_LABELS.map((label) => said(label, questionLabelNarration(label))),
      said(READS_SPENT_ROW, QUESTION_BUDGET_SPENT_SENTENCE),
      said(NOTHING_FOUND_ROW, QUESTION_NOTHING_FOUND),
      said(NOTHING_WORKED_ROW, QUESTION_NOTHING_WORKED),
      said(NO_HOME_ROW, QUESTION_NO_HOME_FOR_THAT),
    ].join("\n"),
  );
}

/** The heading the answer renders under. Exported so a test can pin the block a person reads,
 * which is the one thing on this page written out of the steps rather than off a label. */
export const ANSWER_HEADING = "What Aluna found";

/** The heading a spent budget's ending renders under. Exported so a test can pin the whole block
 * rather than its presence: the ending must be Aluna's sentence and nothing else (decision 3). */
export const BUDGET_SPENT_HEADING = "The reads ran out — what Aluna says";

/** The heading a question that matched nothing renders under. Its own, so the gate reads the two
 * endings apart: this sentence is the platform's, and the one under `ANSWER_HEADING` is the
 * model's. A question whose statements never came back searched nothing and gets a third. */
export const NOTHING_FOUND_HEADING = "Nothing matched — what Aluna says";
export const NOTHING_WORKED_HEADING = "Nothing came back — what Aluna says";

/** The heading the gap renders under (decision 20). A fourth, because this ending is about the
 * desk rather than about one search of it — and what renders under it is a sentence and nothing
 * else: no button, no link, no control that could accept an offer. That surface is M8's. */
export const NO_HOME_HEADING = "Nowhere for it — what Aluna says";

/**
 * How the loop stopped. A spent budget renders the platform's own sentence and nothing else.
 */
function renderEnding(loop: QuestionLoopResult): string {
  if (loop.ending === "budget_spent") {
    // The constant rather than `questionEndingNarration`, whose `string | null` would let the
    // one thing this block exists to show render as an empty box.
    return renderSection(BUDGET_SPENT_HEADING, QUESTION_BUDGET_SPENT_SENTENCE, "failure");
  }
  if (loop.ending === "nothing_worked") {
    return renderSection(NOTHING_WORKED_HEADING, loop.answer, "failure");
  }
  // Rendered like an answer rather than like a failure: nothing went wrong, and the one thing
  // this block may hold is the sentence.
  if (loop.ending === "no_home") return renderSection(NO_HOME_HEADING, loop.answer);
  const heading = loop.ending === "nothing_found" ? NOTHING_FOUND_HEADING : ANSWER_HEADING;
  return renderSection(heading, loop.answer);
}

function renderExercise(exercise: QuestionExercise): string {
  if (exercise.failure) return renderSection("The question ended", exercise.failure, "failure");
  const parts: string[] = [];
  if (exercise.intent) {
    parts.push(
      renderSection(
        "Classification",
        `${exercise.intent.type} (confidence ${exercise.intent.confidence})`,
      ),
    );
  }
  parts.push(renderOfferedTools());
  parts.push(...exercise.steps.map(renderStep));
  if (exercise.loop) parts.push(renderEnding(exercise.loop));
  return parts.join("");
}

function renderPage(exercise?: QuestionExercise): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>One question, start to finish — developer exercise</title>",
    `<style>${PAGE_STYLE}</style>`,
    "</head><body>",
    "<h1>One question, start to finish</h1>",
    '<p class="note">Ask something about what is saved on this desk. The prompt is classified, ',
    "a whole-catalog read scope opens, and the model is offered one tool and up to ",
    `${QUESTION_STEP_BUDGET} reads — it decides each next step until it has enough or the `,
    "reads run out. Nothing is timed. A read that comes back too large is refused whole, never ",
    "trimmed, and the model is told to narrow it. The statements count and total; when the model ",
    "stops reading, its answer is written from what they returned and nothing else. A question ",
    "whose steps matched no rows is not written by the model at all: the platform says it could ",
    "not find anything, because a zero it never matched is not a fact about you. A question this ",
    "desk holds nowhere for ends with the gap named and nothing to press. ",
    "Scaffolding: this page comes down in 6.5/05.</p>",
    renderVocabulary(),
    `<form method="post" action="${DEMO_QUESTION_PATH}">`,
    `<textarea name="question" placeholder="how many notes did I write last month?">${escapeHtml(exercise?.question ?? "")}</textarea>`,
    '<br><button type="submit">Run the loop</button>',
    "</form>",
    exercise ? renderExercise(exercise) : "",
    "</body></html>",
  ].join("");
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function runExercise(deps: DemoQuestionDeps, question: string): Promise<QuestionExercise> {
  const steps: QuestionStep[] = [];
  try {
    // Inside the catch, not before it: `createProvider` resolves its config eagerly, so the
    // likeliest developer failure of all — no API key — is a throw from this line.
    const provider = deps.getProvider();
    const intent = await classifyIntent({
      provider,
      prompt: question,
      database: deps.registryReadonly,
    });
    if (intent.type !== "data_query") {
      return { question, intent, steps };
    }
    const loop = await runDataQuery(
      { provider, readGates: deps.readGates, database: deps.registryReadonly },
      { intent, question, onStep: (step) => steps.push(step) },
    );
    return { question, intent, steps, loop };
  } catch (error) {
    return {
      question,
      steps,
      failure: errorMessage(error),
    };
  }
}

/**
 * Real provider calls sit behind this button, so another origin must not press it. A browser that
 * sends `Sec-Fetch-Site` sends it on every request, so absence means a non-browser client.
 */
function isCrossSite(site: string | undefined): boolean {
  return site !== undefined && site !== "same-origin" && site !== "none";
}

/**
 * The submitted question, or the reason there is not one. Parsed behind a catch for the reason
 * everything else here is: a failure is something you read on the page, not a 500 in a terminal.
 */
async function readQuestion(
  request: Request,
): Promise<{ question: string } | { question: string; failure: string }> {
  try {
    return { question: String((await request.formData()).get("question") ?? "").trim() };
  } catch (error) {
    return {
      question: "",
      failure: `That was not a form: ${errorMessage(error)}`,
    };
  }
}

/**
 * Registered unconditionally and gated per request, for the reason `developerSurfacesEnabled` is
 * read per call: a guard frozen before a test can set `NODE_ENV` is free to be deleted green.
 */
export function registerDemoQuestionRoutes(app: Hono, deps: DemoQuestionDeps): void {
  app.get(DEMO_QUESTION_PATH, (c) => {
    if (!developerSurfacesEnabled()) return c.notFound();
    return htmlResponse(renderPage());
  });

  app.post(DEMO_QUESTION_PATH, async (c) => {
    if (!developerSurfacesEnabled()) return c.notFound();
    if (isCrossSite(c.req.header("sec-fetch-site"))) {
      return c.text("Forbidden", 403, { "cache-control": "no-store" });
    }
    const submitted = await readQuestion(c.req.raw);
    if ("failure" in submitted) return htmlResponse(renderPage({ ...submitted, steps: [] }));
    if (submitted.question.length === 0) return htmlResponse(renderPage());
    return htmlResponse(renderPage(await runExercise(deps, submitted.question)));
  });
}
