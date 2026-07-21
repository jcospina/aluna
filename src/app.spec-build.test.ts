// GET /demo/spec-build (builder-stage liveness, fake provider) — the happy-path
// slices. The demo commits for real (Epic 2.5g): migration, gate, and registry
// insert ride a scratch db pair, and committed artifacts land in a throwaway
// directory — never the real data file or the tracked capabilities/ tree. The same
// scratch pair is handed to the capability router so a committed build is immediately
// routable in the same test.
//
// The headline "narrates, previews stages, commit-swaps content and toolbar, and
// closes" case runs one build and then makes a long, ordered sequence of assertions
// over every streamed stage. Those assertions are grouped VERBATIM into the
// module-scope assert* helpers below (each stage's checks, in original order) so the
// test body stays a readable script of stage checks — no assertion is changed,
// added, removed, or reordered. Shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  BEHAVIORAL_SUITE,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  makeSpecProvider,
  NOTES_SPEC,
  readSse,
  SEARCH_HANDLER,
  type SseEvent,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import type { PlatformDatabase } from "./db.ts";
import type { GenerationMetrics } from "./metrics/index.ts";
import type { Provider } from "./provider/index.ts";
import { getCapability, MISSING_REQUIRED_FIELDS_ERROR_CODE } from "./registry/index.ts";

setDefaultTimeout(15_000);

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

// Build the demo app wired to commit against the scratch db + temp artifacts root,
// sharing the scratch pair with the router so a committed capability is routable.
function committingApp(provider: Provider, recordMetrics: (m: GenerationMetrics) => void) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

function assertBuildEventOrder(events: SseEvent[]): void {
  const eventNames = events.map((event) => event.event);
  expect(eventNames[0]).toBe("narration");
  expect(eventNames).toContain("spec-preview");
  expect(eventNames).toContain("migration-preview");
  expect(eventNames).toContain("units-preview");
  expect(eventNames).toContain("gate-preview");
  expect(eventNames).toContain("commit-preview");
  expect(eventNames.at(-2)).toBe("commit");
  expect(eventNames.at(-1)).toBe("done");
  expect(eventNames.indexOf("units-preview")).toBeGreaterThan(
    eventNames.indexOf("migration-preview"),
  );
  expect(eventNames.indexOf("gate-preview")).toBeGreaterThan(
    eventNames.lastIndexOf("units-preview"),
  );
  // Commit is the terminal stage: it lands strictly after the gate passes and just
  // before the stream closes.
  expect(eventNames.indexOf("commit-preview")).toBeGreaterThan(eventNames.indexOf("gate-preview"));
  expect(eventNames.indexOf("commit-preview")).toBeLessThan(eventNames.indexOf("commit"));
}

function assertSpecAndMigrationPreview(dataFor: (name: string) => string): void {
  // The demo preview deliberately carries the raw spec (the developer's liveness
  // view) — internals here are the point.
  expect(dataFor("spec-preview")).toContain("schema");
  expect(dataFor("spec-preview")).toContain("ui_intent");
  expect(dataFor("spec-preview")).toContain("collection");
  expect(dataFor("spec-preview")).toContain("feed");
  expect(dataFor("spec-preview")).toContain("detail");
  expect(dataFor("spec-preview")).toContain('"tools":["create","read","update","delete","search"]');
  expect(dataFor("spec-preview")).toContain(
    '"read_dependencies":{"create":[],"read":[],"update":[],"delete":[],"search":[]}',
  );
  expect(dataFor("spec-preview")).not.toContain("views");
  expect(dataFor("spec-preview")).not.toContain("modal");
  expect(dataFor("spec-preview")).toContain("notes");

  const migrationPreview = JSON.parse(dataFor("migration-preview")) as {
    kind: string;
    tableName: string;
    sql: string;
    columns: Array<{ name: string; type: string; required: boolean; primaryKey: boolean }>;
  };
  expect(migrationPreview.kind).toBe("migration-preview");
  expect(migrationPreview.tableName).toBe("cap_notes");
  expect(migrationPreview.sql).toContain('CREATE TABLE "cap_notes"');
  expect(migrationPreview.columns.slice(0, 3)).toMatchObject([
    { name: "id", type: "TEXT", required: true, primaryKey: true, defaultValue: null },
    {
      name: "created_at",
      type: "TEXT",
      required: true,
      primaryKey: false,
      defaultValue: "datetime('now')",
    },
    { name: "extra", type: "TEXT", required: true, primaryKey: false, defaultValue: "'{}'" },
  ]);
  expect(migrationPreview.columns.map((column) => column.name)).toContain("text");
}

