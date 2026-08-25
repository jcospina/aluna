// The registry's logo state: the stored seed, the durable lifecycle, and the atomic
// claim that decides which of two desk loads is allowed to spend an attempt.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type PlatformDatabase } from "../persistence/db.ts";
import { runMigrations } from "../persistence/migrations.ts";
import { validSpec } from "./spec.test-support.ts";
import {
  claimLogoGeneration,
  compareAndSwapCapability,
  getCapability,
  getCapabilityLogoState,
  insertCapability,
  REGISTRY_TABLE,
  releaseLogoClaim,
  StaleCapabilityRegistryError,
  settleLogoGeneration,
} from "./store.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_INCARNATION_ID = "22222222-2222-4222-8222-222222222222";
const SEED = 184206;

function write(overrides: Record<string, unknown> = {}) {
  return {
    ...validSpec(),
    incarnation_id: INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/notes/${INCARNATION_ID}/v1/`,
    seed: SEED,
    ...overrides,
  };
}

describe("the registry's logo inputs and state", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-registry-logo-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a row is born carrying its authored inputs, its seed, and an absent logo", () => {
    const inserted = insertCapability(write(), conns.readwrite);
    expect(inserted.subject).toBe("an open notebook");
    expect(inserted.ground).toBe("leaf");
    expect(inserted.noun).toBe("note");
    expect(inserted.seed).toBe(SEED);
    expect(inserted.logo).toEqual({ status: "absent", attempts: 0 });

    const read = getCapability("notes", conns.readonly);
    expect(read).toEqual(inserted);
  });

  test("a claim moves absent → generating and spends the attempt in the same statement", () => {
    insertCapability(write(), conns.readwrite);

    const claim = claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    expect(claim).toEqual({
      capabilityId: "notes",
      incarnationId: INCARNATION_ID,
      subject: "an open notebook",
      ground: "leaf",
      seed: SEED,
      attempts: 1,
    });
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).toEqual({
      status: "generating",
      attempts: 1,
    });
  });

  test("only one of two concurrent claims wins, and only one attempt is spent", () => {
    // The whole point of the claim: two desk loads sweeping the same faceless
    // capability must not both order artwork at $0.08 a call.
    insertCapability(write(), conns.readwrite);

    const first = claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    const second = claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).toEqual({
      status: "generating",
      attempts: 1,
    });
  });

  test("the attempt is spent when the claim is won, not when a provider replies", () => {
    // A process that dies between the claim and the reply has still paid for what it
    // ordered, so the count cannot be reset by never hearing back.
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);

    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)?.attempts).toBe(1);
    expect(settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite)).toEqual({
      status: "present",
      attempts: 1,
    });
  });

  test("settling closes only a live claim; a late second settle changes nothing", () => {
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);

    expect(settleLogoGeneration("notes", INCARNATION_ID, "abandoned", conns.readwrite)).toEqual({
      status: "abandoned",
      attempts: 1,
    });
    expect(settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite)).toBeNull();
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)?.status).toBe(
      "abandoned",
    );
  });

  test("a settled logo cannot be re-claimed", () => {
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite);

    expect(claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite)).toBeNull();
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).toEqual({
      status: "present",
      attempts: 1,
    });
  });

  test("a claim is bound to one incarnation, so a recreated capability owes its own", () => {
    insertCapability(write(), conns.readwrite);
    expect(claimLogoGeneration("notes", OTHER_INCARNATION_ID, conns.readwrite)).toBeNull();
    expect(claimLogoGeneration("absent_capability", INCARNATION_ID, conns.readwrite)).toBeNull();
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).toEqual({
      status: "absent",
      attempts: 0,
    });
  });

  test("a stale CAS target changes nothing at all", () => {
    insertCapability(write(), conns.readwrite);

    expect(() =>
      compareAndSwapCapability(
        write({ version: 2 }),
        { state: "active", capabilityId: "notes", incarnationId: INCARNATION_ID, version: 9 },
        conns.readwrite,
      ),
    ).toThrow(StaleCapabilityRegistryError);
    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
  });

  test("a pre-logo row fails loudly on read rather than reading back with a default", () => {
    // What the migration deliberately leaves behind for any row that predates the cut:
    // no subject, no ground, no noun, no seed. `bun run reset` removes those rows; a
    // survivor must not be quietly repaired into a capability describing artwork
    // nobody drew.
    insertCapability(write(), conns.readwrite);
    conns.readwrite.run(
      `UPDATE ${REGISTRY_TABLE}
       SET subject = NULL, ground = NULL, noun = NULL, seed = NULL
       WHERE id = 'notes'`,
    );

    expect(() => getCapability("notes", conns.readonly)).toThrow();
  });

  test("the stored logo status is confined to the four the contract names", () => {
    insertCapability(write(), conns.readwrite);
    expect(() =>
      conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET logo_status = 'queued' WHERE id = 'notes'`),
    ).toThrow();
  });
});

