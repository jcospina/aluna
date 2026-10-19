// The link view at a size no desk reaches by hand: past SQLite's limit of 1000 on an expression's
// depth, which a filter chaining one term per relation reached and so kept every question from
// opening.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { LINK_TABLE, writeLinkRow } from "../../../platform/links/link-table.ts";
import type { ActiveRegistryCatalog } from "../../../registry/index.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  deskRow,
  MEMOS,
} from "../../../server/routes/lifecycle/link.test-support.ts";
import { applyCapabilityTableDdl } from "../../data/index.ts";
import { rowSpec } from "../../router/dispatch/router.test-support.ts";
import { createQueryWorker } from "../worker/query-worker.ts";
import { questionRelations, questionViews } from "./question-views.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

const RELATIONS = 1100;

let platforms: ScratchPlatforms;

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => platforms.disposeAll());

test("a desk holding more relations than an expression may be deep still opens", async () => {
  const { path, database } = platforms.migrated();
  const sources = Array.from({ length: RELATIONS }, (_, index) => ({
    ...deskRow({ ...MEMOS, id: `memos_${index}` }),
    relations: [
      {
        field: "subject",
        to: { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, field: "name" },
      },
    ],
  }));
  const catalog: ActiveRegistryCatalog = {
    capabilities: [deskRow(AUTHORS), ...sources],
    fingerprint: "",
  };
  for (const row of catalog.capabilities) applyCapabilityTableDdl(rowSpec(row), database.readwrite);
  const last = `memos_${RELATIONS - 1}`;
  database.readwrite.run(`INSERT INTO "cap_${last}" ("id", "subject") VALUES ('memo', 'Le Guin')`);
  database.readwrite.run(`INSERT INTO "cap_authors" ("id", "name") VALUES ('author', 'Le Guin')`);
  writeLinkRow(
    database.readwrite,
    { capability: last, record: "memo", field: "subject" },
    { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, record: "author" },
  );

  const worker = createQueryWorker(path, questionViews(catalog));
  try {
    expect(questionRelations(catalog)).toHaveLength(RELATIONS);
    expect(await worker.read(`SELECT source_capability AS source FROM ${LINK_TABLE}`)).toEqual([
      { source: last },
    ]);
  } finally {
    worker.close();
  }
});
