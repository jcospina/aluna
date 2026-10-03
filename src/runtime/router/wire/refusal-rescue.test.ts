// htmx will not swap a 4xx or 5xx unless the shell claims it, and `public/app.js` claims a refusal
// by its marker. These drive the real shell glue with the bodies the server's own producers write,
// so a refusal that is written and never reaches a screen fails here rather than live.

import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Context, Hono } from "hono";
import { CAPABILITY_LOGO_SELECTOR } from "#shell/desk/window/desk-window.js";
import { renderCapabilityRenameRefusal } from "../../../lifecycle/rename/presentation.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { BEHAVIORAL_ERROR_MARKERS, PLATFORM_OWNED_ERROR_CODES } from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import { unescapeHtml } from "../../../server/http/html.ts";
import { PROMPT_REFUSAL_ATTRIBUTE } from "../../../server/http/index.ts";
import { createTestApp } from "../../../server/isolated-app.test-support.ts";
import {
  answerArrives,
  desk,
  El,
} from "../../../server/shell-glue/app.shell-double.test-support.ts";
import {
  ChoiceDisabledError,
  InvalidChoiceError,
  InvalidFileReferenceError,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  RecordChangedError,
  RecordNotFoundError,
  TooManyFilesError,
} from "../../data/index.ts";
import { setupRouterTest, teardownRouterTest } from "../dispatch/router.test-support.ts";
import {
  choiceDisabledFailure,
  formChangedFailure,
  INTERNAL_ERROR_FRAGMENT,
  internalFailure,
  invalidChoiceFailure,
  invalidFileReferenceFailure,
  maxLengthExceededFailure,
  missingRequiredFieldsFailure,
  readUnavailable,
  recordChangedFailure,
  recordMutationRefusal,
  recordNotFoundFailure,
  tooManyFilesFailure,
  WIRE_PROTOCOL_ERROR_FRAGMENT,
} from "./failure-responses.ts";
import { answerWithHandlerFragment } from "./handler-response.ts";
import { FormChangedError } from "./wire-protocol.ts";

