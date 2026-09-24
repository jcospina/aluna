// The file rule below the router: why each reference is refused, and the mutation interface's own
// check as it promotes a key, which runs even when the router's two have passed.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, mintFileKey } from "../../../platform/files/ledger.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { PHOTO_FIELD, photoSpec } from "../../../registry/fields/file.test-support.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import type { SpecField } from "../../../registry/index.ts";
import { FileFieldWriteError, InvalidFileReferenceError } from "../internal.ts";
import { applyCapabilityTableDdl } from "../schema/ddl.ts";
import { FILE_URL_PREFIX, projectFileLedgerRow } from "../schema/file-values.ts";
import { type FileClaimScope, resolveSubmittedFiles } from "./file-claims.ts";
import { createCapabilityMutationPort } from "./mutation.ts";

const COVER_FIELD: SpecField = { ...PHOTO_FIELD, name: "cover", label: "Cover" };
const spec = photoSpec([...photoSpec().schema.fields, COVER_FIELD]);

let env: ScratchDbEnv;
let scope: FileClaimScope;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-file-claims-");
  applyCapabilityTableDdl(spec, env.conns.readwrite);
  scope = {
    database: env.conns.readwrite,
    capabilityId: "photos",
    incarnationId: FIRST_INCARNATION_ID,
  };
});

afterEach(() => teardownScratchDbEnv(env));

function mint(overrides: Partial<FileLedgerSeed> = {}): string {
  return seedFileLedgerRow(env.conns.readwrite, {
    capabilityId: "photos",
    incarnationId: FIRST_INCARNATION_ID,
    field: PHOTO_FIELD.name,
    ...overrides,
  });
}

function refusal(values: Record<string, unknown>): InvalidFileReferenceError {
  try {
    resolveSubmittedFiles(spec.schema.fields, values, "create", scope);
  } catch (error) {
    if (error instanceof InvalidFileReferenceError) return error;
    throw error;
  }
  throw new Error("the submission was not refused");
}

describe("which reference a file field may claim", () => {
  test("a pending key minted for this incarnation and field resolves to its row", () => {
    const key = mint();
    const files = resolveSubmittedFiles(
      spec.schema.fields,
      { photo: key, cover: "" },
      "create",
      scope,
    );
    expect(files.get("photo")).toMatchObject({ key, state: "pending" });
    expect(files.get("cover")).toBeNull();
  });

  test("a field left out of the submission resolves to nothing at all", () => {
    expect(resolveSubmittedFiles(spec.schema.fields, { caption: "c" }, "create", scope).size).toBe(
      0,
    );
  });

  test("each refusal names its reason", () => {
    const cases = [
      [mint({ field: "cover" }), "other_field"],
      [mint({ incarnationId: SECOND_INCARNATION_ID }), "other_incarnation"],
      [mint({ capabilityId: "notes" }), "other_incarnation"],
      [mint({ state: "owned" }), "owned"],
      [mint({ state: "cleanup_enqueued" }), "cleanup_enqueued"],
      [mint({ kind: "document", mime: "application/pdf" }), "not_accepted"],
      [mintFileKey(), "unknown"],
      ["harbour.jpg", "malformed"],
      [["a", "b"], "malformed"],
    ] as const;
    for (const [photo, reason] of cases) {
      expect(refusal({ photo }).reasons).toEqual({ photo: reason });
    }
  });

  test("one refusal names every field that offends", () => {
    const error = refusal({ photo: mintFileKey(), cover: mint() });
    expect(error.fields).toEqual(["photo", "cover"]);
    expect(error.reasons).toEqual({ photo: "unknown", cover: "other_field" });
  });
});

describe("the mutation interface checks once more", () => {
  test("a key taken after the router's checks is refused, and nothing is written", () => {
    const key = mint();
    const submitted = resolveSubmittedFiles(spec.schema.fields, { photo: key }, "create", scope);
    const port = createCapabilityMutationPort(spec, env.conns.readwrite, undefined, {
      incarnationId: FIRST_INCARNATION_ID,
      submitted,
    });
    env.conns.readwrite.run(
      `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'cleanup_enqueued' WHERE "key" = ?`,
      [key],
    );

    expect(() => port.create({ caption: "Dawn" })).toThrow(InvalidFileReferenceError);
    expect(env.conns.readwrite.query(`SELECT * FROM "cap_photos"`).all()).toEqual([]);
    expect(requireFileLedgerRow(env.conns.readwrite, key).state).toBe("cleanup_enqueued");
  });

  test("a port bound to no submission writes every file field empty", () => {
    const key = mint();
    const port = createCapabilityMutationPort(spec, env.conns.readwrite);
    const projection = projectFileLedgerRow(requireFileLedgerRow(env.conns.readwrite, key));

    expect(port.create({ caption: "Bare", photo: null }).fields.photo).toBeNull();
    expect(() => port.create({ caption: "Dawn", photo: projection })).toThrow(FileFieldWriteError);
    expect(requireFileLedgerRow(env.conns.readwrite, key).state).toBe("pending");
  });

  test("the projection's url is the same-origin address the key is served from", () => {
    const key = mint();
    const projection = projectFileLedgerRow(requireFileLedgerRow(env.conns.readwrite, key));
    expect(projection.url).toBe(`${FILE_URL_PREFIX}${key}`);
    expect(Object.isFrozen(projection)).toBe(true);
  });
});

describe("one submission's file belongs to one record", () => {
  test("a second create cannot claim it again, and is told it wrote what it may not", () => {
    const key = mint();
    const submitted = resolveSubmittedFiles(spec.schema.fields, { photo: key }, "create", scope);
    const port = createCapabilityMutationPort(spec, env.conns.readwrite, undefined, {
      incarnationId: FIRST_INCARNATION_ID,
      submitted,
    });

    const first = port.create({ caption: "Dawn" });
    expect(() => port.create({ caption: "Dusk" })).toThrow(FileFieldWriteError);
    expect(() => port.create({ caption: "Dusk", photo: first.fields.photo })).toThrow(
      FileFieldWriteError,
    );
    expect(env.conns.readwrite.query(`SELECT "caption" FROM "cap_photos"`).all()).toEqual([
      { caption: "Dawn" },
    ]);
  });
});
