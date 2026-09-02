// The wire answer to a string longer than its field declared room for: a typed 422 that
// names the field, from the platform, before any generated Handler runs and before
// canonical state moves.
//
// The native attribute already stops this on a form that was filled in, so every case here
// is the crafted request the attribute cannot answer — which is the whole reason the limit
// is not only a browser fact.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { createApp } from "../../../server/app.ts";
import { applyCapabilityTableDdl } from "../../data/index.ts";
import {
  createCapabilityDataTool,
  install,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "../dispatch/router.test-support.ts";
import type { HandlerLoader } from "../dispatch/router.ts";
import type { CapabilityCreateContext, CapabilityUpdateContext } from "../index.ts";

const LIMIT = 64;

/** The notes fixture with a bound on its one text field. */
function boundedNotesSpec() {
  const base = notesSpec();
  return notesSpec({
    schema: {
      fields: base.schema.fields.map((field) =>
        field.name === "text" ? { ...field, max_length: LIMIT } : field,
      ),
    },
  });
}

function body(text: string, fields: readonly string[] = ["text", "pinned"]): RequestInit {
  const params = new URLSearchParams({ text });
  for (const field of fields) params.append("__aluna_present", field);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  };
}

describe("an over-length string on the wire", () => {
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

  /**
   * The Handler asks for the write and takes no view of length at all — which is the
   * contract: the platform refuses before the write lands, so a generated unit never
   * becomes a second length check.
   */
  const loadHandler: HandlerLoader = async (_path, action) => {
    if (action === "update") {
      return async (raw: unknown) => {
        const context = raw as CapabilityUpdateContext;
        handlerRuns += 1;
        return context.present(context.mutation.update({ text: context.input.values.text }));
      };
    }
    return async (raw: unknown) => {
      const context = raw as CapabilityCreateContext;
      handlerRuns += 1;
      return context.present(
        context.mutation.create({ text: context.input.values.text, pinned: false }),
      );
    };
  };

  function appForBoundedNotes() {
    const spec = boundedNotesSpec();
    install(conns, notesRow(spec));
    applyCapabilityTableDdl(spec, conns.readwrite);
    return createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler,
        loadItemRenderer: async () => (record) => `<span>${String(record.text)}</span>`,
      },
    });
  }

  test("is refused as a typed max_length_exceeded naming its field, and stores nothing", async () => {
    const app = appForBoundedNotes();

    const response = await app.request("/capability/notes/create", body("x".repeat(LIMIT + 1)));

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    const html = await response.text();
    expect(html).toContain('data-role="error"');
    expect(html).toContain('data-error-code="max_length_exceeded"');
    expect(html).toContain('data-error-fields="text"');
    expect(createCapabilityDataTool(boundedNotesSpec(), conns).select()).toEqual([]);
  });

  test("the sentence names nothing internal and asks for the one thing that would fix it", async () => {
    const app = appForBoundedNotes();
    const html = await (
      await app.request("/capability/notes/create", body("x".repeat(LIMIT + 1)))
    ).text();
    // The prose alone: the markers beside it are the shell's machine contract, not copy.
    const sentence = (/>([^<]*)</.exec(html)?.[1] ?? "").toLowerCase();
    for (const internal of ["handler", "capability", "max_length", "field's", "422"]) {
      expect(sentence).not.toContain(internal);
    }
    expect(sentence).toContain("longer than this field holds");
  });

  test("the platform answers it, not the Handler: no capability code judges a length", async () => {
    const app = appForBoundedNotes();
    await app.request("/capability/notes/create", body("x".repeat(LIMIT + 1)));
    // Not "the Handler asked and was refused" — the Handler is never loaded. The length is
    // a fact about the submission, so the router settles it before any generated code runs,
    // which is what makes the 422, the retarget and the sentence the platform's rather than
    // whatever the Handler chose to do with a caught error.
    expect(handlerRuns).toBe(0);
    expect(createCapabilityDataTool(boundedNotesSpec(), conns).select()).toEqual([]);
  });

  test("exactly at the limit goes through and reaches the Handler", async () => {
    const app = appForBoundedNotes();

    const response = await app.request("/capability/notes/create", body("x".repeat(LIMIT)));

    expect(response.status).toBe(200);
    expect(handlerRuns).toBe(1);
    expect(createCapabilityDataTool(boundedNotesSpec(), conns).select()[0]?.text).toHaveLength(
      LIMIT,
    );
  });

  test("update is refused the same way, and leaves the record exactly as it was", async () => {
    const app = appForBoundedNotes();
    await app.request("/capability/notes/create", body("A short note"));
    const [stored] = createCapabilityDataTool(boundedNotesSpec(), conns).select();
    handlerRuns = 0;

    const params = new URLSearchParams({ text: "x".repeat(LIMIT + 1) });
    params.append("__aluna_present", "text");
    params.append("__aluna_record_id", String(stored?.id));
    const response = await app.request("/capability/notes/update", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain('data-error-code="max_length_exceeded"');
    expect(html).toContain('data-error-fields="text"');
    expect(response.headers.get("HX-Retarget")).toBe("#notes-edit-error");
    expect(createCapabilityDataTool(boundedNotesSpec(), conns).select()[0]?.text).toBe(
      "A short note",
    );
  });

  test("length is counted in code units, so the server refuses exactly what the browser stops", async () => {
    const app = appForBoundedNotes();
    // 33 astral characters are 33 graphemes and 66 code units. `maxlength` counts code
    // units, so a browser would refuse this; a server counting graphemes would not.
    const response = await app.request("/capability/notes/create", body("😀".repeat(33)));

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('data-error-code="max_length_exceeded"');
  });

  test("the shell claims the code, or htmx drops the answer on the floor", () => {
    expect(readFileSync(join(import.meta.dir, "../../../../public/app.js"), "utf8")).toContain(
      '"max_length_exceeded"',
    );
  });
});
