import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import type { CapabilityRow } from "../registry/index.ts";
import {
  boomRow,
  install,
  makeSpyLoader,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { createApp } from "./app.ts";

function dependentOnNotes(id = "reading_list", label = "Reading list"): CapabilityRow {
  const notes = notesRow();
  return {
    ...boomRow(),
    id,
    label,
    read_dependencies: {
      create: [],
      read: [{ capability_id: notes.id, incarnation_id: notes.incarnation_id }],
      update: [],
      delete: [],
      search: [],
    },
  };
}

function confirmationRequest(incarnationId: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ incarnation_id: incarnationId }),
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one shared scratch-runtime lifecycle keeps the route contract coherent.
describe("platform-owned capability deletion routes", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the homepage toolbar, advisory preflight, and Confirm make zero AI or Handler calls", async () => {
    const target = notesRow();
    const dependent = dependentOnNotes();
    install(conns, target);
    install(conns, dependent);
    let providerCalls = 0;
    let resolverRuns = 0;
    let jobCreations = 0;
    const loader = makeSpyLoader();
    const buildJobs = createBuildJobQueue({
      pipeline: async () => {
        resolverRuns += 1;
      },
    });
    const createBuildJob = buildJobs.create.bind(buildJobs);
    buildJobs.create = (...args: Parameters<typeof createBuildJob>) => {
      jobCreations += 1;
      return createBuildJob(...args);
    };
    const app = createApp({
      getProvider: () => {
        providerCalls += 1;
        throw new Error("provider must stay cold during capability deletion");
      },
      buildJobs,
      capabilityRouter: { databases: conns, loadHandler: loader.loadHandler },
    });

    const shell = await (await app.request("/")).text();
    expect(shell).toContain('aria-label="Permanently delete Notes"');
    expect(shell).toContain('hx-get="/capability-deletion/notes"');

    const preflight = await (await app.request("/capability-deletion/notes")).text();
    expect(preflight).toContain("Delete Notes permanently?");
    expect(preflight).toContain("Reading list currently uses Notes");
    expect(preflight).toContain("Aluna will check again before deleting anything");

    const confirmation = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(confirmation.status).toBe(200);
    expect(await confirmation.text()).toContain(
      "Notes can’t be deleted while Reading list uses it",
    );

    conns.readwrite.run("UPDATE capability_registry SET read_dependencies = ? WHERE id = ?", [
      JSON.stringify({ create: [], read: [], update: [], delete: [], search: [] }),
      dependent.id,
    ]);
    const admitted = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(await admitted.text()).toContain("Nothing else uses Notes");
    expect(providerCalls).toBe(0);
    expect(resolverRuns).toBe(0);
    expect(jobCreations).toBe(0);
    expect(loader.calls).toEqual([]);
  });

  test("catches a dependency added after a clear preflight, then admits after it is removed", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    const admitted: string[] = [];
    const app = createApp({
      mutationCoordinator,
      capabilityRouter: { databases: conns },
      onCapabilityDeletionAdmitted: (row) => {
        expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
        admitted.push(row.id);
      },
    });

    const clearPreflight = await (await app.request("/capability-deletion/notes")).text();
    expect(clearPreflight).not.toContain("data-deletion-dependency-notice");

    const dependent = dependentOnNotes();
    install(conns, dependent);
    const raced = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(await raced.text()).toContain("Notes can’t be deleted while Reading list uses it");
    expect(admitted).toEqual([]);

    conns.readwrite.run("UPDATE capability_registry SET read_dependencies = ? WHERE id = ?", [
      JSON.stringify({ create: [], read: [], update: [], delete: [], search: [] }),
      dependent.id,
    ]);
    const clear = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    const clearHtml = await clear.text();
    expect(clearHtml).toContain("Nothing else uses Notes");
    expect(clearHtml).toContain("this step hasn’t removed anything yet");
    expect(admitted).toEqual([target.id]);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("immediately refuses a queued build without changing the queue", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    const reservation = mutationCoordinator.reserveBuild();
    const before = mutationCoordinator.snapshot();
    const app = createApp({
      mutationCoordinator,
      capabilityRouter: { databases: conns },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Aluna is making another change right now");
    expect(mutationCoordinator.snapshot()).toEqual(before);
    expect(mutationCoordinator.cancelBuild(reservation)).toBe(true);
  });

  test("refuses stale, missing, and duplicate incarnation evidence without continuation", async () => {
    const target = notesRow();
    install(conns, target);
    let admitted = false;
    const app = createApp({
      capabilityRouter: { databases: conns },
      onCapabilityDeletionAdmitted: () => {
        admitted = true;
      },
    });

    const stale = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest("99999999-9999-4999-8999-999999999999"),
    );
    expect(await stale.text()).toContain("changed after you opened this page");

    const duplicateBody = new URLSearchParams();
    duplicateBody.append("incarnation_id", target.incarnation_id);
    duplicateBody.append("incarnation_id", target.incarnation_id);
    const duplicate = await app.request("/capability-deletion/notes/confirm", {
      method: "POST",
      body: duplicateBody,
    });
    expect(await duplicate.text()).toContain("changed after you opened this page");
    expect(admitted).toBe(false);

    const missing = await app.request("/capability-deletion/missing/confirm", {
      method: "POST",
      body: new URLSearchParams({ incarnation_id: target.incarnation_id }),
    });
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("That part of Aluna is already gone");

    const missingPreflight = await app.request("/capability-deletion/missing");
    expect(missingPreflight.status).toBe(200);
    expect(await missingPreflight.text()).toContain("That part of Aluna is already gone");
  });
});