const { code_attribute, role_attribute, role, fields_attribute } = BEHAVIORAL_ERROR_MARKERS;
const OWN_CODE = "duplicate_entry";
const OWN_SENTENCE = "That note is already here.";
const UPDATE_ONLY_CODE = "already_archived";
const capabilityOwnRefusal = `<div ${code_attribute}="${OWN_CODE}" ${role_attribute}="${role}"><span>${OWN_SENTENCE}</span></div>`;
const declaring = notesSpec({
  behavioral_errors: [
    ...notesSpec().behavioral_errors,
    {
      action: "create",
      trigger: "a note with the same text already exists",
      code: OWN_CODE,
      fields: ["text"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
    {
      action: "update",
      trigger: "the note was archived",
      code: UPDATE_ONLY_CODE,
      fields: ["text"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    },
  ],
});

/** What the router answers when the create Handler returns `fragment`. */
function handlerAnswers(fragment: string): Promise<Answer> {
  return answered((c) =>
    answerWithHandlerFragment(c, "notes", declaring, "create", fragment, () => ""),
  );
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

/** One answer exactly as a producer writes it: its status and its body, through Hono. */
async function answered(produce: (c: Context) => Response): Promise<Answer> {
  const response = await new Hono().get("/", produce).request("/");
  return { status: response.status, body: await response.text() };
}

/** Every shown refusal the server has a producer for, each at the status it is sent with. */
async function everyShownRefusal(databases: PlatformDatabase): Promise<readonly Answer[]> {
  const app = createTestApp({ capabilityRouter: { databases } });
  const notFound = await app.request("/capability/does-not-exist", {
    headers: { "HX-Request": "true" },
  });
  return [
    { status: notFound.status, body: await notFound.text() },
    ...(await Promise.all([
      answered((c) =>
        missingRequiredFieldsFailure(c, "notes", new MissingRequiredFieldsError("notes", ["text"])),
      ),
      answered((c) => invalidChoiceFailure(c, "notes", new InvalidChoiceError("notes", ["stage"]))),
      answered((c) =>
        choiceDisabledFailure(c, "notes", new ChoiceDisabledError("notes", ["stage"], "update")),
      ),
      answered((c) =>
        maxLengthExceededFailure(c, "notes", new MaxLengthExceededError("notes", ["text"])),
      ),
      answered((c) =>
        invalidFileReferenceFailure(
          c,
          "notes",
          new InvalidFileReferenceError("notes", { photo: "unknown" }, "create"),
        ),
      ),
      answered((c) => recordChangedFailure(c, "notes", new RecordChangedError("notes", ["photo"]))),
      answered((c) =>
        formChangedFailure(c, "notes", "Notes", new FormChangedError("update", ["photo"])),
      ),
      answered((c) =>
        tooManyFilesFailure(
          c,
          "notes",
          new TooManyFilesError("notes", { album: { count: 7, cap: 6 } }, "update"),
        ),
      ),
      answered((c) =>
        recordNotFoundFailure(c, "notes", "update", new RecordNotFoundError("notes", "update")),
      ),
      answered((c) => recordMutationRefusal(c, "notes", "create")),
      answered((c) => readUnavailable(c)),
      answered((c) => readUnavailable(c, "notes", "create")),
      answered((c) => internalFailure(c, "notes", "create", new Error("boom"))),
      // A capability's own declared refusal, marked as a model writes it: its own element and
      // attribute order, with the sentence nested.
      handlerAnswers(capabilityOwnRefusal),
      // The two statuses `src/lifecycle/rename/http.ts` sends these with.
      answered((c) => c.html(renderCapabilityRenameRefusal({ status: "refused" }), 422)),
      answered((c) => c.html(renderCapabilityRenameRefusal({ status: "stale" }), 409)),
    ])),
  ];
}

/** The code a refusal carries and the sentence it says, read the way a parser reads them. */
async function markerOf({ body }: Answer): Promise<{ code: string | null; sentence: string }> {
  let code: string | null = null;
  let words = "";
  await new HTMLRewriter()
    .on(`[${BEHAVIORAL_ERROR_MARKERS.code_attribute}]`, {
      element(element) {
        code = element.getAttribute(BEHAVIORAL_ERROR_MARKERS.code_attribute);
      },
      text(chunk) {
        words += chunk.text;
      },
    })
    .transform(new Response(body))
    .text();
  return { code, sentence: unescapeHtml(words.trim()) };
}

/** A refusal htmx swaps where it was aimed, still counted a failure. */
const SWAPPED_FAILURE = { swapped: true, successful: false };
/** A failure htmx keeps off the page: said on the bar when it is a refusal, or dropped. */
const UNSWAPPED_FAILURE = { swapped: false, successful: false };

/** A capability's logo on the desk, marked the way the shell's own selector finds one. */
function logo(): El {
  const name = /^\[([\w-]+)\]$/.exec(CAPABILITY_LOGO_SELECTOR)?.[1];
  if (name === undefined)
    throw new Error(`not a bare attribute selector: ${CAPABILITY_LOGO_SELECTOR}`);
  return new El("button", { [name]: "" });
}

function formInTheWindow(scene: ReturnType<typeof desk>): El {
  const form = new El("form", { id: "notes-create" });
  scene.region.append(form);
  return form;
}

describe("every refusal the server shows reaches a screen", () => {
  let refusals: readonly Answer[];

  beforeEach(async () => {
    const { dir, conns } = setupRouterTest();
    // `internalFailure` logs the developer's half; the person's half is what is under test.
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      refusals = await everyShownRefusal(conns);
    } finally {
      quiet.mockRestore();
      teardownRouterTest(dir, conns);
    }
  });

  test("there is a producer here for every code the platform owns", async () => {
    const codes = new Set((await Promise.all(refusals.map(markerOf))).map(({ code }) => code));

    for (const code of PLATFORM_OWNED_ERROR_CODES) expect(codes).toContain(code);
    for (const refusal of refusals) expect(refusal.status).toBeGreaterThanOrEqual(400);
  });

  test("in the window, where the router aimed it, when the window asked", () => {
    for (const refusal of refusals) {
      const scene = desk();

      // Swapped, and still a failure to htmx: a success would clear the typed values it keeps.
      expect({ refusal, answer: answerArrives(scene, formInTheWindow(scene), refusal) }).toEqual({
        refusal,
        answer: { swapped: true, successful: false },
      });
      expect(scene.notice.textContent).toBe("");
    }
  });

  test("on the prompt bar, in its own words, when something on the desk asked", async () => {
    for (const refusal of refusals) {
      const scene = desk();
      const { sentence } = await markerOf(refusal);

      expect(answerArrives(scene, logo(), refusal)).toEqual({ swapped: false, successful: false });
      expect({ refusal, spoken: scene.notice.textContent }).toEqual({ refusal, spoken: sentence });
      expect(scene.notice.querySelector(`[${PROMPT_REFUSAL_ATTRIBUTE}]`)).not.toBeNull();
      expect(scene.region.childNodes).toEqual([scene.displaced, scene.subscriber]);
    }
  });
});

describe("a capability's own refusal", () => {
  const nested = {
    "inside a template": `<template>${capabilityOwnRefusal}</template>`,
    "inside a select": `<select>${capabilityOwnRefusal}</select>`,
    "among other markup": `<section><h2>Save</h2>${capabilityOwnRefusal}<p>More</p></section>`,
  };

  test.each(
    Object.entries(nested),
  )("reaches the person %s, in its own words", async (_, fragment) => {
    const answer = await handlerAnswers(fragment);
    const window = desk();
    const bar = desk();

    expect(answer.status).toBe(422);
    expect(await markerOf(answer)).toEqual({ code: OWN_CODE, sentence: OWN_SENTENCE });
    expect(answerArrives(window, formInTheWindow(window), answer)).toEqual(SWAPPED_FAILURE);
    expect(answerArrives(bar, new El("button"), answer)).toEqual(UNSWAPPED_FAILURE);
    expect(bar.notice.textContent).toBe(OWN_SENTENCE);
  });

  test("ends its words where a browser ends the element, closed or not", async () => {
    const marks = `${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}"`;
    const [first, middle, last] = [
      OWN_SENTENCE.slice(0, 5),
      OWN_SENTENCE.slice(5, 10),
      OWN_SENTENCE.slice(10),
    ];
    for (const fragment of [
      `<p ${marks}>${OWN_SENTENCE}<p>Your draft is kept below.</p>`,
      `<ul><li ${marks}>${OWN_SENTENCE}<li>Second item</li></ul><p>Footer text</p>`,
      `<div><p ${marks}>${OWN_SENTENCE}</div>Tail text`,
      `<p ${marks}>${first}<b>${middle}</b>${last}</p><p>After</p>`,
      `<b>Heads up:</b> <span ${marks}>${OWN_SENTENCE}</span>`,
      `<p>Heads up: <span ${marks}>${OWN_SENTENCE}</span> Your draft is kept.</p>`,
      `<div><p>Heads up: <span ${marks}>${OWN_SENTENCE}</p> Your draft is kept.</div>`,
    ]) {
      const { sentence } = await markerOf(await handlerAnswers(fragment));
      expect({ fragment, sentence }).toEqual({ fragment, sentence: OWN_SENTENCE });
    }
  });

  test("words a raw-text element holds never become markup", async () => {
    const smuggled = `<p ${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}"><textarea></p><img src=x onerror=alert(1)></textarea></p>`;
    const answer = await handlerAnswers(smuggled);

    expect(answer.status).toBe(422);
    expect(answer.body).not.toContain("<img");
    expect((await markerOf(answer)).sentence).toContain("<img src=x onerror=alert(1)>");
  });

  test("a refusal with no words still says something", async () => {
    const answer = await handlerAnswers(
      `<p ${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}"> </p>`,
    );
    const bar = desk();

    expect(answerArrives(bar, new El("button"), answer)).toEqual(UNSWAPPED_FAILURE);
    expect(bar.notice.textContent).not.toBe("");
  });

  test("only both markers on one element, with a code this Action declared, refuse", async () => {
    for (const notRefusing of [
      capabilityOwnRefusal.replace(OWN_CODE, "made_up"),
      capabilityOwnRefusal.replace(OWN_CODE, UPDATE_ONLY_CODE),
      `<p ${code_attribute}="${OWN_CODE}">${OWN_SENTENCE}</p>`,
      `<div ${role_attribute}="${role}"><p ${code_attribute}="${OWN_CODE}">${OWN_SENTENCE}</p></div>`,
    ]) {
      expect({ notRefusing, status: (await handlerAnswers(notRefusing)).status }).toEqual({
        notRefusing,
        status: 200,
      });
    }
  });

  test("the first refusal speaks, naming the fields it named", async () => {
    const second = `<p ${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}">Another thing.</p>`;
    const named = capabilityOwnRefusal.replace(
      `${role_attribute}="${role}"`,
      `${role_attribute}="${role}" ${fields_attribute}="text  title"`,
    );
    const answer = await handlerAnswers(
      `${named.replace(OWN_SENTENCE, `\n  ${OWN_SENTENCE.replace(" ", " \n\t ")}  `)}${second}`,
    );

    expect(await markerOf(answer)).toEqual({ code: OWN_CODE, sentence: OWN_SENTENCE });
    expect(answer.body).toContain(`${fields_attribute}="text title"`);
  });

  test("a marker on an element that holds nothing takes none of what follows it", async () => {
    const empty = `<img ${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}"><p>${OWN_SENTENCE}</p>`;
    const { sentence } = await markerOf(await handlerAnswers(empty));

    expect(sentence).not.toBe("");
    expect(sentence).not.toContain(OWN_SENTENCE);
  });
});

describe("what the shell leaves to htmx", () => {
  test("a failure with no marker is not a refusal anyone was meant to read", async () => {
    for (const unmarked of [
      await answered((c) => c.html(INTERNAL_ERROR_FRAGMENT, 500)),
      await answered((c) => c.html(WIRE_PROTOCOL_ERROR_FRAGMENT, 422)),
      await answered((c) => c.html(INTERNAL_ERROR_FRAGMENT, 409)),
      ...(await Promise.all(
        [
          `<p ${code_attribute}="${OWN_CODE}">${OWN_SENTENCE}</p>`,
          `<p ${role_attribute}="${role}">${OWN_SENTENCE}</p>`,
          `<div ${role_attribute}="${role}"><p ${code_attribute}="${OWN_CODE}">${OWN_SENTENCE}</p></div>`,
          `<p title="${role_attribute}=&quot;${role}&quot; ${code_attribute}=&quot;x&quot;">${OWN_SENTENCE}</p>`,
          `<p>${role_attribute}="${role}" ${code_attribute}="${OWN_CODE}"</p>`,
        ].map((body) => answered((c) => c.html(body, 422))),
      )),
    ]) {
      const scene = desk();

      expect(answerArrives(scene, formInTheWindow(scene), unmarked)).toEqual(UNSWAPPED_FAILURE);
      expect(scene.notice.textContent).toBe("");
    }
  });

  test("a marked body at a status htmx already swaps, or one no refusal is sent at, is left alone", async () => {
    const refusal = await answered((c) => recordMutationRefusal(c, "notes", "create"));

    for (const status of [200, 400, 401, 403, 502]) {
      const scene = desk();

      expect(answerArrives(scene, formInTheWindow(scene), { ...refusal, status })).toEqual({
        swapped: false,
        successful: status === 200,
      });
    }
  });

  test("a refusal whose sentence cannot be read still lands where it was aimed", async () => {
    const scene = desk();
    const { status, body } = await answered((c) => recordMutationRefusal(c, "notes", "create"));
    const silent = { status, body: body.replace(/>[^<]*</, "><") };

    expect(answerArrives(scene, new El("button"), silent)).toEqual(SWAPPED_FAILURE);
    expect(scene.notice.textContent).toBe("");
  });

  test("the bar speaks the sentence without the whitespace around it", async () => {
    const { status, body } = await answered((c) => recordMutationRefusal(c, "notes", "create"));
    const { sentence } = await markerOf({ status, body });
    const padded = { status, body: body.replace(/>([^<]*)</, ">\n   $1 \n<") };
    const blank = { status, body: body.replace(/>[^<]*</, ">  \n <") };
    const scene = desk();

    expect(answerArrives(scene, new El("button"), padded)).toEqual(UNSWAPPED_FAILURE);
    expect(scene.notice.textContent).toBe(sentence);
    expect(answerArrives(desk(), new El("button"), blank)).toEqual(SWAPPED_FAILURE);
  });

  test("a request that recorded no asker is answered where it was aimed", async () => {
    const scene = desk();
    const { status, body } = await answered((c) => recordMutationRefusal(c, "notes", "create"));
    const detail = { xhr: { status, responseText: body }, shouldSwap: false };

    scene.fire("htmx:beforeSwap", { detail });

    expect(detail.shouldSwap).toBe(true);
  });

  test("a swap with nothing on the wire behind it is none of the rescue's business", () => {
    const scene = desk();

    for (const detail of [undefined, {}, { xhr: undefined }]) {
      expect(() => scene.fire("htmx:beforeSwap", { detail })).not.toThrow();
    }
  });

  test("a body that is not text is left alone", () => {
    const scene = desk();
    const detail = { xhr: { status: 422, responseText: null }, shouldSwap: false };

    scene.fire("htmx:beforeSwap", { detail });

    expect(detail.shouldSwap).toBe(false);
  });
});