function assertUnitsPreview(events: SseEvent[]): void {
  const unitPreviewEvents = events.filter((event) => event.event === "units-preview");
  expect(unitPreviewEvents.length).toBeGreaterThan(1);
  const firstUnitsPreview = JSON.parse(unitPreviewEvents[0]?.data ?? "") as {
    status: string;
    units: Array<{ kind: string; name: string; status: string; content: string }>;
  };
  expect(firstUnitsPreview.status).toBe("running");
  expect(firstUnitsPreview.units[0]).toMatchObject({
    kind: "item-renderer",
    name: "item",
    status: "generating",
  });

  const unitsPreview = JSON.parse(unitPreviewEvents.at(-1)?.data ?? "") as {
    kind: string;
    status: string;
    codeGenDurationMs: number;
    presentationGenDurationMs: number;
    units: Array<{
      kind: string;
      name: string;
      filename: string;
      attempts: number;
      content: string;
    }>;
  };
  expect(unitsPreview.kind).toBe("unit-generation-preview");
  expect(unitsPreview.status).toBe("complete");
  expect(unitsPreview.codeGenDurationMs).toBeGreaterThanOrEqual(0);
  expect(unitsPreview.presentationGenDurationMs).toBeGreaterThanOrEqual(0);
  expect(unitsPreview.units.map((unit) => `${unit.kind}:${unit.name}:${unit.filename}`)).toEqual([
    "item-renderer:item:item.ts",
    "handler:create:create.ts",
    "handler:read:read.ts",
    "handler:update:update.ts",
    "handler:delete:delete.ts",
    "handler:search:search.ts",
  ]);
  expect(unitsPreview.units.every((unit) => unit.attempts === 1)).toBe(true);
  expect(unitsPreview.units.find((unit) => unit.filename === "create.ts")?.content).toContain(
    "export default async function create",
  );
  expect(unitsPreview.units.find((unit) => unit.filename === "create.ts")?.content).toContain(
    "present(note)",
  );
  expect(unitsPreview.units.find((unit) => unit.filename === "item.ts")?.content).toContain(
    "export default function renderItem",
  );
}

function assertGatePreview(dataFor: (name: string) => string): void {
  const gatePreview = JSON.parse(dataFor("gate-preview")) as {
    kind: string;
    status: string;
    durationMs: number;
    rungs: Array<{ rung: string; status: string; durationMs: number }>;
    structural: {
      units: Array<{ kind: string; name: string; filename: string; status: string }>;
    };
    smoke: {
      tableName: string;
      rowCount: number;
      createFragmentLength: number;
      readFragmentLength: number;
      realDatabaseUnchanged: boolean;
    };
    behavioral: {
      tier: string;
      status: string;
      testGen: { outcome: string; testCount: number; usage: { totalTokens: number } };
      testRun: { outcome: string; cases: Array<{ action: string; name: string; status: string }> };
    };
  };
  expect(gatePreview.kind).toBe("gate-preview");
  expect(gatePreview.structural.units).toEqual([
    { kind: "spec", name: "spec", filename: "spec.json", status: "passed" },
    { kind: "item-renderer", name: "item", filename: "item.ts", status: "passed" },
    { kind: "handler", name: "create", filename: "create.ts", status: "passed" },
    { kind: "handler", name: "read", filename: "read.ts", status: "passed" },
    { kind: "handler", name: "update", filename: "update.ts", status: "passed" },
    { kind: "handler", name: "delete", filename: "delete.ts", status: "passed" },
    { kind: "handler", name: "search", filename: "search.ts", status: "passed" },
  ]);
  expect(gatePreview.status).toBe("passed");
  expect(gatePreview.durationMs).toBeGreaterThanOrEqual(0);
  expect(gatePreview.rungs.map((rung) => `${rung.rung}:${rung.status}`)).toEqual([
    "structural:passed",
    "smoke:passed",
    "behavioral:passed",
    "design-lint:passed",
  ]);
  expect(gatePreview.rungs.every((rung) => rung.durationMs >= 0)).toBe(true);
  expect(gatePreview.smoke).toMatchObject({
    tableName: "cap_notes",
    rowCount: 1,
    realDatabaseUnchanged: true,
  });
  expect(gatePreview.smoke.createFragmentLength).toBeGreaterThan(0);
  expect(gatePreview.smoke.readFragmentLength).toBeGreaterThan(0);
  expect(gatePreview.behavioral).toMatchObject({
    tier: "on",
    status: "passed",
    testGen: { outcome: "passed", testCount: 9, usage: { totalTokens: 53 } },
  });
  expect(gatePreview.behavioral.testRun.outcome).toBe("passed");
  expect(gatePreview.behavioral.testRun.cases.map((testCase) => testCase.action)).toEqual([
    "create",
    "read",
    "update",
    "delete",
    "search",
    "create",
    "update",
    "update",
    "delete",
  ]);
  expect(
    gatePreview.behavioral.testRun.cases.every((testCase) => testCase.status === "passed"),
  ).toBe(true);
}

