import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import {
  FIELD_LIFECYCLE_DEMO_ID,
  FIELD_LIFECYCLE_DEMO_SPEC,
  installFieldLifecycleDemo,
} from "./field-lifecycle.ts";

describe("field lifecycle living demo", () => {
  let dir: string;
  let databases: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aluna-field-lifecycle-demo-"));
    databases = openDatabase(join(dir, "demo.db"));
    runMigrations(databases.readwrite);
    installFieldLifecycleDemo({
      database: databases.readwrite,
      artifactsRoot: join(dir, "capabilities"),
    });
  });

  afterEach(() => {
    databases.readonly.close();
    databases.readwrite.close();
    rmSync(dir, { force: true, recursive: true });
  });

  test("runs labels, lifecycle, null history, requiredness, and created_at through the real router", async () => {
    const app = createApp({ capabilityRouter: { databases } });

    const home = await (await app.request("/")).text();
    expect(home).toContain("Field lifecycle");
    expect(home).toContain(`/capability/${FIELD_LIFECYCLE_DEMO_ID}`);

    const view = await (await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}`)).text();
    expect(view).toContain("What happened?");
    expect(view).toContain("A small reflection");
    expect(view).toContain("Tags");
    expect(view).toContain("Other names");
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
        .get("historical-null"),
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
        ["tags", "   "],
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
        ["tags", "first"],
        ["tags", ""],
        ["tags", "one,two"],
        ["tags", "last"],
        ["__aluna_present", "entry"],
        ["__aluna_present", "reflection"],
        ["__aluna_present", "tags"],
        ["__aluna_present", "aliases"],
      ]).toString(),
    });
    expect(created.status).toBe(200);
    const createdHtml = await created.text();
    expect(createdHtml).toContain("A visible win");
    expect(createdHtml.indexOf("first")).toBeLessThan(createdHtml.indexOf("one,two"));
    expect(createdHtml.indexOf("one,two")).toBeLessThan(createdHtml.indexOf("last"));
    expect(
      databases.readwrite
        .query(`SELECT "tags", "aliases" FROM "cap_${FIELD_LIFECYCLE_DEMO_ID}" WHERE "entry" = ?`)
        .get("A visible win"),
    ).toEqual({ tags: '["first","one,two","last"]', aliases: "[]" });

    const refreshed = await (
      await app.request(`/capability/${FIELD_LIFECYCLE_DEMO_ID}/read`)
    ).text();
    expect(refreshed.indexOf("first")).toBeLessThan(refreshed.indexOf("one,two"));
    expect(refreshed.indexOf("one,two")).toBeLessThan(refreshed.indexOf("last"));
  });
});
