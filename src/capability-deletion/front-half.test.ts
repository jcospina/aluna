import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import type { CapabilityRow } from "../registry/index.ts";
import { getCapability, listCapabilityDependents } from "../registry/index.ts";
import {
  boomRow,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { admitCapabilityDeletion } from "./front-half.ts";

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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one scratch registry lifecycle keeps every admission race on the same real boundary.
describe("capability-deletion front half", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("refuses exact live reverse dependencies while ownership is held", async () => {
    const target = notesRow();
    const dependent = dependentOnNotes();
    install(conns, target);
    install(conns, dependent);
    const mutationCoordinator = createMutationCoordinator();
    let continued = false;

    const outcome = await admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: target.incarnation_id },
      {
        database: conns.readwrite,
        mutationCoordinator,
        onAdmitted: () => {
          continued = true;
        },
      },
    );

    expect(outcome).toMatchObject({ status: "blocked", target, dependents: [dependent] });
    expect(continued).toBe(false);
    expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  });

  test("returns multiple dependents in deterministic registry-id order", async () => {
    const target = notesRow();
    const later = dependentOnNotes("z_reader", "Weekly digest");
    const earlier = dependentOnNotes("a_reader", "Reading list");
    install(conns, target);
    install(conns, later);
    install(conns, earlier);

    const outcome = await admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: target.incarnation_id },
      { database: conns.readwrite, mutationCoordinator: createMutationCoordinator() },
    );

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") throw new Error("expected reverse-dependency refusal");
    expect(outcome.dependents.map((row) => row.id)).toEqual(["a_reader", "z_reader"]);
  });

  test("passes lease-held validation after the dependency is removed", async () => {
    const target = notesRow();
    const dependent = dependentOnNotes();
    install(conns, target);
    install(conns, dependent);
    conns.readwrite.run("UPDATE capability_registry SET read_dependencies = ? WHERE id = ?", [
      JSON.stringify({ create: [], read: [], update: [], delete: [], search: [] }),
      dependent.id,
    ]);
    const mutationCoordinator = createMutationCoordinator();
    const continued: string[] = [];

    const outcome = await admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: target.incarnation_id },
      {
        database: conns.readwrite,
        mutationCoordinator,
        onAdmitted: (row) => {
          expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
          continued.push(row.id);
        },
      },
    );

    expect(outcome).toEqual({ status: "admitted", target });
    expect(continued).toEqual([target.id]);
    expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  });

  test("performs both authoritative registry reads only after the deletion lease is held", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    const observed: string[] = [];

    const outcome = await admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: target.incarnation_id },
      {
        database: conns.readwrite,
        mutationCoordinator,
        getTarget: (capabilityId, database) => {
          expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
          observed.push("target");
          return getCapability(capabilityId, database);
        },
        listDependents: (row, database) => {
          expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
          observed.push("dependents");
          return listCapabilityDependents(row, database);
        },
      },
    );

    expect(outcome.status).toBe("admitted");
    expect(observed).toEqual(["target", "dependents"]);
  });

  test("refuses a stale incarnation before reverse-dependency work", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    let continued = false;

    const outcome = await admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: "99999999-9999-4999-8999-999999999999" },
      {
        database: conns.readwrite,
        mutationCoordinator,
        onAdmitted: () => {
          continued = true;
        },
      },
    );

    expect(outcome).toEqual({ status: "stale" });
    expect(continued).toBe(false);
  });

  test("is immediately busy behind both an active owner and a queued build, without queuing", async () => {
    const target = notesRow();
    install(conns, target);
    const coordinatorWithOwner = createMutationCoordinator();
    const owner = coordinatorWithOwner.tryAcquireRecordWrite();
    expect(owner).toBeDefined();

    expect(
      await admitCapabilityDeletion(
        { capabilityId: target.id, incarnationId: target.incarnation_id },
        { database: conns.readwrite, mutationCoordinator: coordinatorWithOwner },
      ),
    ).toEqual({ status: "busy" });
    expect(coordinatorWithOwner.snapshot()).toMatchObject({
      queuedTickets: [],
      activeLease: { kind: "record" },
    });
    expect(owner && coordinatorWithOwner.release(owner)).toBe(true);

    const coordinatorWithQueue = createMutationCoordinator();
    const reservation = coordinatorWithQueue.reserveBuild();
    const before = coordinatorWithQueue.snapshot();
    expect(
      await admitCapabilityDeletion(
        { capabilityId: target.id, incarnationId: target.incarnation_id },
        { database: conns.readwrite, mutationCoordinator: coordinatorWithQueue },
      ),
    ).toEqual({ status: "busy" });
    expect(coordinatorWithQueue.snapshot()).toEqual(before);
    expect(coordinatorWithQueue.cancelBuild(reservation)).toBe(true);
  });

  test("releases the exact deletion lease when the admitted continuation fails", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();

    await expect(
      admitCapabilityDeletion(
        { capabilityId: target.id, incarnationId: target.incarnation_id },
        {
          database: conns.readwrite,
          mutationCoordinator,
          onAdmitted: () => {
            throw new Error("destruction seam failed");
          },
        },
      ),
    ).rejects.toThrow("destruction seam failed");
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("holds deletion ownership across an asynchronous admitted continuation", async () => {
    const target = notesRow();
    install(conns, target);
    const mutationCoordinator = createMutationCoordinator();
    let releaseContinuation!: () => void;
    const continuation = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    const admission = admitCapabilityDeletion(
      { capabilityId: target.id, incarnationId: target.incarnation_id },
      {
        database: conns.readwrite,
        mutationCoordinator,
        onAdmitted: () => continuation,
      },
    );
    await Promise.resolve();

    expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("deletion");
    expect(mutationCoordinator.tryAcquireDeletion()).toBeUndefined();
    const reservation = mutationCoordinator.reserveBuild();
    expect(mutationCoordinator.snapshot()).toMatchObject({
      activeLease: { kind: "deletion" },
      queuedTickets: [{ kind: "build" }],
    });

    releaseContinuation();
    expect(await admission).toEqual({ status: "admitted", target });
    expect(mutationCoordinator.snapshot()).toMatchObject({
      activeLease: null,
      queuedTickets: [{ kind: "build" }],
    });
    expect(mutationCoordinator.cancelBuild(reservation)).toBe(true);
  });
});