function assertNarrationCommitAndPrompts(
  dataFor: (name: string) => string,
  prompts: string[],
): void {
  // The product-voice narration must NOT leak internals (ARCH §9.7). The commit
  // event carries generated HTML, including classes and HTMX attributes, so the
  // internals check stays scoped to visible narration copy.
  expect(dataFor("narration")).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
  const commitSwap = dataFor("commit");
  expect(commitSwap).toContain('class="capability-surface"');
  expect(commitSwap).toContain('data-active-capability-id="notes"');
  expect(commitSwap).toContain('hx-get="/capability/notes/read"');
  expect(commitSwap).toContain('hx-post="/capability/notes/create"');
  expect(commitSwap).toContain('data-search-url="/capability/notes/search"');
  expect(commitSwap).toContain("data-capability-search");
  expect(commitSwap).toContain('hx-swap="none"');
  expect(commitSwap).toContain("data-post-mutation-refresh");
  expect(commitSwap).toContain('data-records-target-id="notes-records"');
  expect(commitSwap).toContain('data-read-url="/capability/notes/read"');
  expect(commitSwap).toContain('hx-swap-oob="beforeend:#capability-toolbar"');
  expect(commitSwap).toContain("data-capability-entry");
  expect(commitSwap).toContain('hx-get="/capability/notes"');
  expect(commitSwap).toContain("Notes");
  expect(dataFor("done")).toBe("ok");

  // The typed prompt reached the provider, then the complete unit-generation prompts
  // (item renderer, then all five handlers) and the behavioral test-generation
  // prompt followed — proof the demo runs the current builder stages, not a canned string.
  expect(prompts).toHaveLength(8);
  expect(prompts[0]).toContain("track my notes");
  expect(prompts[0]).toContain(
    "tools: exactly [create, read, update, delete, search] in that canonical order",
  );
  expect(prompts[0]).toContain('"update": [], "delete": [], "search": []');
  expect(prompts[0]).toContain("ui_intent.collection.layout is one of: feed | grid");
  expect(prompts[0]).toContain("Do not include ui_intent.views");
  expect(prompts[1]).toContain("Generate the item.ts item renderer");
  expect(prompts[2]).toContain("Generate the create.ts handler");
  expect(prompts[3]).toContain("Generate the read.ts handler");
  expect(prompts[4]).toContain("Generate the update.ts handler");
  expect(prompts[5]).toContain("Generate the delete.ts handler");
  expect(prompts[6]).toContain("Generate the search.ts handler");
  expect(prompts[7]).toContain("Text is required. Newest notes appear first.");
  expect(prompts[7]).toContain('"schema"');
  expect(prompts[7]).toContain('"behavioral_errors"');
  expect(prompts[7]).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
  expect(prompts[7]).not.toContain("export default async function");
}