describe("closing out a claim", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-registry-logo-close-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a released claim returns to absent, keeps its spend, and can be claimed again", () => {
    // The transition a failed-but-not-final attempt makes, and the one recovery makes
    // for a claim whose process died. Without it `generating` is a trap: only `absent`
    // is claimable, so the capability would stay faceless forever.
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);

    expect(releaseLogoClaim("notes", INCARNATION_ID, conns.readwrite)).toEqual({
      status: "absent",
      attempts: 1,
    });

    const second = claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    expect(second?.attempts).toBe(2);
  });

  test("releasing anything that is not a live claim changes nothing", () => {
    insertCapability(write(), conns.readwrite);
    expect(releaseLogoClaim("notes", INCARNATION_ID, conns.readwrite)).toBeNull();

    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite);
    expect(releaseLogoClaim("notes", INCARNATION_ID, conns.readwrite)).toBeNull();
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)?.status).toBe("present");
  });

  test("artwork that later goes missing is reconciled to abandoned, never redrawn", () => {
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite);

    expect(settleLogoGeneration("notes", INCARNATION_ID, "abandoned", conns.readwrite)).toEqual({
      status: "abandoned",
      attempts: 1,
    });
    // `present` is not a route back to a second drawing.
    expect(settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite)).toBeNull();
  });

  test("a claim whose inputs cannot make a request rolls back instead of stranding", () => {
    insertCapability(write(), conns.readwrite);
    conns.readwrite.run(`UPDATE ${REGISTRY_TABLE} SET ground = 'signal' WHERE id = 'notes'`);

    expect(() => claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite)).toThrow();
    // No attempt spent, and the row is still claimable once the ground is fixed.
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).toEqual({
      status: "absent",
      attempts: 0,
    });
  });

  test("logo state is read per incarnation, never per id alone", () => {
    insertCapability(write(), conns.readwrite);
    expect(getCapabilityLogoState("notes", INCARNATION_ID, conns.readonly)).not.toBeNull();
    expect(getCapabilityLogoState("notes", OTHER_INCARNATION_ID, conns.readonly)).toBeNull();
  });
});

describe("what an ordinary registry write may and may not move", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-registry-logo-write-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("evolution carries the seed and cannot touch a claim it raced", () => {
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);

    // A different seed on the way in: the stored one must win, or "carried forward"
    // would only mean "the caller happened to pass the same value back".
    const evolved = compareAndSwapCapability(
      write({ version: 2, label: "Daily notes", noun: "daily note", seed: SEED + 1 }),
      { state: "active", capabilityId: "notes", incarnationId: INCARNATION_ID, version: 1 },
      conns.readwrite,
    );

    expect(evolved.version).toBe(2);
    expect(evolved.noun).toBe("daily note");
    expect(evolved.seed).toBe(SEED);
    // The claim the sweep won is still standing, and its attempt is still spent.
    expect(evolved.logo).toEqual({ status: "generating", attempts: 1 });
  });

  test("a write that names a logo status has that key dropped, never applied", () => {
    insertCapability(write(), conns.readwrite);
    claimLogoGeneration("notes", INCARNATION_ID, conns.readwrite);
    settleLogoGeneration("notes", INCARNATION_ID, "present", conns.readwrite);

    const evolved = compareAndSwapCapability(
      { ...write({ version: 2 }), logo: { status: "absent", attempts: 0 } },
      { state: "active", capabilityId: "notes", incarnationId: INCARNATION_ID, version: 1 },
      conns.readwrite,
    );

    expect(evolved.logo).toEqual({ status: "present", attempts: 1 });
  });
});
