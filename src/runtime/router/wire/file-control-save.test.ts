// A save through the photo control, driven by what the rendered forms actually submit, with the
// photo's value set the way `public/file-field.js` sets it from what the field holds. A create
// claims the photo it took, an edit that never touches the field keeps what it holds, a
// replacement gives the old file up, and the clear the server drew empties the field.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { postedValue } from "#shell/file-field.js";
import { mintFileKey } from "../../../platform/files/ledger.ts";
import { sampleFile } from "../../../platform/files/sample-files.test-support.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { renderCreateForm, renderEditForm } from "../../../presentation/fields/field-renderer.ts";
import { submittedInputs } from "../../../presentation/fields/form-submission.test-support.ts";
import { renderableFromRow } from "../../../presentation/fields/renderable-capability.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  INVALID_FILE_REFERENCE_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import { createApp } from "../../../server/app.ts";
import {
  answeredReference,
  uploadInit,
  useFileRoutes,
} from "../../../server/files/file-routes.test-support.ts";
import {
  assertSubmittedFieldValues,
  createCapabilityUpdateMutationPort,
  InvalidFileReferenceError,
} from "../../data/index.ts";
import { FileFieldWriteError } from "../../data/internal.ts";
import { normalizeSpecFieldValues, normalizeStoredRow } from "../../data/tool.ts";
import { usePhotosRouter } from "../dispatch/router.file.test-support.ts";
import {
  createCapabilityDataTool,
  install,
  notesRow,
  photosRow,
  setupRouterTest,
  teardownRouterTest,
} from "../dispatch/router.test-support.ts";
import type { CapabilityCreateContext, CapabilityUpdateContext } from "../index.ts";
import {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  parseCapabilityRequest,
} from "./wire-protocol.ts";

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

/**
 * What the server drew for the browser to read: where the photo's upload goes, and on its value
 * the key held and the clear.
 */
async function drawnPhoto(html: string): Promise<{ upload: string; held: string; clear: string }> {
  let upload = "";
  let drawn: { held: string; clear: string } | undefined;
  const rewriter = new HTMLRewriter()
    .on("[data-file-field]", {
      element(element) {
        upload = element.getAttribute("data-file-upload") ?? "";
      },
    })
    .on("input[data-file-value]", {
      element(element) {
        drawn = {
          held: element.getAttribute("data-file-held-key") ?? "",
          clear: element.getAttribute("data-file-clear-value") ?? "",
        };
      },
    });
  await new Response(rewriter.transform(new Response(html)).body).text();
  if (!drawn) throw new Error("the form draws no photo value");
  return { upload, ...drawn };
}

const SAVED = { name: "saved.jpg", size: 3, url: "/files/saved" };

/**
 * The photo value the browser posts once the field holds `now`: what it was drawn holding,
 * nothing, or a file an upload answered with `key`.
 */
async function photoPosted(html: string, now: "kept" | "cleared" | { key: string }) {
  const drawn = await drawnPhoto(html);
  const saved = drawn.held === "" ? null : SAVED;
  const taken = { name: "taken.jpg", size: 3, url: "/files/taken" };
  const current = now === "kept" ? saved : now === "cleared" ? null : taken;
  const keyOf = (held: object) => (typeof now === "object" && held === taken ? now.key : undefined);
  return postedValue(current, drawn, keyOf);
}

