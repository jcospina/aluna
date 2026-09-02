// Full delete/recreate lifecycle at the public app boundary. Both capability
// lifetimes run through the real resolver, Core Builder, Gate, publisher,
// registry activation, deletion route, and default router module loader. The
// provider is fake and every durable side effect stays inside one scratch root.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  BEHAVIORAL_SUITE,
  createScratchDbEnv,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  READ_HANDLER,
  runPromptBuild,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../app/app.test-support.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import { getCapability, insertCapabilityDeletionTombstone } from "../registry/index.ts";
import { formBody, install, notesRow } from "../router/router.test-support.ts";

setDefaultTimeout(30_000);

function readHandlerWithLifetimeMarker(marker: string): string {
  return READ_HANDLER.replace(
    '  return notes.map(({ record }) => present(record)).join("");',
    [
      '  const fragment = notes.map(({ record }) => present(record)).join("");',
      `  return fragment.length === 0 ? "" : "${marker}" + fragment;`,
    ].join("\n"),
  );
}

function deletionBody(incarnationId: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ incarnation_id: incarnationId }),
  };
}

describe("permanent capability deletion followed by same-id recreation", () => {
  let env: ScratchDbEnv;
  let conns: PlatformDatabase;

  beforeEach(() => {
    env = createScratchDbEnv("aluna-delete-recreate-");
    conns = env.conns;
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("recreates fresh v1 code at a new incarnation path instead of using Bun's deleted module cache", async () => {
    const oldProvider = makePromptBuildProvider(
      NEW_CAPABILITY_INTENT,
      NOTES_SPEC,
      BEHAVIORAL_SUITE,
      { read: readHandlerWithLifetimeMarker("OLD_LIFETIME:") },
    ).provider;
    const oldMetrics = makeMetricsRecorder();
    const oldApp = makeScratchApp(env, oldProvider, oldMetrics.recordMetrics);

    const oldBuild = await runPromptBuild(oldApp, "Track my notes");
    expect(oldBuild.events.at(-1)).toMatchObject({ event: "done", data: "ok" });
    const oldRow = getCapability("notes", conns.readonly);
    if (!oldRow) throw new Error("the first Notes lifetime did not activate");
    expect(oldRow.version).toBe(1);
    expect(existsSync(oldRow.artifacts_path)).toBe(true);
    expect(readFileSync(`${oldRow.artifacts_path}read.ts`, "utf8")).toContain("OLD_LIFETIME:");

    expect(
      (await oldApp.request("/capability/notes/create", formBody({ text: "Old note" }, ["text"])))
        .status,
    ).toBe(200);
    const oldRead = await (await oldApp.request("/capability/notes/read")).text();
    expect(oldRead).toContain("OLD_LIFETIME:");
    expect(oldRead).toContain("Old note");

    const deletion = await oldApp.request(
      "/capability-deletion/notes/confirm",
      deletionBody(oldRow.incarnation_id),
    );
    expect(deletion.status).toBe(200);
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(existsSync(oldRow.artifacts_path)).toBe(false);
    expect((await oldApp.request("/capability/notes/read")).status).toBe(404);

    const freshProvider = makePromptBuildProvider(
      NEW_CAPABILITY_INTENT,
      NOTES_SPEC,
      BEHAVIORAL_SUITE,
      { read: readHandlerWithLifetimeMarker("FRESH_LIFETIME:") },
    ).provider;
    const freshMetrics = makeMetricsRecorder();
    const freshApp = makeScratchApp(env, freshProvider, freshMetrics.recordMetrics);

    const freshBuild = await runPromptBuild(freshApp, "Track my notes again");
    expect(freshBuild.events.at(-1)).toMatchObject({ event: "done", data: "ok" });
    const freshRow = getCapability("notes", conns.readonly);
    if (!freshRow) throw new Error("the recreated Notes lifetime did not activate");
    expect(freshRow.version).toBe(1);
    expect(freshRow.incarnation_id).not.toBe(oldRow.incarnation_id);
    expect(freshRow.artifacts_path).not.toBe(oldRow.artifacts_path);
    expect(existsSync(freshRow.artifacts_path)).toBe(true);
    expect(readFileSync(`${freshRow.artifacts_path}read.ts`, "utf8")).toContain("FRESH_LIFETIME:");

    expect(
      (
        await freshApp.request(
          "/capability/notes/create",
          formBody({ text: "Fresh note" }, ["text"]),
        )
      ).status,
    ).toBe(200);
    const freshRead = await (await freshApp.request("/capability/notes/read")).text();
    expect(freshRead).toContain("FRESH_LIFETIME:");
    expect(freshRead).toContain("Fresh note");
    expect(freshRead).not.toContain("OLD_LIFETIME:");
    expect(freshRead).not.toContain("Old note");

    expect(oldMetrics.rows.at(-1)?.incarnationId).toBe(oldRow.incarnation_id);
    expect(freshMetrics.rows.at(-1)?.incarnationId).toBe(freshRow.incarnation_id);
  });

  // A tombstone whose cleanup is owed keeps reserving the id, and the rebuild path used to
  // discover that only at the activation CAS — after the spec, six units, the whole Gate and
  // the published artifacts had been generated and paid for, every time, for as long as the
  // tombstone stood. The lease-head check cannot catch it, because an ordinary "track my
  // notes" names no id for it to test.
  test("refuses a rebuild of a reserved id as soon as the id is known, before any unit is generated", async () => {
    const target = notesRow();
    install(conns, target);
    insertCapabilityDeletionTombstone(
      { capabilityId: target.id, incarnationId: target.incarnation_id, manifest: [] },
      conns.readwrite,
    );

    const fake = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC, BEHAVIORAL_SUITE);
    const build = await runPromptBuild(
      makeScratchApp(env, fake.provider, makeMetricsRecorder().recordMetrics),
      "Track my notes",
    );

    expect(build.events.at(-1)).toMatchObject({ event: "done", data: "error" });
    // The ending says what is true rather than inviting a retry that cannot succeed.
    expect(build.events.map((event) => event.data).join("\n")).toContain("still tidying up");
    // Two provider calls: classify the request, author the spec. Nothing after that — no
    // behavioral freeze, no units, no Gate.
    expect(fake.prompts).toHaveLength(2);
    expect(getCapability("notes", conns.readonly)).toBeNull();
  });
});