function assertBuildMetrics(rows: GenerationMetrics[]): void {
  // A successful build writes exactly one metrics row (Epic 2.7), before `done`,
  // carrying the PLAN step-8 fields: intent, the built capability, the full timing
  // breakdown including test-gen/test-run, the per-rung gate outcomes, and the
  // per-unit fix-loop attempts.
  expect(rows).toHaveLength(1);
  const metrics = rows[0];
  expect(metrics?.outcome).toBe("success");
  expect(metrics?.capabilityId).toBe("notes");
  expect(metrics?.incarnationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(metrics?.intent.type).toBe("new_capability");
  expect(metrics?.failure).toBeUndefined();
  expect(metrics?.timings?.specGenMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.timings?.codeGenMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.timings?.presentationGenMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.timings?.testGenMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.timings?.testRunMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.timings?.totalMs).toBeGreaterThanOrEqual(0);
  expect(metrics?.gateRungs?.map((rung) => rung.rung)).toEqual([
    "structural",
    "smoke",
    "behavioral",
    "design-lint",
  ]);
  expect(metrics?.unitAttempts?.map((unit) => `${unit.kind}:${unit.name}`)).toEqual([
    "item-renderer:item",
    "handler:create",
    "handler:read",
    "handler:update",
    "handler:delete",
    "handler:search",
  ]);
}

function assertCommitPreviewAndArtifacts(
  dataFor: (name: string) => string,
  rows: GenerationMetrics[],
  artifactsRootPath: string,
  databases: PlatformDatabase,
): void {
  const metrics = rows[0];
  // Commit is real: the developer commit-preview reports the committed capability,
  // its version, the pointer, and the files written to the version directory.
  const commitPreview = JSON.parse(dataFor("commit-preview")) as {
    kind: string;
    status: string;
    capabilityId: string;
    incarnationId: string;
    version: number;
    buildId: string;
    artifactsPath: string;
    snapshotVerified: boolean;
    snapshotContentDigest: string;
    behavioralTier: string;
    files: string[];
  };
  expect(commitPreview.kind).toBe("commit-preview");
  expect(commitPreview.status).toBe("committed");
  expect(commitPreview.capabilityId).toBe("notes");
  expect(commitPreview.incarnationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(metrics?.incarnationId).toBe(commitPreview.incarnationId);
  expect(commitPreview.version).toBe(1);
  expect(metrics?.id).toBe(commitPreview.buildId);
  expect(commitPreview.snapshotVerified).toBe(true);
  expect(commitPreview.snapshotContentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(commitPreview.behavioralTier).toBe("on");
  expect(commitPreview.artifactsPath).toBe(
    `${artifactsRootPath}/notes/${commitPreview.incarnationId}/v1/`,
  );
  expect(commitPreview.files).toEqual([
    "create.ts",
    "delete.ts",
    "item.ts",
    "read.ts",
    "search.ts",
    "snapshot.json",
    "spec.json",
    "tests/behavioral.json",
    "update.ts",
  ]);

  // The registry row landed at v1 with the artifacts pointer (the pointer flip)…
  const committed = getCapability("notes", databases.readonly);
  expect(committed?.incarnation_id).toBe(commitPreview.incarnationId);
  expect(committed?.version).toBe(1);
  expect(committed?.artifacts_path).toBe(commitPreview.artifactsPath);
  expect(committed?.label).toBe("Notes");
  expect(committed?.tools).toEqual(["create", "read", "update", "delete", "search"]);
  expect(committed?.read_dependencies).toEqual({
    create: [],
    read: [],
    update: [],
    delete: [],
    search: [],
  });

  // …and the exact manifest-backed tier-on inventory is on disk.
  for (const file of commitPreview.files) {
    expect(existsSync(resolve(commitPreview.artifactsPath, file))).toBe(true);
  }
}

describe("GET /demo/spec-build (builder-stage liveness, fake provider)", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("narrates, previews stages, commit-swaps content and toolbar, and closes", async () => {
    const { provider, prompts } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20my%20notes")),
    );
    const dataFor = (name: string) => eventData(events, name);

    assertBuildEventOrder(events);
    assertSpecAndMigrationPreview(dataFor);
    assertUnitsPreview(events);
    assertGatePreview(dataFor);
    assertNarrationCommitAndPrompts(dataFor, prompts);
    assertBuildMetrics(rows);
    assertCommitPreviewAndArtifacts(dataFor, rows, artifactsRoot, conns);
  });

  test("commits the search Handler repaired by the always-on smoke fixture", async () => {
    const poisonedSearch = SEARCH_HANDLER.replaceAll("platform_search_normalize", "lower");
    const { provider, prompts } = makeSpecProvider(NOTES_SPEC, BEHAVIORAL_SUITE, {
      search: poisonedSearch,
      searchRepair: SEARCH_HANDLER,
    });
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const events = collectSseEvents(
      await readSse(await app.request("/demo/spec-build?prompt=track%20my%20notes")),
    );
    expect(events.at(-1)).toEqual({ id: expect.any(String), event: "done", data: "ok" });
    const preview = JSON.parse(eventData(events, "gate-preview")) as {
      smoke: { fixed: boolean; attempts: Array<{ action?: string; error?: string }> };
    };
    expect(preview.smoke.fixed).toBe(true);
    expect(preview.smoke.attempts).toHaveLength(2);
    expect(preview.smoke.attempts[0]).toMatchObject({
      action: "search",
      error: expect.any(String),
    });
    const repairedUnits = JSON.parse(
      events.filter((event) => event.event === "units-preview").at(-1)?.data ?? "",
    ) as { units: Array<{ name: string; attempts: number; content: string }> };
    expect(repairedUnits.units.find((unit) => unit.name === "search")).toMatchObject({
      attempts: 2,
      content: SEARCH_HANDLER,
    });

    const committed = getCapability("notes", conns.readonly);
    if (!committed) throw new Error("repaired capability did not commit");
    expect(await Bun.file(resolve(committed.artifacts_path, "search.ts")).text()).toBe(
      SEARCH_HANDLER,
    );
    expect(prompts).toHaveLength(9);
    expect(prompts[7]).toContain("Previous attempt failed");
    expect(prompts[7]).toContain("Generate the search.ts handler");
    expect(prompts[8]).toContain("behavioral tests for every Action in this Aluna capability");
    expect(rows[0]?.outcome).toBe("success");
    expect(rows[0]?.unitAttempts?.find((unit) => unit.name === "search")?.attempts).toBe(2);
  });
});

describe("GET /demo/spec-build (builder-stage liveness, fake provider) — router round-trip", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-spec-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("commits a capability that immediately exercises full CRUD and search", async () => {
    // Prompt → committed capability → all five Actions through the deterministic
    // router, all on a fake provider, no real
    // calls. The router shares the build's scratch db pair and resolves the committed
    // handler files from the temp artifacts directory.
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const buildPayload = await readSse(
      await app.request("/demo/spec-build?prompt=track%20my%20notes"),
    );
    expect(buildPayload).toContain("event: commit-preview");
    expect(buildPayload).toContain("event: commit");
    expect(collectSseEvents(buildPayload).at(-1)).toEqual({
      id: expect.any(String),
      event: "done",
      data: "ok",
    });
    expect(rows[0]?.outcome).toBe("success");

    // create through the router: the committed handler persists the note and returns
    // a fragment carrying it.
    const created = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Buy milk"],
        ["__aluna_present", "text"],
      ]).toString(),
    });
    expect(created.status).toBe(200);
    expect(await created.text()).toContain("Buy milk");

    // read through the router: a fragment carrying the persisted note.
    const read = await app.request("/capability/notes/read");
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("Buy milk");

    const target = conns.readonly
      .query('SELECT "id" FROM "cap_notes" WHERE "text" = ?')
      .get("Buy milk") as { id: string } | null;
    expect(target?.id).toBeTruthy();

    const updated = await app.request("/capability/notes/update", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Buy oat milk"],
        ["__aluna_present", "text"],
        ["__aluna_record_id", target?.id ?? ""],
      ]).toString(),
    });
    expect(updated.status).toBe(200);
    expect(await updated.text()).toContain("Buy oat milk");

    const searched = await app.request("/capability/notes/search?q=oat");
    expect(searched.status).toBe(200);
    expect(await searched.text()).toContain("Buy oat milk");

    const nonMatch = await app.request("/capability/notes/search?q=coffee");
    expect(nonMatch.status).toBe(200);
    expect(await nonMatch.text()).not.toContain("Buy oat milk");

    const deleted = await app.request("/capability/notes/delete", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([["__aluna_record_id", target?.id ?? ""]]).toString(),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.text()).toBe("");

    const afterDelete = await app.request("/capability/notes/read");
    expect(await afterDelete.text()).not.toContain("Buy oat milk");
  });

  test("falls back to the default prompt when the field is empty", async () => {
    const { provider, prompts } = makeSpecProvider(NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = committingApp(provider, recordMetrics);

    const payload = await readSse(await app.request("/demo/spec-build"));

    expect(payload).toContain("event: done");
    expect(prompts[0]).toContain("I want to keep track of my notes");
    expect(rows[0]?.outcome).toBe("success");
  });
});