describe("a save through the photo control, as its rendered form posts it", () => {
  const photos = usePhotosRouter();

  function form(record?: Record<string, unknown>): string {
    const capability = renderableFromRow(photosRow());
    return record ? renderEditForm(capability, record) : renderCreateForm(capability);
  }

  function record(id: string) {
    const found = createCapabilityDataTool(photoSpec(), photos.conns())
      .select()
      .find((row) => row.id === id);
    if (!found) throw new Error(`no record ${id}`);
    return found;
  }

  async function create(photo: "kept" | { key: string }): Promise<Response> {
    const html = form();
    const posted = { caption: "Dawn", photo: await photoPosted(html, photo) };
    return photos.request("/capability/photos/create", await submit(html, posted));
  }

  async function edit(id: string, photo: "kept" | "cleared" | { key: string }) {
    const html = form(record(id));
    const posted = { caption: "Dusk", photo: await photoPosted(html, photo) };
    return photos.request("/capability/photos/update", await submit(html, posted));
  }

  async function createdWith(photo: "kept" | { key: string }): Promise<string> {
    const before = new Set(photos.stored().map((row) => row.id));
    expect((await create(photo)).status).toBe(200);
    const created = photos.stored().find((row) => !before.has(row.id));
    if (!created) throw new Error("the create stored nothing");
    return created.id;
  }

  test("a create with nothing picked stores no photo", async () => {
    const id = await createdWith("kept");
    expect(photos.photoOf(id)).toBeNull();
  });

  test("a create holding a photo claims it, and the ledger says owned", async () => {
    const key = photos.mint();
    const id = await createdWith({ key });
    expect(photos.photoOf(id)).toMatchObject({ key });
    expect(photos.ledger(key).state).toBe("owned");
  });

  test("an edit that never touches the photo keeps it", async () => {
    const key = photos.mint();
    const id = await createdWith({ key });
    expect((await edit(id, "kept")).status).toBe(200);
    expect(record(id).caption).toBe("Dusk");
    expect(photos.photoOf(id)).toMatchObject({ key });
    expect(photos.ledger(key).state).toBe("owned");
  });

  test("a replacement claims the new photo and gives the old one up", async () => {
    const old = photos.mint();
    const id = await createdWith({ key: old });
    const replacement = photos.mint();
    expect((await edit(id, { key: replacement })).status).toBe(200);
    expect(photos.photoOf(id)).toMatchObject({ key: replacement });
    expect(photos.ledger(replacement).state).toBe("owned");
    expect(photos.ledger(old).state).toBe("cleanup_enqueued");
  });

  test("the clear the server drew empties the field and gives its photo up", async () => {
    const key = photos.mint();
    const id = await createdWith({ key });
    expect((await edit(id, "cleared")).status).toBe(200);
    expect(photos.photoOf(id)).toBeNull();
    expect(photos.ledger(key).state).toBe("cleanup_enqueued");
  });
});

describe("a photo sent where the stored capability's form says", () => {
  const files = useFileRoutes();

  test("is admitted there, served at the address it answered with, and saved by its key", async () => {
    const html = renderCreateForm(renderableFromRow(photosRow()));
    const { upload } = await drawnPhoto(html);
    const sent = await files
      .app()
      .request(upload, uploadInit(sampleFile("jpeg"), { type: "image/jpeg" }));
    expect(sent.status).toBe(201);
    const { key, url } = await answeredReference(sent);
    expect((await files.app().request(url)).status).toBe(200);

    const posted = { caption: "Dawn", photo: await photoPosted(html, { key }) };
    const saved = await files
      .app()
      .request("/capability/photos/create", await submit(html, posted));
    expect(saved.status).toBe(200);
    expect(files.ledgerRows().find((row) => row.key === key)?.state).toBe("owned");
  });
});

describe("a required photo", () => {
  const required = () => {
    const { schema, behavioral_errors } = photoSpec([
      CAPTION_FIELD,
      { ...PHOTO_FIELD, required: true },
    ]);
    return photosRow({ schema, behavioral_errors });
  };
  const photos = usePhotosRouter(required);

  function refusesMissingPhoto(body: string) {
    const { code_attribute, fields_attribute } = BEHAVIORAL_ERROR_MARKERS;
    expect(body).toContain(`${code_attribute}="${MISSING_REQUIRED_FIELDS_ERROR_CODE}"`);
    expect(body).toContain(`${fields_attribute}="${PHOTO_FIELD.name}"`);
  }

  test("refuses a create with nothing picked, naming the photo", async () => {
    const html = renderCreateForm(renderableFromRow(required()));
    const posted = { caption: "Dawn", photo: await photoPosted(html, "kept") };
    const response = await photos.request("/capability/photos/create", await submit(html, posted));
    expect(response.status).toBe(422);
    refusesMissingPhoto(await response.text());
    expect(photos.stored()).toEqual([]);
  });

  test("refuses an edit that clears it, and the record keeps its photo", async () => {
    const key = photos.mint();
    const id = await photos.save(key);
    const held = createCapabilityDataTool(photoSpec(), photos.conns())
      .select()
      .find((row) => row.id === id);
    if (!held) throw new Error(`no record ${id}`);
    const html = renderEditForm(renderableFromRow(required()), held);
    const posted = { caption: "Dusk", photo: await photoPosted(html, "cleared") };
    const response = await photos.request("/capability/photos/update", await submit(html, posted));
    expect(response.status).toBe(422);
    refusesMissingPhoto(await response.text());
    expect(photos.photoOf(id)).toMatchObject({ key });
    expect(photos.ledger(key).state).toBe("owned");
  });
});

