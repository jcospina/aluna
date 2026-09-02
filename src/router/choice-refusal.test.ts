// The wire answer to an undeclared choice value: a typed 422 that names the field, from
// the platform, before any generated Handler runs and before canonical state moves.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createApp } from "../app/app.ts";
import { applyCapabilityTableDdl } from "../capability-data/index.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import type { ChoiceOption } from "../registry/index.ts";
import type { CapabilityCreateContext } from "./index.ts";
import {
  createCapabilityDataTool,
  install,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";

const STAGE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

/** The notes fixture with one active choice field beside its text. */
function stagedNotesSpec(values: readonly ChoiceOption[] = STAGE_OPTIONS) {
  const base = notesSpec();
  return notesSpec({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle: "active",
          values: [...values],
          groups: [],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: [{ field: "stage", presentation: "picker" }],
        long_text: [],
        guidance: [],
      },
    },
  });
}

/** Create requires a presence marker per active field, exactly as the drawn form emits. */
function stagedBody(stage: string): RequestInit {
  const body = new URLSearchParams({ text: "A note", stage });
  for (const field of ["text", "pinned", "stage"]) body.append("__aluna_present", field);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

describe("an undeclared choice value on the wire", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let handlerRuns = 0;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    handlerRuns = 0;
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  function appForStagedNotes(spec = stagedNotesSpec(), onLoad: () => void = () => {}) {
    install(conns, notesRow(spec));
    applyCapabilityTableDdl(spec, conns.readwrite);
    return createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler: async () => {
          // Counted here rather than inside the Handler: what the test below asserts is
          // that the Handler is never even loaded.
          onLoad();
          return async ({ input, mutation, present }: CapabilityCreateContext) => {
            handlerRuns += 1;
            return present(
              mutation.create({
                text: input.values.text,
                pinned: false,
                stage: input.values.stage,
              }),
            );
          };
        },
        loadItemRenderer: async () => (record) => `<span>${String(record.text)}</span>`,
      },
    });
  }

  test("is refused as a typed invalid_choice naming its field, and stores nothing", async () => {
    const app = appForStagedNotes();

    const response = await app.request("/capability/notes/create", stagedBody("paid"));

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    const html = await response.text();
    expect(html).toContain('data-role="error"');
    expect(html).toContain('data-error-code="invalid_choice"');
    expect(html).toContain('data-error-fields="stage"');
    expect(createCapabilityDataTool(stagedNotesSpec(), conns).select()).toEqual([]);
  });

  // Whether a value is one the field declares is a fact about the spec and the wire, so the
  // router settles it before any generated code loads. What that buys is the *answer*: the
  // 422, the retarget and the sentence are the platform's rather than whatever a Handler
  // chose to do with a caught error.
  test("no capability code is even loaded to judge it", async () => {
    let loaded = 0;
    const app = appForStagedNotes(stagedNotesSpec(), () => {
      loaded += 1;
    });

    await app.request("/capability/notes/create", stagedBody("paid"));

    expect(loaded).toBe(0);
  });

  test("a declared value goes through and reaches the Handler", async () => {
    const app = appForStagedNotes();

    const response = await app.request("/capability/notes/create", stagedBody("sent"));

    expect(response.status).toBe(200);
    expect(handlerRuns).toBe(1);
    const [stored] = createCapabilityDataTool(stagedNotesSpec(), conns).select();
    expect(stored?.stage).toBe("sent");
  });

  test("a crafted disabled value is its own refusal, and the Handler never judges it", async () => {
    const retired = stagedNotesSpec([
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent", disabled: true },
    ]);
    const app = appForStagedNotes(retired);

    const response = await app.request("/capability/notes/create", stagedBody("sent"));

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    const html = await response.text();
    expect(html).toContain('data-error-code="choice_disabled"');
    expect(html).toContain('data-error-fields="stage"');
    // The platform owns the answer: the Handler asked for the write and the platform
    // refused it. This one stays inside the mutation port on purpose — whether a declared
    // option is still open depends on the value the record is already standing on, which
    // the router has not read. No capability code decides anything about the option set,
    // and canonical state never moved.
    expect(createCapabilityDataTool(retired, conns).select()).toEqual([]);
  });

  test("the shell claims the code, or htmx drops the answer on the floor", () => {
    expect(readFileSync(join(import.meta.dir, "../../public/app.js"), "utf8")).toContain(
      '"choice_disabled"',
    );
  });
});
