import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { getCapability } from "../../../../registry/index.ts";
import {
  type CapabilityIncarnation,
  createReadGateCoordinator,
  type ReadGateCoordinator,
  type ReadTokenSet,
} from "../../../../runtime/concurrency/read-gates.ts";
import {
  boomRow,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../../../runtime/router/dispatch/router.test-support.ts";
import { expectDestroyed } from "../fault-battery.test-support.ts";
import { destroyCapability } from "../two-phase-destruction.ts";
import {
  type AdmittedEventContext,
  deriveEventOwnership,
  ingestCapabilityEvents,
  installFakeEventLogStore,
  listFakeEventLogRows,
} from "./event-log.test-support.ts";

const SPOOFED_PAIR: CapabilityIncarnation = {
  capabilityId: "billing",
  incarnationId: "77777777-7777-4777-8777-777777777777",
};

function incarnation(row: { id: string; incarnation_id: string }): CapabilityIncarnation {
  return { capabilityId: row.id, incarnationId: row.incarnation_id };
}

function liveContext(tokens: ReadTokenSet, route = "/capability/notes"): AdmittedEventContext {
  return { kind: "live", route, action: "read", tokens };
}

function acquire(
  readGates: ReadGateCoordinator,
  catalog: readonly CapabilityIncarnation[],
  incarnations: readonly CapabilityIncarnation[],
): ReadTokenSet {
  const tokens = readGates.tryAcquire({ catalog, incarnations });
  if (!tokens) throw new Error("the test could not acquire its read-token set");
  return tokens;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one scratch-database lifecycle keeps the provenance and late-batch evidence coherent.
describe("the Module 7 Event Log acceptance fake", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
    installFakeEventLogStore(conns.readwrite);
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("ownership is derived server-side; a claimed incarnation and payload never reach the store", () => {
    const notes = notesRow();
    const boom = boomRow();
    install(conns, notes);
    install(conns, boom);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes), incarnation(boom)];
    // The admitted read set is the target plus its declared read dependencies — here,
    // notes reading boom. That set, not anything the caller wrote, is the provenance.
    const tokens = acquire(readGates, catalog, catalog);
    const context = liveContext(tokens);

    expect(deriveEventOwnership(context)).toEqual([incarnation(boom), incarnation(notes)]);

    const result = ingestCapabilityEvents(
      context,
      [
        {
          id: "event-1",
          records: [{ text: "a real note" }],
          claimedIncarnations: [SPOOFED_PAIR],
          claimedPayload: "whatever the client wanted stored",
        },
      ],
      { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
    );

    expect(result).toEqual({
      status: "appended",
      events: 1,
      ownership: [incarnation(boom), incarnation(notes)],
    });
    const [stored] = listFakeEventLogRows(conns.readonly);
    expect(stored?.ownership).toEqual([incarnation(boom), incarnation(notes)]);
    expect(stored?.ownership).not.toContainEqual(SPOOFED_PAIR);
    expect(stored?.payload).toBe(
      JSON.stringify({
        route: "/capability/notes",
        action: "read",
        records: [{ text: "a real note" }],
      }),
    );
    expect(stored?.payload).not.toContain("whatever the client wanted stored");
    readGates.release(tokens);
  });

  test("a batch whose read ownership was already released is refused", () => {
    const notes = notesRow();
    install(conns, notes);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes)];
    const tokens = acquire(readGates, catalog, catalog);
    readGates.release(tokens);

    expect(
      ingestCapabilityEvents(liveContext(tokens), [{ id: "event-1", records: [] }], {
        database: conns.readwrite,
        registryReadonly: conns.readonly,
        readGates,
      }),
    ).toEqual({ status: "rejected", reason: "read_ownership_lost" });
    expect(listFakeEventLogRows(conns.readonly)).toEqual([]);
  });

  test("one closing pair rejects the whole batch, appending nothing", async () => {
    const notes = notesRow();
    const boom = boomRow();
    install(conns, notes);
    install(conns, boom);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes), incarnation(boom)];
    readGates.synchronizeCatalog(catalog);
    // Server-derived before the close, presented after it — the queued batch shape.
    const queued: AdmittedEventContext = {
      kind: "queued",
      route: "/capability/notes",
      action: "read",
      derivedAt: new Date().toISOString(),
      ownership: catalog,
    };
    const closing = await readGates.closeAndDrain(incarnation(boom));

    expect(
      ingestCapabilityEvents(
        queued,
        [
          { id: "event-1", records: [{ text: "first" }] },
          { id: "event-2", records: [{ text: "second" }] },
        ],
        { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
      ),
    ).toEqual({
      status: "rejected",
      reason: "incarnation_not_current",
      incarnation: incarnation(boom),
    });
    expect(listFakeEventLogRows(conns.readonly)).toEqual([]);

    // Reopened, every pair is current again and the same batch appends as a whole.
    expect(readGates.reopen(closing)).toBe(true);
    expect(
      ingestCapabilityEvents(
        queued,
        [
          { id: "event-1", records: [{ text: "first" }] },
          { id: "event-2", records: [{ text: "second" }] },
        ],
        { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
      ).status,
    ).toBe("appended");
    expect(listFakeEventLogRows(conns.readonly)).toHaveLength(2);
  });

  test("a late pre-deletion batch cannot resurrect purged payloads", async () => {
    const notes = notesRow();
    install(conns, notes);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes)];
    const tokens = acquire(readGates, catalog, catalog);
    const appended = ingestCapabilityEvents(
      liveContext(tokens),
      [{ id: "event-1", records: [{ text: "a secret note" }] }],
      { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
    );
    if (appended.status !== "appended") throw new Error("the batch should have appended");
    readGates.release(tokens);
    // The batch M7 would have queued just before deletion started.
    const queued: AdmittedEventContext = {
      kind: "queued",
      route: "/capability/notes",
      action: "read",
      derivedAt: new Date().toISOString(),
      ownership: appended.ownership,
    };

    const destroyed = await destroyCapability({
      target: notes,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters: [],
    });
    expect(destroyed.status).toBe("deleted");
    expect(expectDestroyed(destroyed).payloads).toEqual({
      redactedEvents: 1,
      releasedOwnership: 1,
    });

    const purged = listFakeEventLogRows(conns.readonly);
    expect(purged).toEqual([
      {
        id: "event-1",
        route: "/capability/notes",
        action: "read",
        payload: "",
        redacted: true,
        ownership: [],
      },
    ]);

    expect(
      ingestCapabilityEvents(queued, [{ id: "event-2", records: [{ text: "a secret note" }] }], {
        database: conns.readwrite,
        registryReadonly: conns.readonly,
        readGates,
      }),
    ).toEqual({
      status: "rejected",
      reason: "incarnation_not_current",
      incarnation: incarnation(notes),
    });
    expect(listFakeEventLogRows(conns.readonly)).toEqual(purged);
  });

  test("a mid-batch failure appends nothing, so a batch is never half-recorded", () => {
    const notes = notesRow();
    install(conns, notes);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes)];
    const tokens = acquire(readGates, catalog, catalog);

    // The second event reuses the first one's id, so its INSERT violates the primary key
    // after the first has already been written inside the transaction.
    expect(() =>
      ingestCapabilityEvents(
        liveContext(tokens),
        [
          { id: "event-1", records: [{ text: "first" }] },
          { id: "event-1", records: [{ text: "duplicate" }] },
        ],
        { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
      ),
    ).toThrow();
    expect(listFakeEventLogRows(conns.readonly)).toEqual([]);
    readGates.release(tokens);
  });

  test("purging one owner of a co-owned payload redacts the row and releases only that owner", async () => {
    const notes = notesRow();
    const boom = boomRow();
    install(conns, notes);
    install(conns, boom);
    const readGates = createReadGateCoordinator();
    const catalog = [incarnation(notes), incarnation(boom)];
    const tokens = acquire(readGates, catalog, catalog);
    ingestCapabilityEvents(
      liveContext(tokens),
      [{ id: "event-1", records: [{ text: "notes data rendered beside boom data" }] }],
      { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
    );
    readGates.release(tokens);

    const destroyed = await destroyCapability({
      target: notes,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates,
      adapters: [],
    });

    // The payload is one canonical blob, so a deleted owner's content cannot be excised
    // from it — the whole row is redacted even though `boom` still exists. The surviving
    // owner keeps its ownership row, now pointing at a content-free deletion fact.
    expect(expectDestroyed(destroyed).payloads).toEqual({
      redactedEvents: 1,
      releasedOwnership: 1,
    });
    expect(listFakeEventLogRows(conns.readonly)).toEqual([
      {
        id: "event-1",
        route: "/capability/notes",
        action: "read",
        payload: "",
        redacted: true,
        ownership: [incarnation(boom)],
      },
    ]);
    expect(getCapability(boom.id, conns.readonly)).toEqual(boom);
  });

  test("a rebuilt capability's new incarnation cannot claim the purged incarnation's events", () => {
    const notes = notesRow();
    install(conns, notes);
    const readGates = createReadGateCoordinator();
    const rebuilt = {
      capabilityId: notes.id,
      incarnationId: "99999999-9999-4999-8999-999999999999",
    };
    readGates.synchronizeCatalog([rebuilt]);

    expect(
      ingestCapabilityEvents(
        {
          kind: "queued",
          route: "/capability/notes",
          action: "read",
          derivedAt: new Date().toISOString(),
          ownership: [rebuilt],
        },
        [{ id: "event-1", records: [] }],
        { database: conns.readwrite, registryReadonly: conns.readonly, readGates },
      ),
    ).toEqual({
      status: "rejected",
      reason: "incarnation_not_current",
      incarnation: rebuilt,
    });
  });
});
