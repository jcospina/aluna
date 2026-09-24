// A save through the file stand-in, driven by what the rendered forms actually submit. A create
// stores `NULL` in the file column, and an edit of another field never names it, so the column
// is left alone under the merge-patch rule. A create that names a file claims it
// (`router.file-claim.test.ts`); an update may not name one until 7.1/05.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mintFileKey } from "../../../platform/files/ledger.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { renderCreateForm, renderEditForm } from "../../../presentation/fields/field-renderer.ts";
import { submittedInputs } from "../../../presentation/fields/form-submission.test-support.ts";
import { renderableFromRow } from "../../../presentation/fields/renderable-capability.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import { createApp } from "../../../server/app.ts";
import {
  assertSubmittedFieldValues,
  createCapabilityUpdateMutationPort,
  InvalidFileReferenceError,
} from "../../data/index.ts";
import { normalizeSpecFieldValues, normalizeStoredRow } from "../../data/tool.ts";
import {
  createCapabilityDataTool,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../dispatch/router.test-support.ts";
import type { CapabilityCreateContext, CapabilityUpdateContext } from "../index.ts";
import {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  parseCapabilityRequest,
} from "./wire-protocol.ts";

function photosRow(): CapabilityRow {
  return notesRow({ ...photoSpec(), artifacts_path: "artifacts/photos/v1/" });
}

/** The body a browser posts from `html`, with `edits` written over the matching controls. */
async function submit(html: string, edits: Record<string, string>): Promise<RequestInit> {
  const body = new URLSearchParams();
  for (const [name, value] of await submittedInputs(html)) body.append(name, edits[name] ?? value);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

describe("a save through the file stand-in", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let handlerRuns: number;
  let writePhoto: unknown;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    handlerRuns = 0;
    writePhoto = undefined;
    install(conns, photosRow());
  });

  afterEach(() => teardownRouterTest(dir, conns));

  function app() {
    const photo = () => (writePhoto === undefined ? {} : { photo: writePhoto });
    return createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler: async (_path, action) => {
          if (action === "update") {
            return async ({ input, mutation, present }: CapabilityUpdateContext) => {
              handlerRuns += 1;
              return present(mutation.update({ caption: input.values.caption, ...photo() }));
            };
          }
          return async ({ input, mutation, present }: CapabilityCreateContext) => {
            handlerRuns += 1;
            return present(mutation.create({ caption: input.values.caption, ...photo() }));
          };
        },
        loadItemRenderer: async () => (record) => `<span>${String(record.caption)}</span>`,
      },
    });
  }

  function storedPhotos(): unknown[] {
    return conns.readwrite.query(`SELECT "photo" FROM "cap_photos"`).all();
  }

  async function createThroughForm(caption: string): Promise<Response> {
    const form = renderCreateForm(renderableFromRow(photosRow()));
    return app().request("/capability/photos/create", await submit(form, { caption }));
  }

  test("a create from the rendered form stores NULL in the file column", async () => {
    const response = await createThroughForm("A day out");

    expect(response.status).toBe(200);
    expect(storedPhotos()).toEqual([{ photo: null }]);
  });

  test("an edit of another field never names the file column", async () => {
    await createThroughForm("A day out");
    const record = storedRecord();
    // Aborts any UPDATE whose SET names the column, so "left alone" is proved, not inferred.
    conns.readwrite.exec(
      `CREATE TRIGGER "photo_untouched" BEFORE UPDATE OF "photo" ON "cap_photos"
       BEGIN SELECT RAISE(ABORT, 'the photo column was written'); END;`,
    );
    expect(() => conns.readwrite.exec(`UPDATE "cap_photos" SET "photo" = NULL`)).toThrow(
      "the photo column was written",
    );

    const form = renderEditForm(renderableFromRow(photosRow()), record);
    const response = await app().request(
      "/capability/photos/update",
      await submit(form, { caption: "A better day" }),
    );

    expect(response.status).toBe(200);
    expect(createCapabilityDataTool(photoSpec(), conns).select()).toMatchObject([
      { caption: "A better day", photo: null },
    ]);
  });

  function storedRecord() {
    const [record] = createCapabilityDataTool(photoSpec(), conns).select();
    if (!record) throw new Error("the create stored nothing");
    return record;
  }

  test("a presence marker for the file field is refused before any Handler runs", async () => {
    await createThroughForm("A day out");
    const form = renderEditForm(renderableFromRow(photosRow()), storedRecord());
    const crafted = await submit(form, {});
    const body = new URLSearchParams(String(crafted.body));
    body.append(ALUNA_PRESENT_MARKER, PHOTO_FIELD.name);
    body.append(PHOTO_FIELD.name, "anything");
    const runsBefore = handlerRuns;

    const response = await app().request("/capability/photos/update", {
      ...crafted,
      body: body.toString(),
    });

    expect(response.status).toBe(400);
    expect(handlerRuns).toBe(runsBefore);
    expect(storedPhotos()).toEqual([{ photo: null }]);
  });

  test("a Handler that writes the file field is refused, and nothing is stored", async () => {
    writePhoto = { url: "/files/k", name: "a.jpg", kind: "image", mime: "image/jpeg", size: 1 };

    const response = await createThroughForm("A day out");

    expect(response.status).toBe(500);
    expect(handlerRuns).toBe(1);
    expect(storedPhotos()).toEqual([]);
  });

  test("the update port refuses a submitted file field, so nothing can clear it", async () => {
    await createThroughForm("A day out");
    const record = storedRecord();
    expect(() =>
      createCapabilityUpdateMutationPort(
        photoSpec(),
        record.id,
        new Set([PHOTO_FIELD.name]),
        conns.readwrite,
      ),
    ).toThrow('Field "photo" holds a file reference, which only the platform writes.');
    expect(storedPhotos()).toEqual([{ photo: null }]);
  });
});

