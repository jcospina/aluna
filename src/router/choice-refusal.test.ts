// The wire answer to an undeclared choice value: a typed 422 that names the field, from
// the platform, before any generated Handler runs and before canonical state moves.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createApp } from "../app/app.ts";
import { applyCapabilityTableDdl } from "../capability-data/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
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
function stagedNotesSpec() {
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
          values: STAGE_OPTIONS,
          groups: [],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: { ...base.ui_intent.form, choice_inputs: [{ field: "stage", presentation: "picker" }] },
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

  function appForStagedNotes() {
    const spec = stagedNotesSpec();
    install(conns, notesRow(spec));
    applyCapabilityTableDdl(spec, conns.readwrite);
    return createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler:
          async () =>
          async ({ input, mutation, present }: CapabilityCreateContext) => {
            handlerRuns += 1;
            return present(
              mutation.create({
                text: input.values.text,
                pinned: false,
                stage: input.values.stage,
              }),
            );
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

  test("a declared value goes through and reaches the Handler", async () => {
    const app = appForStagedNotes();

    const response = await app.request("/capability/notes/create", stagedBody("sent"));

    expect(response.status).toBe(200);
    expect(handlerRuns).toBe(1);
    const [stored] = createCapabilityDataTool(stagedNotesSpec(), conns).select();
    expect(stored?.stage).toBe("sent");
  });
});
