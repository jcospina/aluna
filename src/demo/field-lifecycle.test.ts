import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
    expect(view).toContain('data-list-input-mode="comma_separated"');
    expect(view).toContain("Separate values with commas.");
    expect(view).toContain('data-list-input-mode="repeatable"');
    expect(view).toContain("data-list-field-add");
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
  });
});

describe("five-Action reference installer admission", () => {
  test("server-side refresh waits for shared mutation admission and gates before replacing live state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aluna-five-action-refresh-"));
    const databases = openDatabase(join(dir, "demo.db"));
    const artifactsRoot = join(dir, "capabilities");
    try {
      runMigrations(databases.readwrite);
      await installReference(databases.readwrite, artifactsRoot);
      const mutationCoordinator = createMutationCoordinator();
      const recordLease = mutationCoordinator.tryAcquireRecordWrite();
      if (!recordLease) throw new Error("expected a record lease");
      const app = createApp({
        artifactsRoot,
        buildDatabases: databases,
        capabilityRouter: { databases },
        mutationCoordinator,
      });

      const refresh = app.request("/demo/five-action-reference/install", { method: "POST" });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (
          mutationCoordinator.snapshot().queuedTickets.some((ticket) => ticket.kind === "build")
        ) {
          break;
        }
        await Bun.sleep(5);
      }

      expect(mutationCoordinator.snapshot()).toMatchObject({
        activeLease: { kind: "record" },
        queuedTickets: [{ kind: "build" }],
      });
      expect(mutationCoordinator.release(recordLease)).toBe(true);

      const response = await refresh;
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        gate: Array<{ rung: string; status: string }>;
      };
      expect(body.status).toBe("installed");
      expect(body.gate.map(({ rung, status }) => `${rung}:${status}`)).toEqual([
        "structural:passed",
        "smoke:passed",
        "behavioral:skipped",
        "design-lint:passed",
      ]);
      expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
      expect(await (await app.request("/")).text()).toContain("Journal entry");
    } finally {
      databases.readonly.close();
      databases.readwrite.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the tracer intentionally proves the complete route lifecycle in one database.
describe("five-Action reference route inventory", () => {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: one tracer keeps race, CRUD, normalization, and preservation assertions ordered.
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
      const app = createApp({ capabilityRouter: { databases }, mutationCoordinator });

      const reservation = mutationCoordinator.reserveBuild();
      const buildLease = await mutationCoordinator.acquireBuild(reservation);
      for (const path of [
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`,
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=old`,
      ]) {
        expect((await app.request(path)).status).toBe(200);
      }
      for (const action of ["create", "update", "delete"] as const) {
        const body = new URLSearchParams();
        if (action !== "create") body.set("__aluna_record_id", FIELD_LIFECYCLE_MERGE_TARGET_ID);
        expect(
          (
            await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/${action}`, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            })
          ).status,
        ).toBe(422);
      }
      expect(mutationCoordinator.release(buildLease)).toBe(true);

      const search = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=old`);
      expect(search.status).toBe(200);
      const normalizedSearch = await app.request(
        `/capability/${FIELD_LIFECYCLE_DEMO_ID}/search?q=${encodeURIComponent("Cafe\u0301 a\u030angstro\u0308m")}`,
      );
      expect(normalizedSearch.status).toBe(200);
      expect(await normalizedSearch.text()).toContain("Ready to remove — CAFÉ ÅNGSTRÖM");

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
      expect(refreshed).toContain("Preserved alias");
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

      for (const action of ["update", "delete"] as const) {
        const body = new URLSearchParams({ __aluna_record_id: "bogus-target" });
        const response = await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        expect(response.status).toBe(404);
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
