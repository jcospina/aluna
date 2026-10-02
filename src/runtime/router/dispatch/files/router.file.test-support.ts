// The photos fixture behind the router's file suites: a scratch database with it installed, the
// bodies its forms post, and the ledger rows the upload route mints, written directly.
// Not a test file itself, so bun never runs it.

import { afterEach, beforeEach, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wait } from "../../../../platform/async.test-support.ts";
import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../../platform/files/store/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, readFileLedgerRow } from "../../../../platform/files/store/ledger.ts";
import { createLocalObjectStore } from "../../../../platform/files/store/object-store.ts";
import { STAGING_DIRECTORY } from "../../../../platform/files/store/object-store-root.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import {
  type CapabilityRow,
  capabilitySpecFromRow,
  defaultBehavioralErrorsForSchema,
  isFileFieldType,
  type SpecField,
} from "../../../../registry/index.ts";
import {
  createFileCleanupWorker,
  type FileCleanupWorker,
} from "../../../../server/files/cleanup/file-cleanup.ts";
import { createTestApp } from "../../../../server/isolated-app.test-support.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../concurrency/mutation-coordinator.ts";
import {
  type FileClaimScope,
  fileClaimScope,
  type HeldFiles,
  heldFileKeys,
  readHeldFiles,
} from "../../../data/access/file-claims.ts";
import {
  type CapabilityActionRecord,
  type CapabilityFileProjection,
  fileKeyFromProjection,
} from "../../../data/index.ts";
import { RecordNotFoundError } from "../../../data/internal.ts";
import type { CapabilityCreateContext, CapabilityUpdateContext } from "../../contract.ts";
import {
  ALUNA_DRAWN_MARKER,
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  drawnFileValue,
} from "../../wire/wire-protocol.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  photosRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router.test-support.ts";
import type { CapabilityRouterDeps, HandlerLoader } from "../router.ts";

export const PHOTO = "photo";

function formPost(body: URLSearchParams): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

/** A create's body: the caption, and the photo's field and value when `photo` is given. */
export function createBody(caption: string, photo?: string): RequestInit {
  const body = new URLSearchParams([
    [ALUNA_PRESENT_MARKER, "caption"],
    ["caption", caption],
  ]);
  if (photo !== undefined) {
    body.append(ALUNA_PRESENT_MARKER, PHOTO);
    body.append(PHOTO, photo);
  }
  return formPost(body);
}

/**
 * An edit's body for `recordId`: each field given is marked and carries its value. `drawn` names
 * what a file field held when the form was drawn; one it leaves out, `usePhotosRouter`'s request
 * draws from what the record holds as the request is sent.
 */
export function editBody(
  recordId: string,
  fields: Readonly<Record<string, string>>,
  drawn: Readonly<Record<string, readonly string[]>> = {},
): RequestInit {
  const body = new URLSearchParams([[ALUNA_RECORD_ID_MARKER, recordId]]);
  for (const [field, value] of Object.entries(fields)) {
    body.append(ALUNA_PRESENT_MARKER, field);
    body.append(field, value);
  }
  for (const [field, keys] of Object.entries(drawn)) {
    body.append(ALUNA_DRAWN_MARKER, drawnFileValue(field, keys));
  }
  return formPost(body);
}

/** `init` with a drawn marker, read off the record now, for each file field it submits undrawn. */
function drawnNow(
  database: PlatformDatabase["readwrite"],
  row: CapabilityRow,
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (typeof init?.body !== "string") return init;
  const body = new URLSearchParams(init.body);
  const recordId = body.get(ALUNA_RECORD_ID_MARKER);
  if (recordId === null) return init;
  const spec = capabilitySpecFromRow(row);
  const drawn = (name: string) =>
    body.getAll(ALUNA_DRAWN_MARKER).some((value) => value.startsWith(drawnFileValue(name, [])));
  const undrawn = spec.schema.fields.filter(
    (field) =>
      isFileFieldType(field.type) &&
      body.getAll(ALUNA_PRESENT_MARKER).includes(field.name) &&
      !drawn(field.name),
  );
  const held = heldNow(undrawn, fileClaimScope(database, spec, row.incarnation_id, recordId));
  for (const field of undrawn) {
    body.append(ALUNA_DRAWN_MARKER, drawnFileValue(field.name, heldFileKeys(held.get(field.name))));
  }
  return { ...init, body: body.toString() };
}

/** What `fields` hold now, or nothing for a record that is gone, which the route answers itself. */
function heldNow(fields: readonly SpecField[], scope: FileClaimScope) {
  if (fields.length === 0) return new Map<string, HeldFiles>();
  try {
    return readHeldFiles(fields, scope);
  } catch (error) {
    if (error instanceof RecordNotFoundError) return new Map<string, HeldFiles>();
    throw error;
  }
}

/** The photos fixture holding a caption and `album`, a `file[]`, in place of its photo. */
export function albumsRow(album: SpecField = ALBUM_FIELD): CapabilityRow {
  const spec = photoSpec([CAPTION_FIELD, album]);
  return photosRow({
    schema: spec.schema,
    behavioral_errors: defaultBehavioralErrorsForSchema(spec.schema),
    ui_intent: {
      ...spec.ui_intent,
      item: { ...spec.ui_intent.item, shows: [album.name, "caption"] },
    },
  });
}

/** A create Handler that answers with the card of the record `write` saves. */
export function createHandler(
  write: (context: CapabilityCreateContext) => CapabilityActionRecord,
): HandlerLoader {
  return async () => async (context: CapabilityCreateContext) => context.present(write(context));
}

/** An update Handler that answers with the card of the record `write` saves. */
export function updateHandler(
  write: (context: CapabilityUpdateContext) => CapabilityActionRecord,
): HandlerLoader {
  return async () => async (context: CapabilityUpdateContext) => context.present(write(context));
}

