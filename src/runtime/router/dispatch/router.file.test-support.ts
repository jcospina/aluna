// The photos fixture behind the router's file suites: a scratch database with it installed, the
// bodies its forms post, and the ledger rows 7.1/07's upload route will mint, written directly.
// Not a test file itself, so bun never runs it.

import { afterEach, beforeEach, expect } from "bun:test";

import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, type FileLedgerRow } from "../../../platform/files/ledger.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import { createApp } from "../../../server/app.ts";
import {
  type CapabilityActionRecord,
  type CapabilityFileProjection,
  FILE_URL_PREFIX,
} from "../../data/index.ts";
import type { CapabilityUpdateContext } from "../contract.ts";
import { ALUNA_PRESENT_MARKER, ALUNA_RECORD_ID_MARKER } from "../wire/wire-protocol.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  photosRow,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { CapabilityRouterDeps, HandlerLoader } from "./router.ts";

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

/** An edit's body for `recordId`: each field given is marked and carries its value. */
export function editBody(recordId: string, fields: Readonly<Record<string, string>>): RequestInit {
  const body = new URLSearchParams([[ALUNA_RECORD_ID_MARKER, recordId]]);
  for (const [field, value] of Object.entries(fields)) {
    body.append(ALUNA_PRESENT_MARKER, field);
    body.append(field, value);
  }
  return formPost(body);
}

/** An update Handler that answers with the card of the record `write` saves. */
export function updateHandler(
  write: (context: CapabilityUpdateContext) => CapabilityActionRecord,
): HandlerLoader {
  return async () => async (context: CapabilityUpdateContext) => context.present(write(context));
}

export function projectionOf(row: FileLedgerRow): CapabilityFileProjection {
  return {
    url: `${FILE_URL_PREFIX}${row.key}`,
    name: row.name,
    kind: row.kind as CapabilityFileProjection["kind"],
    mime: row.mime,
    size: row.size,
  };
}

/** A scratch database with the photos fixture (or `row`) installed, fresh for every case. */
export function usePhotosRouter(row: () => CapabilityRow = photosRow) {
  const scratch: { dir?: string; conns?: PlatformDatabase } = {};
  beforeEach(() => {
    const env = setupRouterTest();
    Object.assign(scratch, { dir: env.dir, conns: env.conns });
    install(env.conns, row());
  });
  afterEach(() => {
    if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
  });

  const conns = (): PlatformDatabase => {
    if (!scratch.conns) throw new Error("the photos router is used outside a test");
    return scratch.conns;
  };
  const request = (path: string, init?: RequestInit, deps: Partial<CapabilityRouterDeps> = {}) => {
    const { mutationCoordinator, ...router } = deps;
    // The app owns the coordinator its routes share, so one handed only to the router is unused.
    return createApp({
      capabilityRouter: { databases: conns(), ...router },
      ...(mutationCoordinator ? { mutationCoordinator } : {}),
    }).request(path, init);
  };
  const stored = () =>
    conns().readwrite.query(`SELECT "id", "photo" FROM "cap_photos"`).all() as {
      id: string;
      photo: string | null;
    }[];
  return {
    conns,
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
    ledgerRows: () => conns().readwrite.query(`SELECT * FROM ${FILE_LEDGER_TABLE}`).all(),
  };
}
