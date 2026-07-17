import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import {
  FIELD_LIFECYCLE_DELETE_TARGET_ID,
  FIELD_LIFECYCLE_DEMO_ID,
  FIELD_LIFECYCLE_DEMO_SPEC,
  FIELD_LIFECYCLE_HISTORICAL_TARGET_ID,
  FIELD_LIFECYCLE_MERGE_TARGET_ID,
  installFieldLifecycleDemo,
} from "./field-lifecycle.ts";
import { READ_DEPENDENCY_DEMO_ID } from "./read-dependency.ts";

setDefaultTimeout(15_000);

async function installReference(database: PlatformDatabase["readwrite"], artifactsRoot: string) {
  const result = await installFieldLifecycleDemo({
    database,
    artifactsRoot,
    mutationCoordinator: createMutationCoordinator(),
  });
  expect(result.gate.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
    "structural:passed",
    "smoke:passed",
    "behavioral:skipped",
    "design-lint:passed",
  ]);
  expect(result.readDependency.row).toMatchObject({ id: READ_DEPENDENCY_DEMO_ID });
  expect(result.readDependency.artifactsPath).toContain(READ_DEPENDENCY_DEMO_ID);
  return result;
}

async function expectEmptySearch(
  app: ReturnType<typeof createApp>,
  capabilityId: string,
  query: string,
) {
  const response = await app.request(
    `/capability/${capabilityId}/search?q=${encodeURIComponent(query)}`,
  );
  expect(response.status).toBe(200);
  expect((await response.text()).trim()).toBe("");
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: this living-demo suite keeps one installed reference database across its browser-facing create and edit tracers.
describe("development-only five-Action reference living demo", () => {
  let dir: string;
  let databases: PlatformDatabase;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "aluna-field-lifecycle-demo-"));
    databases = openDatabase(join(dir, "demo.db"));
    runMigrations(databases.readwrite);
    await installReference(databases.readwrite, join(dir, "capabilities"));
  });

  afterEach(() => {
    databases.readonly.close();
    databases.readwrite.close();
    rmSync(dir, { force: true, recursive: true });
  });

  test("runs both authored list modes through create, Handler, storage, item, and detail", async () => {
    const app = createApp({ capabilityRouter: { databases } });

    const home = await (await app.request("/")).text();
    expect(home).toContain("Journal entry");
    expect(home).toContain("Journal links");
    expect(home).not.toContain("Five-action reference");
    expect(home).toContain(`/capability/${FIELD_LIFECYCLE_DEMO_ID}`);

    const view = await (await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}`)).text();
    expect(view).toContain("What happened?");
    expect(view).toContain("A small reflection");
    expect(view).toContain("Tags");
    expect(view).toContain("Other names");
    expect(view).toContain("Cherished");
    expect(view).toContain('data-list-input-mode="comma_separated"');
    expect(view).toContain("Separate values with commas.");
    expect(view).toContain('data-list-input-mode="repeatable"');
    expect(view).toContain("data-list-field-add");
    expect(view).toContain("data-capability-search");
    expect(view).toContain(`data-read-url="/capability/${FIELD_LIFECYCLE_DEMO_ID}/read"`);
    expect(view).toContain(`data-search-url="/capability/${FIELD_LIFECYCLE_DEMO_ID}/search"`);
    expect(view).not.toContain("Retired note");
    expect(view).not.toContain("retired_note");
    expect(view).not.toContain('name="created_at"');

    const read = await (await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)).text();
    expect(read).toContain("—");
    expect(read).toContain(">Created</dt>");
    expect(read).not.toContain("Retired note");
    expect(read).not.toContain("still stored");
    expect(
      databases.readwrite
        .query(`SELECT "retired_note" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
        .get(FIELD_LIFECYCLE_HISTORICAL_TARGET_ID),
    ).toEqual({ retired_note: "still stored" });
    expect(
      FIELD_LIFECYCLE_DEMO_SPEC.schema.fields.find((field) => field.name === "retired_note")
        ?.lifecycle,
    ).toBe("inactive");

    const rejected = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["entry", "   "],
        ["reflection", "Optional"],
        ["tags", " , , "],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
        ["__aluna_present", "cherished"],
      ]).toString(),
    });
    expect(rejected.status).toBe(422);
    const error = await rejected.text();
    expect(error).toContain('data-error-code="missing_required_fields"');
    expect(error).toContain('data-error-fields="entry tags"');

    const created = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["entry", "A visible win"],
        ["reflection", "Kept exactly"],
        ["tags", "fantasy, historical fiction, classic"],
        ["aliases", "Doe, Jane"],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
        ["__aluna_present", "cherished"],
      ]).toString(),
    });
    expect(created.status).toBe(200);
    const createdHtml = await created.text();
    expect(createdHtml).toContain("A visible win");
    expect(createdHtml.indexOf("fantasy")).toBeLessThan(createdHtml.indexOf("historical fiction"));
    expect(createdHtml.indexOf("historical fiction")).toBeLessThan(createdHtml.indexOf("classic"));
    expect(
      databases.readwrite
        .query(`SELECT "tags", "aliases" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "entry" = ?`)
        .get("A visible win"),
    ).toEqual({
      tags: '["fantasy","historical fiction","classic"]',
      aliases: '["Doe, Jane"]',
    });

    const refreshed = await (
      await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)
    ).text();
    expect(refreshed.indexOf("fantasy")).toBeLessThan(refreshed.indexOf("historical fiction"));
    expect(refreshed.indexOf("historical fiction")).toBeLessThan(refreshed.indexOf("classic"));
    expect(refreshed).toContain("Doe, Jane");

    const joined = await (await app.request(`/capability/${READ_DEPENDENCY_DEMO_ID}/read`)).text();
    expect(joined).toContain("data-joined-journal-entry");
    expect(joined).toContain("A quiet beginning");
    expect(joined).toContain("Seen through a declared dependency");

    const joinedSearch = await (
      await app.request(`/capability/${READ_DEPENDENCY_DEMO_ID}/search?q=quiet`)
    ).text();
    expect(joinedSearch).toContain("Seen through a declared dependency");
    await expectEmptySearch(app, READ_DEPENDENCY_DEMO_ID, "%");
    await expectEmptySearch(app, READ_DEPENDENCY_DEMO_ID, "_");
    await expectEmptySearch(app, READ_DEPENDENCY_DEMO_ID, "'");
    const joinedWhitespace = await (
      await app.request(`/capability/${READ_DEPENDENCY_DEMO_ID}/search?q=%E2%80%83%20%09`)
    ).text();
    expect(joinedWhitespace).toBe(joined);
  });

  test("opens read-only detail, prefills both list modes, and round-trips them through update", async () => {
    const app = createApp({ capabilityRouter: { databases } });
    const read = await (await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)).text();
    const templateId = `detail-${FIELD_LIFECYCLE_DEMO_ID}-${FIELD_LIFECYCLE_MERGE_TARGET_ID}`;
    const template = new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`).exec(
      read,
    )?.[1];
    if (!template) throw new Error("reference edit template was not rendered");

    expect(template).toContain("data-detail-read-mode");
    expect(template).toContain("data-detail-edit-mode hidden");
    expect(template).toContain("data-detail-edit>Edit</button>");
    expect(template).toContain("data-detail-delete>Delete</button>");
    expect(template).toContain("data-modal-delete-form hidden");
    expect(template).toContain(`hx-post="/capability/${FIELD_LIFECYCLE_DEMO_ID}/delete"`);
    expect(template).toContain(`data-read-url="/capability/${FIELD_LIFECYCLE_DEMO_ID}/read"`);
    expect(template).toContain(`data-search-url="/capability/${FIELD_LIFECYCLE_DEMO_ID}/search"`);
    expect(template).toContain(`hx-post="/capability/${FIELD_LIFECYCLE_DEMO_ID}/update"`);
    expect(template).toContain(
      `name="__aluna_record_id" value="${FIELD_LIFECYCLE_MERGE_TARGET_ID}"`,
    );
    expect(template).toContain('name="tags" aria-describedby=');
    expect(template).toContain('value="kept, before"');
    expect(template).toContain('name="aliases" value="Doe, Jane"');
    expect(template).toContain('name="aliases" value="J. Doe"');
    expect(template).not.toContain("retired_note");
    expect(template).not.toContain("hidden survives update");
    expect(template).not.toContain("merge-demo");

    const listRoundTrip = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/update`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["entry", "A quiet beginning"],
        ["reflection", "Keep this reflection"],
        ["tags", "edited, classic"],
        ["aliases", "Doe, Jane"],
        ["aliases", "J. Doe"],
        ["cherished", "on"],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
        ["__aluna_present", "cherished"],
        ["__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID],
      ]).toString(),
    });
    expect(listRoundTrip.status).toBe(200);
    expect(
      databases.readwrite
        .query(`SELECT "tags", "aliases" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
        .get(FIELD_LIFECYCLE_MERGE_TARGET_ID),
    ).toEqual({
      tags: '["edited","classic"]',
      aliases: '["Doe, Jane","J. Doe"]',
    });
  });

  test("keeps edit chrome out of the collection and saves clear/false/empty-list values", async () => {
    const app = createApp({ capabilityRouter: { databases } });
    const read = await (await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)).text();
    const templateId = `detail-${FIELD_LIFECYCLE_DEMO_ID}-${FIELD_LIFECYCLE_MERGE_TARGET_ID}`;
    const item = new RegExp(`<article[^>]*id="${templateId}-item"[\\s\\S]*?</article>`).exec(
      read,
    )?.[0];
    if (!item) throw new Error("reference item wrapper was not rendered");
    expect(item).not.toContain("data-detail-edit");
    expect(item).not.toContain(">Save</button>");
    expect(item).not.toContain("__aluna_");

    const update = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/update`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["entry", "A visible edit"],
        ["reflection", ""],
        ["tags", "edited, classic"],
        ["aliases", ""],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
        ["__aluna_present", "cherished"],
        ["__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID],
      ]).toString(),
    });
    expect(update.status).toBe(200);
    const updatedHtml = await update.text();
    expect(updatedHtml).toContain("A visible edit");
    expect(updatedHtml).toContain(`id="${templateId}-item"`);
    expect(
      databases.readwrite
        .query(
          `SELECT "entry", "reflection", "tags", "aliases", "cherished", "retired_note", "extra" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`,
        )
        .get(FIELD_LIFECYCLE_MERGE_TARGET_ID),
    ).toEqual({
      entry: "A visible edit",
      reflection: null,
      tags: '["edited","classic"]',
      aliases: "[]",
      cherished: 0,
      retired_note: "hidden survives update",
      extra: '{"source":"merge-demo"}',
    });

    const rejected = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/update`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["entry", "   "],
        ["reflection", "Still should not save"],
        ["tags", " , "],
        ["aliases", "Doe, Jane"],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
        ["__aluna_present", "cherished"],
        ["__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID],
      ]).toString(),
    });
    expect(rejected.status).toBe(422);
    expect(rejected.headers.get("HX-Retarget")).toBe(`#${FIELD_LIFECYCLE_DEMO_ID}-edit-error`);
    expect(rejected.headers.get("HX-Reswap")).toBe("innerHTML");
    const error = await rejected.text();
    expect(error).toContain('data-error-code="missing_required_fields"');
    expect(error).toContain('data-error-fields="entry tags"');
    expect(error).toContain("before I can save this");
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the tracer intentionally proves the complete route lifecycle in one database.
describe("five-Action reference route inventory", () => {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: one tracer keeps race, CRUD, normalization, and preservation assertions ordered.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the tracer keeps the build/read/write state transitions in one real route lifecycle.
  test("partial update, post-merge validation, delete, and not-found run through real routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aluna-five-action-routes-"));
    const databases = openDatabase(join(dir, "demo.db"));
    try {
      runMigrations(databases.readwrite);
      const mutationCoordinator = createMutationCoordinator();
      await installFieldLifecycleDemo({
        database: databases.readwrite,
        artifactsRoot: join(dir, "capabilities"),
        mutationCoordinator,
      });
      let providerCalls = 0;
      const app = createApp({
        capabilityRouter: { databases },
        mutationCoordinator,
        getProvider: () => {
          providerCalls += 1;
          throw new Error("search must not reach the provider");
        },
      });

      const reservation = mutationCoordinator.reserveBuild();
      const buildLease = await mutationCoordinator.acquireBuild(reservation);
      const refusalTargetByAction = {
        create: `#${FIELD_LIFECYCLE_DEMO_ID}-create-error`,
        update: `#${FIELD_LIFECYCLE_DEMO_ID}-edit-error`,
        delete: `#${FIELD_LIFECYCLE_DEMO_ID}-delete-error`,
      } as const;
      for (const path of [
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`,
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=old`,
      ]) {
        const coordinatorBefore = mutationCoordinator.snapshot();
        expect((await app.request(path)).status).toBe(200);
        expect(mutationCoordinator.snapshot()).toEqual(coordinatorBefore);
      }
      for (const action of ["create", "update", "delete"] as const) {
        const body = new URLSearchParams();
        if (action !== "create") body.set("__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID);
        const refused = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        expect(refused.status).toBe(422);
        expect(refused.headers.get("HX-Retarget")).toBe(refusalTargetByAction[action]);
      }
      expect(mutationCoordinator.release(buildLease)).toBe(true);

      const registryBefore = databases.readonly
        .query("SELECT * FROM capability_registry ORDER BY id")
        .all();
      const search = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=old`);
      expect(search.status).toBe(200);
      const normalizedSearch = await app.request(
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=${encodeURIComponent("cafe angstrom")}`,
      );
      expect(normalizedSearch.status).toBe(200);
      const normalizedHtml = await normalizedSearch.text();
      expect(normalizedHtml).toContain("Ready to remove — CAFÉ ÅNGSTRÖM");
      expect(normalizedHtml).toContain("data-detail-template");

      const listSearch = await app.request(
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=${encodeURIComponent("Doe")}`,
      );
      expect(listSearch.status).toBe(200);
      expect(await listSearch.text()).toContain("Doe, Jane");

      const noMatches = await app.request(
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=definitely-missing`,
      );
      expect(noMatches.status).toBe(200);
      expect((await noMatches.text()).trim()).toBe("");

      for (const literal of ["%", "_", "'"]) {
        const metacharacterSearch = await app.request(
          `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=${encodeURIComponent(literal)}`,
        );
        expect(metacharacterSearch.status).toBe(200);
        expect((await metacharacterSearch.text()).trim()).toBe("");
      }

      const readHtml = await (
        await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)
      ).text();
      const whitespaceSearch = await (
        await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=%E2%80%83%20%09`)
      ).text();
      expect(whitespaceSearch).toBe(readHtml);
      expect(
        databases.readonly.query("SELECT * FROM capability_registry ORDER BY id").all(),
      ).toEqual(registryBefore);
      expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
      expect(providerCalls).toBe(0);

      const before = databases.readwrite
        .query(`SELECT * FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
        .get(FIELD_LIFECYCLE_MERGE_TARGET_ID) as Record<string, unknown>;
      const update = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/update`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          ["entry", "A changed beginning"],
          ["__aluna_present", "entry"],
          ["__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID],
        ]).toString(),
      });
      expect(update.status).toBe(200);
      expect(await update.text()).toContain("A changed beginning");
      const after = databases.readwrite
        .query(`SELECT * FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
        .get(FIELD_LIFECYCLE_MERGE_TARGET_ID) as Record<string, unknown>;
      expect(after).toMatchObject({
        id: before.id,
        created_at: before.created_at,
        entry: "A changed beginning",
        reflection: before.reflection,
        tags: before.tags,
        aliases: before.aliases,
        retired_note: before.retired_note,
        extra: before.extra,
      });
      const refreshed = await (
        await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)
      ).text();
      expect(refreshed).toContain("A changed beginning");
      expect(refreshed).toContain("kept");
      expect(refreshed).toContain("Doe, Jane");
      expect(refreshed).toContain("J. Doe");
      expect(refreshed).not.toContain("hidden survives update");
      expect(refreshed).not.toContain("merge-demo");

      const historical = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/update`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          ["reflection", "Must not save"],
          ["__aluna_present", "reflection"],
          ["__aluna_record_id", FIELD_LIFECYCLE_HISTORICAL_TARGET_ID],
        ]).toString(),
      });
      expect(historical.status).toBe(422);
      expect(historical.headers.get("HX-Retarget")).toBe(`#${FIELD_LIFECYCLE_DEMO_ID}-edit-error`);
      expect(await historical.text()).toContain('data-error-code="missing_required_fields"');
      expect(
        databases.readwrite
          .query(`SELECT "reflection" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
          .get(FIELD_LIFECYCLE_HISTORICAL_TARGET_ID),
      ).toEqual({ reflection: "This row predates logical requiredness." });

      const remove = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/delete`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          __aluna_record_id: FIELD_LIFECYCLE_DELETE_TARGET_ID,
        }).toString(),
      });
      expect(remove.status).toBe(200);
      expect(await remove.text()).toContain('data-demo-result="deleted"');
      expect(
        databases.readwrite
          .query(`SELECT "id" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "id" = ?`)
          .get(FIELD_LIFECYCLE_DELETE_TARGET_ID),
      ).toBeNull();
      const afterDelete = await (
        await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)
      ).text();
      expect(afterDelete).not.toContain(FIELD_LIFECYCLE_DELETE_TARGET_ID);

      for (const action of ["update", "delete"] as const) {
        const body = new URLSearchParams({ __aluna_record_id: "bogus-target" });
        const response = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        expect(response.status).toBe(404);
        expect(response.headers.get("HX-Retarget")).toBe(refusalTargetByAction[action]);
        const fragment = await response.text();
        expect(fragment).toContain('data-error-code="record_not_found"');
        expect(fragment).not.toMatch(/handler|route|record target|reference/i);
      }
      expect(FIELD_LIFECYCLE_DEMO_SPEC.tools).toEqual([
        "create",
        "read",
        "update",
        "delete",
        "search",
      ]);
    } finally {
      databases.readonly.close();
      databases.readwrite.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