/** The key a projection's address names. */
export function keyOf(photo: CapabilityFileProjection): string {
  const key = fileKeyFromProjection(photo);
  if (key === undefined) throw new Error("not a file projection");
  return key;
}

/** The first line of a refusal, which is all a person reads of it. */
export function sentenceOf(html: string): string {
  return /<p[^>]*>([^<]+)<\/p>/.exec(html)?.[1] ?? "";
}

/** A coordinator that runs `flip` after the route's first check and before its transaction opens. */
export function between(flip: () => void) {
  const mutationCoordinator = createMutationCoordinator();
  const acquire = mutationCoordinator.tryAcquireRecordWrite.bind(mutationCoordinator);
  mutationCoordinator.tryAcquireRecordWrite = () => {
    flip();
    return acquire();
  };
  return mutationCoordinator;
}

/**
 * A scratch database with the photos fixture (or `row`) installed, fresh for every case. A request
 * answers once the cleanup its commit woke has settled, so a case reads the drained ledger. An
 * edit is drawn now unless it names its own drawn keys or asks to be sent `"as-posted"`.
 */
export function usePhotosRouter(row: () => CapabilityRow = photosRow) {
  const scratch: {
    dir?: string;
    conns?: PlatformDatabase;
    coordinator?: MutationCoordinator;
    wakes: number;
    retries: { run: () => void; delayMs: number; worker: FileCleanupWorker }[];
  } = { wakes: 0, retries: [] };
  beforeEach(() => {
    const env = setupRouterTest();
    Object.assign(scratch, {
      dir: env.dir,
      conns: env.conns,
      coordinator: createMutationCoordinator(),
      wakes: 0,
      retries: [],
    });
    install(env.conns, row());
  });
  afterEach(() => {
    if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
  });

  const conns = (): PlatformDatabase => {
    if (!scratch.conns) throw new Error("the photos router is used outside a test");
    return scratch.conns;
  };
  const storage = () => {
    if (!scratch.dir) throw new Error("the photos router is used outside a test");
    return join(scratch.dir, "storage");
  };
  const request = async (
    path: string,
    init?: RequestInit,
    deps: Partial<CapabilityRouterDeps> = {},
    drawn: "now" | "as-posted" = "now",
  ) => {
    const { mutationCoordinator = scratch.coordinator, ...router } = deps;
    if (!mutationCoordinator) throw new Error("the photos router is used outside a test");
    const fill = drawn === "now" && path.endsWith("/update");
    const sent = fill ? drawnNow(conns().readwrite, row(), init) : init;
    const objectStore = createLocalObjectStore(storage());
    const fileCleanup = createFileCleanupWorker({
      databases: conns(),
      objectStore,
      mutationCoordinator,
      schedule: (run, delayMs) => scratch.retries.push({ run, delayMs, worker: fileCleanup }),
    });
    const wake = fileCleanup.wake.bind(fileCleanup);
    fileCleanup.wake = () => {
      scratch.wakes += 1;
      wake();
    };
    // The app owns the coordinator its routes share, so one handed only to the router is unused.
    const response = await createTestApp({
      capabilityRouter: { databases: conns(), ...router },
      mutationCoordinator,
      objectStore,
      fileCleanup,
    }).request(path, sent);
    await fileCleanup.idle();
    return response;
  };
  const stored = () =>
    conns().readwrite.query(`SELECT "id", "photo" FROM "cap_photos"`).all() as {
      id: string;
      photo: string | null;
    }[];
  return {
    conns,
    storage,
    mint: (overrides: Partial<FileLedgerSeed> = {}) =>
      seedFileLedgerRow(conns().readwrite, {
        capabilityId: "photos",
        incarnationId: NOTES_INCARNATION_ID,
        field: PHOTO,
        ...overrides,
      }),
    request,
    stored,
    /** Save a record through the real fixture and hand back its id. */
    save: async (photo?: string): Promise<string> => {
      const before = new Set(stored().map((record) => record.id));
      const response = await request("/capability/photos/create", createBody("Dawn", photo));
      expect(response.status).toBe(200);
      const record = stored().find((row) => !before.has(row.id));
      if (!record) throw new Error("the create stored nothing");
      return record.id;
    },
    /** What record `id`'s photo column holds, parsed. */
    photoOf: (id: string): Record<string, unknown> | null => {
      const record = stored().find((row) => row.id === id);
      if (!record) throw new Error(`no record ${id}`);
      return record.photo === null ? null : JSON.parse(record.photo);
    },
    ledger: (key: string) => requireFileLedgerRow(conns().readwrite, key),
    /** How many times a committed request has woken the cleanup worker in this case. */
    wakes: () => scratch.wakes,
    /** Waits out every retry a request's cleanup scheduled and runs it, as its timer would. */
    retry: async () => {
      const due = scratch.retries.splice(0);
      await wait(Math.max(0, ...due.map((retry) => retry.delayMs)));
      for (const retry of due) retry.run();
      for (const retry of due) await retry.worker.idle();
    },
    /** Whether `key` has no ledger row left. */
    gone: (key: string) => readFileLedgerRow(conns().readwrite, key) === null,
    /** Write bytes for `key` where a stored file and, with `staged`, an unplaced one sit. */
    place: (key: string, staged = false) => {
      const at = staged ? join(storage(), STAGING_DIRECTORY) : storage();
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, key), "bytes");
    },
    /** Whether any bytes for `key` remain, stored or staged. */
    onDisk: (key: string) =>
      existsSync(join(storage(), key)) || existsSync(join(storage(), STAGING_DIRECTORY, key)),
    ledgerRows: () => conns().readwrite.query(`SELECT * FROM ${FILE_LEDGER_TABLE}`).all(),
  };
}
