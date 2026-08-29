import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import { createReadGateCoordinator } from "../read-gates/index.ts";
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

function deletionTarget(dir: string): CapabilityRow {
  const target = notesRow();
  return {
    ...target,
    artifacts_path: join(dir, "artifacts", target.id, target.incarnation_id, "v1"),
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
  };
}

function confirmationRequest(incarnationId: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ incarnation_id: incarnationId, restore_surface: "neutral" }),
  };
}

function confirmationWithRestoration(
  incarnationId: string,
  restoration: CapabilityRow,
): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({
      incarnation_id: incarnationId,
      restore_surface: "capability",
      restore_capability_id: restoration.id,
      restore_incarnation_id: restoration.incarnation_id,
    }),
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

  test("the homepage desk, advisory preflight, and Confirm make zero AI or Handler calls", async () => {
    const target = deletionTarget(dir);
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
      artifactsRoot: join(dir, "artifacts"),
      getProvider: () => {
        providerCalls += 1;
        throw new Error("provider must stay cold during capability deletion");
      },
      buildJobs,
      capabilityRouter: { databases: conns, loadHandler: loader.loadHandler },
    });

    // Deletion's doorway is the logo's own context menu and nowhere else (5.9/01). It
    // ships hidden with the logo, so nothing on the standing desk is a destructive
    // control, and there is exactly one of them per capability.
    const shell = await (await app.request("/")).text();
    expect(shell).toContain('id="capability-logo-notes"');
    expect(shell.split('hx-get="/capability-deletion/notes"').length - 1).toBe(1);
    // Hidden until someone asks for it, so a standing desk offers no destructive control
    // at all — and marked as a doorway, because the confirmation it opens fills the window
    // and the window does not exist until the desk is asked for one.
    expect(/data-logo-menu\s+data-ink\s+hidden/.test(shell)).toBe(true);
    expect(shell).toContain("data-window-doorway");

    const preflight = await (await app.request("/capability-deletion/notes")).text();
    expect(preflight).toContain("Delete Notes permanently?");
    expect(preflight).toContain("Reading list currently uses Notes");
    // First person, like every other line Aluna speaks (CONTEXT.md "Product voice").
    expect(preflight).toContain("I’ll check again before deleting anything");
    expect(preflight).not.toContain("Aluna will");

    const confirmation = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(confirmation.status).toBe(200);
    const confirmationHtml = await confirmation.text();
    expect(confirmationHtml).toContain("I can’t delete Notes while Reading list uses it");
    expect(confirmationHtml).not.toContain("data-active-capability-id");
    expect(confirmation.headers.get("HX-Replace-Url")).toBe("/");

    conns.readwrite.run("UPDATE capability_registry SET read_dependencies = ? WHERE id = ?", [
      JSON.stringify({ create: [], read: [], update: [], delete: [], search: [] }),
      dependent.id,
    ]);
    const admitted = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(await admitted.text()).toContain("I deleted Notes permanently");
    expect(providerCalls).toBe(0);
    expect(resolverRuns).toBe(0);
    expect(jobCreations).toBe(0);
    expect(loader.calls).toEqual([]);
  });

  test("Keep it restores the exact prior capability or the authoritative neutral surface", async () => {
    const target = deletionTarget(dir);
    const other = boomRow();
    install(conns, target);
    install(conns, other);
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
    });

    const fromOther = await (
      await app.request(
        `/capability-deletion/notes?restore_surface=capability&restore_capability_id=${other.id}&restore_incarnation_id=${other.incarnation_id}`,
      )
    ).text();
    expect(fromOther).toContain(
      'class="btn btn--neutral capability-deletion__keep" type="button" hx-get="/capability-deletion-restoration?',
    );
    expect(fromOther).toContain("restore_capability_id=boom");
    expect(fromOther).toContain(`restore_incarnation_id=${other.incarnation_id}`);
    // No `hx-push-url`: the restoration route answers with `HX-Replace-Url` naming where
    // it actually landed, a response header wins over the attribute, and Keep it is not a
    // navigation — it puts back what the confirmation displaced (design D14).
    expect(fromOther).not.toContain('hx-push-url="');
    expect(fromOther).toContain('name="restore_surface" value="capability"');

    const liveKeep = await app.request(
      `/capability-deletion-restoration?restore_surface=capability&restore_capability_id=${other.id}&restore_incarnation_id=${other.incarnation_id}`,
    );
    expect(liveKeep.headers.get("HX-Replace-Url")).toBe("/capability/boom");

    const replacementIncarnation = "99999999-9999-4999-8999-999999999999";
    conns.readwrite.run("UPDATE capability_registry SET incarnation_id = ? WHERE id = ?", [
      replacementIncarnation,
      other.id,
    ]);
    const staleKeep = await app.request(
      `/capability-deletion-restoration?restore_surface=capability&restore_capability_id=${other.id}&restore_incarnation_id=${other.incarnation_id}`,
    );
    expect(await staleKeep.text()).toBe("");
    expect(staleKeep.headers.get("HX-Replace-Url")).toBe("/");

    const fromNeutral = await (
      await app.request("/capability-deletion/notes?restore_surface=neutral")
    ).text();
    expect(fromNeutral).toContain(
      'hx-get="/capability-deletion-restoration?restore_surface=neutral"',
    );
    expect(fromNeutral).not.toContain('hx-push-url="');
    expect(fromNeutral).toContain('name="restore_surface" value="neutral"');
    expect(fromNeutral).not.toContain('name="restore_capability_id"');

    const cancelled = await app.request("/capability-deletion-restoration?restore_surface=neutral");
    expect(await cancelled.text()).toBe("");
    expect(cancelled.headers.get("HX-Replace-Url")).toBe("/");
  });

  test("catches a dependency added after a clear preflight, then admits after it is removed", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    const admitted: string[] = [];
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      mutationCoordinator,
      capabilityRouter: { databases: conns },
      capabilityDestructionFaults: {
        afterManifestCollected: () => {
          expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
          admitted.push(target.id);
        },
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
    expect(await raced.text()).toContain("I can’t delete Notes while Reading list uses it");
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
    expect(clearHtml).toContain("I deleted Notes permanently");
    expect(clearHtml).toContain("data-capability-deletion-logo-removal");
    expect(admitted).toEqual([target.id]);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("immediately refuses a queued build without changing the queue", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    const reservation = mutationCoordinator.reserveBuild();
    const before = mutationCoordinator.snapshot();
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      mutationCoordinator,
      capabilityRouter: { databases: conns },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("I’m making another change right now");
    expect(response.headers.get("HX-Replace-Url")).toBe("/");
    expect(mutationCoordinator.snapshot()).toEqual(before);
    expect(mutationCoordinator.cancelBuild(reservation)).toBe(true);
  });

  test("refuses stale, missing, and duplicate incarnation evidence without continuation", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    let admitted = false;
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
      capabilityDestructionFaults: {
        afterManifestCollected: () => {
          admitted = true;
        },
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

    // A target that is already gone has no page left to stand on: both entry points
    // answer with the neutral home state, so a reload cannot land on a dead route.
    const missing = await app.request("/capability-deletion/missing/confirm", {
      method: "POST",
      body: new URLSearchParams({ incarnation_id: target.incarnation_id }),
    });
    expect(missing.status).toBe(200);
    expect(missing.headers.get("HX-Replace-Url")).toBe("/");
    const missingHtml = await missing.text();
    expect(missingHtml).toContain("That’s already gone, so I didn’t delete anything.");
    expect(missingHtml).not.toContain('class="capability-deletion"');

    const missingPreflight = await app.request("/capability-deletion/missing");
    expect(missingPreflight.status).toBe(200);
    expect(missingPreflight.headers.get("HX-Replace-Url")).toBe("/");
    expect(await missingPreflight.text()).toContain(
      'hx-swap-oob="delete:#capability-logo-missing"',
    );
  });

  test("commit removes an active capability immediately and cleanup failure cannot resurrect it", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
      capabilityDestructionFaults: {
        afterCommit: () => {
          throw new Error("process stopped before cleanup");
        },
      },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationWithRestoration(target.incarnation_id, target),
    );
    const html = await response.text();
    expect(html).not.toContain("data-capability-deletion-neutral");
    expect(html).toContain('hx-swap-oob="delete:#capability-logo-notes"');
    expect(html).toContain("I still have a little tidying up to do");
    expect(response.headers.get("HX-Replace-Url")).toBe("/");

    const shell = await (await app.request("/")).text();
    expect(shell).not.toContain("capability-logo-notes");
    expect((await app.request("/capability/notes")).status).toBe(404);
    expect(
      conns.readonly
        .query(
          "SELECT id, lifecycle_state FROM capability_registry WHERE lifecycle_state = 'deletion_tombstone'",
        )
        .all(),
    ).toEqual([{ id: "notes", lifecycle_state: "deletion_tombstone" }]);
  });

  test("the live route always runs the shared production version-artifact cleanup", async () => {
    const artifactsRoot = join(dir, "artifacts");
    const base = notesRow();
    const target = notesRow({
      artifacts_path: join(artifactsRoot, base.id, base.incarnation_id, "v1"),
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
    });
    install(conns, target);
    mkdirSync(target.artifacts_path, { recursive: true });
    writeFileSync(join(target.artifacts_path, "read.ts"), "old");
    const app = createApp({
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationWithRestoration(target.incarnation_id, target),
    );
    expect(response.status).toBe(200);
    expect(existsSync(join(artifactsRoot, target.id, target.incarnation_id))).toBe(false);
    expect(getCapabilityForTest(conns, target.id)).toBe(false);
  });

  test("deleting an inactive target restores the other active canonical View", async () => {
    const target = deletionTarget(dir);
    const other = boomRow();
    install(conns, target);
    install(conns, other);
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationWithRestoration(target.incarnation_id, other),
    );
    const html = await response.text();
    expect(html).toContain('data-active-capability-id="boom"');
    expect(html).not.toContain('data-active-capability-id="notes"');
    expect(response.headers.get("HX-Replace-Url")).toBe("/capability/boom");
    expect((await app.request("/capability/boom")).status).toBe(200);
  });

  test("a drain timeout speaks for itself and restores the exact canonical View", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const readGates = createReadGateCoordinator({ drainTimeoutMs: 1 });
    const identity = { capabilityId: target.id, incarnationId: target.incarnation_id };
    const tokens = readGates.tryAcquire({ catalog: [identity], incarnations: [identity] });
    expect(tokens).toBeDefined();
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      readGates,
      capabilityRouter: { databases: conns, readGates },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationWithRestoration(target.incarnation_id, target),
    );
    const html = await response.text();
    expect(html).toContain('data-active-capability-id="notes"');
    // Its own sentence, not the generic pre-commit failure: the user is told that active
    // work did not finish, which is the one refusal here that invites trying again.
    expect(html).toContain("Something in Notes was still finishing, so I didn’t delete it.");
    expect(html).not.toContain("I couldn’t delete Notes");
    expect(response.headers.get("HX-Replace-Url")).toBe("/capability/notes");
    expect(readGates.snapshot()[0]).toMatchObject({ state: "active", readerCount: 1 });
    if (!tokens) throw new Error("the held read token was not acquired");
    expect(readGates.release(tokens)).toBe(true);
    expect(conns.readonly.query("SELECT 1 FROM cap_notes").all()).toEqual([]);
  });

  test("a pre-commit manifest failure preserves an authoritative neutral surface", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
      capabilityDestructionFaults: {
        afterManifestCollected: () => {
          throw new Error("manifest unavailable");
        },
      },
    });

    const response = await app.request(
      "/capability-deletion/notes/confirm",
      confirmationRequest(target.incarnation_id),
    );
    const html = await response.text();
    expect(html).not.toContain("data-active-capability-id");
    expect(html).toContain("I couldn’t delete Notes");
    expect(response.headers.get("HX-Replace-Url")).toBe("/");
    expect(getCapabilityForTest(conns, target.id)).toBe(true);
  });
});

function getCapabilityForTest(conns: PlatformDatabase, capabilityId: string): boolean {
  return (
    conns.readonly
      .query("SELECT 1 FROM capability_registry WHERE id = ? AND lifecycle_state = 'active'")
      .get(capabilityId) !== null
  );
}
