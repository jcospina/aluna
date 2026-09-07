// The developer-gated exercise of one question (PLAN, epic order: "6.3/01 stands up a
// developer-gated exercise of one loop turn behind `developerSurfacesEnabled()`"). 6.3/02
// turned that one turn into the loop, and this page runs the whole of it.
//
// **This is scaffolding, and its removal has an owner.** The module is invisible from
// 6.2/01 to 6.4/05, and rather than leave that integration gap unlit until the end, this
// page makes the loop exercisable against the real database the moment it can run. 6.4's
// issues read Aluna's sentences here before there is an answer window to read them in, and
// `6.5-the-answer-window/issues/05-the-scaffolding-comes-down.md` deletes it once 6.5/03
// has made the real path visible, re-homing every assertion that ran through it.
//
// **It watches the loop through `onStep` rather than reading the steps off the result.** A
// spent budget hands back a count and no rows on purpose (`question-loop.ts`), and a
// developer page is exactly the caller that would otherwise want that rule relaxed — so it
// collects what it shows as the loop runs, and the ending it renders is still the platform's
// own sentence rather than anything computed from what happened to have been read.
//
// **It is a developer's instrument, and it shows machinery.** Decision 15 governs what
// *Aluna says* — no SQL, no table name, no error string, no step count reaches a surface
// the user meets — and 6.5/03 is where that surface arrives. This one is behind the same
// gate that already withholds model ids, token counts, stage timings and absolute
// filesystem paths from a production bundle, and showing the statements is the only way to
// see what the loop did. Nothing here is reachable when `NODE_ENV` is `production`.
//
// It lives under `/demo/*`, the namespace ADR-0002 reserved for exactly this: "throwaway
// and freely removable". The page is self-contained — its style is inline, because a
// diagnostic page that goes blank when a stylesheet fails is a diagnostic that lies about
// the thing it is diagnosing.

import type { Hono } from "hono";
import { classifyIntent, type IntentClassification } from "../../../pipeline/intent/index.ts";
import { runDataQuery } from "../../../pipeline/query/data-query.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import type { ReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import {
  QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
  QUESTION_STEP_BUDGET,
  QUESTION_STEP_RESULT_CAP_BYTES,
  QUESTION_TOOLS,
  type QuestionLoopResult,
  type QuestionStep,
  questionEndingNarration,
  questionPayloadBytes,
  questionPayloadSpent,
  questionStepBytes,
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
 * What a step costs, against the two numbers the cap is made of (decision 12).
 *
 * The same two functions the turn measures with, so the page cannot report one thing while
 * the refusal was decided on another. A refused step still has a cost — its statement, its
 * bound values and the words it came back with are re-rendered into every later prompt — and
 * showing it as nothing would hide the number a developer opened this page to see.
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
    result.outcome === "rows"
      ? renderSection(`Rows (${result.rows.length})`, JSON.stringify(result.rows, null, 2))
      : renderSection("Statement failed", result.message, "failure"),
    renderSection("Payload", renderPayload(step, index, steps)),
  ].join("");
}

/** The heading a spent budget's ending renders under. Exported so a test can pin the whole
 * block rather than merely its presence: the ending must be Aluna's sentence and nothing
 * else, and a total assembled from the steps above it appearing beside her is the exact
 * failure decision 3 removed the table's ability to expose. */
export const BUDGET_SPENT_HEADING = "The reads ran out — what Aluna says";

/**
 * How the loop stopped. A spent budget renders the platform's own sentence and nothing else.
 */
function renderEnding(loop: QuestionLoopResult): string {
  if (loop.ending === "budget_spent") {
    return renderSection(
      BUDGET_SPENT_HEADING,
      questionEndingNarration("budget_spent") ?? "",
      "failure",
    );
  }
  return renderSection(
    "She stopped reading",
    "The model has what it needs. What she then says is 6.4's.",
  );
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
    "trimmed, and the model is told to narrow it. Scaffolding: this page comes down in 6.5/05.</p>",
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
    // likeliest developer failure of all — no API key — is a throw from this line, and this
    // page's whole premise is that a failure is something you read on it.
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
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Real provider calls sit behind this button — one to classify and up to
 * `QUESTION_STEP_BUDGET` more to run the loop — so a page on another origin must not be able
 * to press it. `form-action 'self'` governs where *our* pages may post, never where a
 * post may come from. A browser that sends `Sec-Fetch-Site` at all sends it on every
 * request, so absence means a client that is not a browser rather than a gap in the header.
 */
function isCrossSite(site: string | undefined): boolean {
  return site !== undefined && site !== "same-origin" && site !== "none";
}

/**
 * The submitted question, or the reason there is not one. Parsed behind a catch for the same
 * reason everything else here is: this page's premise is that a failure is something you
 * read on it, not a 500 in somebody's terminal.
 */
async function readQuestion(
  request: Request,
): Promise<{ question: string } | { question: string; failure: string }> {
  try {
    return { question: String((await request.formData()).get("question") ?? "").trim() };
  } catch (error) {
    return {
      question: "",
      failure: `That was not a form: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Registered unconditionally and gated per request, for the reason
 * `developerSurfacesEnabled` is read per call rather than at import: a guard frozen before
 * a test can set `NODE_ENV` is a guard nothing can prove, and one nothing can prove is free
 * to be deleted under a green suite.
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