describe("a Handler behind the photo control", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let handlerRuns: number;
  let writePhoto: unknown;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    handlerRuns = 0;
    writePhoto = undefined;
    install(conns, captionOnlyHandlersRow());
  });

  afterEach(() => teardownRouterTest(dir, conns));

  function captionOnlyHandlersRow(): CapabilityRow {
    return notesRow({ ...photoSpec(), artifacts_path: "artifacts/photos/v1/" });
  }

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
    const form = renderCreateForm(renderableFromRow(captionOnlyHandlersRow()));
    return app().request("/capability/photos/create", await submit(form, { caption }));
  }

  function storedRecord() {
    const [record] = createCapabilityDataTool(photoSpec(), conns).select();
    if (!record) throw new Error("the create stored nothing");
    return record;
  }

  test("sees its photo refused before it runs when the value is anything but a file", async () => {
    await createThroughForm("A day out");
    const form = renderEditForm(renderableFromRow(captionOnlyHandlersRow()), storedRecord());
    const runsBefore = handlerRuns;

    const response = await app().request(
      "/capability/photos/update",
      await submit(form, { [PHOTO_FIELD.name]: "anything" }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      `${BEHAVIORAL_ERROR_MARKERS.code_attribute}="${INVALID_FILE_REFERENCE_ERROR_CODE}"`,
    );
    expect(handlerRuns).toBe(runsBefore);
    expect(storedPhotos()).toEqual([{ photo: null }]);
  });

  test("that writes the file field itself is refused, and nothing is stored", async () => {
    writePhoto = { url: "/files/k", name: "a.jpg", kind: "image", mime: "image/jpeg", size: 1 };

    const response = await createThroughForm("A day out");

    expect(response.status).toBe(500);
    expect(handlerRuns).toBe(1);
    expect(storedPhotos()).toEqual([]);
  });

  test("meets an update port that refuses a file field the router never checked", async () => {
    await createThroughForm("A day out");
    const record = storedRecord();
    expect(() =>
      createCapabilityUpdateMutationPort(
        photoSpec(),
        record.id,
        new Set([PHOTO_FIELD.name]),
        conns.readwrite,
      ),
    ).toThrow(FileFieldWriteError);
    expect(storedPhotos()).toEqual([{ photo: null }]);
  });
});

describe("the file field's refusals below the router", () => {
  test("the wire takes a file marker on both saves, and one with no value holds nothing", async () => {
    const body = new URLSearchParams([
      [ALUNA_PRESENT_MARKER, PHOTO_FIELD.name],
      [ALUNA_RECORD_ID_MARKER, "r"],
    ]);
    const update = new Request("http://aluna.test/", { method: "POST", body });
    const edited = await parseCapabilityRequest(update, "update", photoSpec());
    expect(edited.input.values).toEqual({ [PHOTO_FIELD.name]: "" });

    body.delete(ALUNA_RECORD_ID_MARKER);
    body.append(ALUNA_PRESENT_MARKER, CAPTION_FIELD.name);
    const create = new Request("http://aluna.test/", { method: "POST", body });
    const parsed = await parseCapabilityRequest(create, "create", photoSpec());
    expect(parsed.input.submittedFields.has(PHOTO_FIELD.name)).toBe(true);
    expect(parsed.input.values[PHOTO_FIELD.name]).toBe("");
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
        FileFieldWriteError,
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