describe("the file field's refusals below the router", () => {
  test("the wire says why it refused an update's marker, and takes a create's", async () => {
    const body = new URLSearchParams([
      [ALUNA_PRESENT_MARKER, PHOTO_FIELD.name],
      [ALUNA_RECORD_ID_MARKER, "r"],
    ]);
    const update = new Request("http://aluna.test/", { method: "POST", body });
    await expect(parseCapabilityRequest(update, "update", photoSpec())).rejects.toThrow(
      'File field "photo" is not submitted to an update yet.',
    );

    body.delete(ALUNA_RECORD_ID_MARKER);
    body.append(ALUNA_PRESENT_MARKER, CAPTION_FIELD.name);
    const create = new Request("http://aluna.test/", { method: "POST", body });
    const parsed = await parseCapabilityRequest(create, "create", photoSpec());
    expect(parsed.input.submittedFields.has(PHOTO_FIELD.name)).toBe(true);
  });

  test("a value for the file field is checked as a reference, never measured as text", () => {
    const fields = photoSpec().schema.fields;
    const long = { [CAPTION_FIELD.name]: "c", [PHOTO_FIELD.name]: "x".repeat(20_001) };
    const scope = {
      database: new Database(":memory:"),
      capabilityId: "photos",
      incarnationId: "i",
    };
    expect(() => assertSubmittedFieldValues(fields, long, "create", scope)).toThrow(
      InvalidFileReferenceError,
    );
    for (const photo of [long[PHOTO_FIELD.name], "", { url: "/files/k" }]) {
      expect(() => normalizeSpecFieldValues("photos", fields, { ...long, photo })).toThrow(
        'Field "photo" holds a file reference, which only the platform writes.',
      );
    }
  });

  test("a stored reference the save could not have written fails closed on read", () => {
    const row = { id: "r", created_at: "2026-09-24 00:00:00", extra: "{}", caption: "c" };
    const key = mintFileKey();
    const stored = { key, kind: "image", mime: "image/jpeg", size: 3, name: "a.jpg" };
    for (const photo of [
      '{"key":"k"}',
      JSON.stringify({ ...stored, key: "k" }),
      JSON.stringify({ ...stored, kind: "spreadsheet" }),
      JSON.stringify({ ...stored, size: -1 }),
      JSON.stringify({ ...stored, url: "/files/k" }),
      "not json",
    ]) {
      expect(() => normalizeStoredRow(photoSpec().schema.fields, { ...row, photo })).toThrow(
        'Expected file column "photo" to hold a stored file reference.',
      );
    }
    expect(normalizeStoredRow(photoSpec().schema.fields, { ...row, photo: null })).toMatchObject({
      photo: null,
    });
    expect(
      normalizeStoredRow(photoSpec().schema.fields, { ...row, photo: JSON.stringify(stored) }),
    ).toMatchObject({
      photo: { url: `/files/${key}`, name: "a.jpg", kind: "image", mime: "image/jpeg", size: 3 },
    });
  });
});
