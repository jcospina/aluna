import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import { createReadGateCoordinator, type ReadGateCoordinator } from "../read-gates/index.ts";
import {
  claimLogoGeneration,
  getCapabilityLogoState,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  releaseLogoClaim,
  settleLogoGeneration,
} from "../registry/index.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { createRunningLogoClaims, type RunningLogoClaims } from "./claims.ts";
import { recoverCapabilityLogos } from "./recovery.ts";
import { capabilityLogoPath, installCapabilityLogo } from "./storage.ts";

// Recovery makes no provider call at all, so nothing here needs one injected: every case
// is a durable row and an artifact tree that disagree, and the reconciliation between
// them.

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const TARGET = { capabilityId: "notes", incarnationId: NOTES_INCARNATION_ID };

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;
let claims: RunningLogoClaims;
let readGates: ReadGateCoordinator;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  artifactsRoot = join(dir, "capabilities");
  mkdirSync(artifactsRoot, { recursive: true });
  claims = createRunningLogoClaims();
  readGates = createReadGateCoordinator();
  install(conns, notesRow());
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

function recover(overrides: Partial<Parameters<typeof recoverCapabilityLogos>[0]> = {}) {
  return recoverCapabilityLogos({
    databases: conns,
    mutationCoordinator: createMutationCoordinator(),
    readGates,
    artifactsRoot,
    claims,
    ...overrides,
  });
}

function logoState() {
  return getCapabilityLogoState("notes", NOTES_INCARNATION_ID, conns.readonly);
}

function storedLogo(): string {
  return capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID);
}

function stagingDirectory(): string {
  return join(artifactsRoot, "notes", NOTES_INCARNATION_ID, ".staging");
}

function stagingEntries(): string[] {
  return existsSync(stagingDirectory()) ? readdirSync(stagingDirectory()).sort() : [];
}

/** The row a process that died mid-attempt leaves: claimed, spent, and never settled. */
function claimedAndAbandonedByACrash(times = 1): void {
  for (let attempt = 1; attempt <= times; attempt += 1) {
    expect(claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite)).not.toBeNull();
    if (attempt < times) releaseLogoClaim("notes", NOTES_INCARNATION_ID, conns.readwrite);
  }
}

/** What a claim that crashed between writing its bytes and linking them leaves behind. */
function leaveStagingTemp(attempt: number): string {
  mkdirSync(stagingDirectory(), { recursive: true });
  const path = join(stagingDirectory(), `logo-attempt-${attempt}.svg`);
  writeFileSync(path, ARTWORK);
  return path;
}

function installArtwork(attempt = 1): void {
  installCapabilityLogo({
    artifactsRoot,
    capabilityId: "notes",
    incarnationId: NOTES_INCARNATION_ID,
    attempt,
    bytes: ARTWORK,
  });
}

describe("an interrupted claim", () => {
  // The claim did everything but say so: the file is installed and only the finalizing
  // coordinator write was lost. Nothing is redrawn — the drawing is already there.
  test("whose drawing did land is marked present, with its count untouched", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();

    const recovered = await recover();

    expect(recovered).toEqual([
      {
        capabilityId: "notes",
        incarnationId: NOTES_INCARNATION_ID,
        action: "accepted",
        removedTemps: 0,
      },
    ]);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
  });

  test("with no drawing and attempts to spare goes back to absent for the next load", async () => {
    claimedAndAbandonedByACrash();

    const recovered = await recover();

    expect(recovered[0]?.action).toBe("released");
    // Back where the sweep can offer it another attempt — and the attempt it already
    // spent stays spent. Nothing ever decrements one.
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
  });

  test("whose spend was the third abandons rather than returning to the sweep", async () => {
    claimedAndAbandonedByACrash(LOGO_MAX_CLAIMED_ATTEMPTS);

    const recovered = await recover();

    expect(recovered[0]?.action).toBe("abandoned");
    expect(logoState()).toEqual({ status: "abandoned", attempts: LOGO_MAX_CLAIMED_ATTEMPTS });
    // The permanent placeholder: a second pass finds nothing left to do.
    expect(await recover()).toEqual([]);
    expect(claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite)).toBeNull();
  });

  test("leaves no staging bytes behind, and the state moves only after they are gone", async () => {
    claimedAndAbandonedByACrash();
    const temp = leaveStagingTemp(1);
    expect(existsSync(temp)).toBe(true);

    const recovered = await recover();

    expect(recovered[0]).toMatchObject({ action: "released", removedTemps: 1 });
    expect(stagingEntries()).toEqual([]);
  });

  // The sweep is scoped by name as well as by directory: a build's staging generation
  // sitting beside the temp is another subsystem's, and reconciliation owns it.
  test("sweeps only logo attempt temps, never a build's staging directory", async () => {
    claimedAndAbandonedByACrash();
    leaveStagingTemp(1);
    const buildStaging = join(stagingDirectory(), "build-01J8");
    mkdirSync(buildStaging, { recursive: true });

    await recover();

    expect(stagingEntries()).toEqual(["build-01J8"]);
  });

  // The one thing recovery must never do. An accepted drawing is never remade (L7), so a
  // pass that removed one would take the capability's face away for good.
  test("never touches the accepted final file while it clears the temp", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();
    leaveStagingTemp(1);

    await recover();

    expect(stagingEntries()).toEqual([]);
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
    expect(logoState()?.status).toBe("present");
  });

  // Nothing this platform writes can produce a zero-byte logo, and the installer refuses
  // to overwrite — so leaving one would spend the remaining attempts on EEXIST and reach
  // the permanent placeholder holding a file with nothing in it.
  test("removes a final file holding no drawing rather than releasing the row over it", async () => {
    claimedAndAbandonedByACrash();
    mkdirSync(join(artifactsRoot, "notes", NOTES_INCARNATION_ID), { recursive: true });
    writeFileSync(storedLogo(), new Uint8Array());

    const recovered = await recover();

    expect(recovered[0]?.action).toBe("released");
    expect(existsSync(storedLogo())).toBe(false);
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
  });
});

describe("a claim that is still running", () => {
  test("is left entirely alone, temp and all", async () => {
    claimedAndAbandonedByACrash();
    const temp = leaveStagingTemp(1);
    const ticket = claims.begin(TARGET);
    ticket.claimed();

    try {
      expect(await recover()).toEqual([]);
    } finally {
      ticket.end();
    }

    // A live claim and a crashed one leave the same durable row; only the in-process
    // registry can tell them apart, and being wrong here means releasing a paid call's
    // row and deleting the bytes it is in the middle of writing.
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });
    expect(existsSync(temp)).toBe(true);
  });

  test("is reconciled by the next pass once it has finished", async () => {
    claimedAndAbandonedByACrash();
    const ticket = claims.begin(TARGET);
    ticket.claimed();
    expect(await recover()).toEqual([]);
    ticket.end();

    expect((await recover())[0]?.action).toBe("released");
  });
});

describe("a present row whose artwork has gone", () => {
  test("becomes the permanent placeholder and is never redrawn", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();
    await recover();
    expect(logoState()?.status).toBe("present");

    rmSync(storedLogo());
    const recovered = await recover();

    expect(recovered[0]?.action).toBe("lost");
    // L7's once-accepted rule still applies after loss: `abandoned`, not back to `absent`,
    // so no later load spends a call trying to draw a replacement.
    expect(logoState()).toEqual({ status: "abandoned", attempts: 1 });
    expect(claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite)).toBeNull();
    expect(existsSync(storedLogo())).toBe(false);
  });

  test("with its file intact is left exactly as it is", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();

    await recover();
    const recovered = await recover();

    expect(recovered).toEqual([]);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
  });
});

describe("rows recovery has nothing to say about", () => {
  test("an absent row and an abandoned one are both untouched", async () => {
    expect(await recover()).toEqual([]);
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });

    claimedAndAbandonedByACrash();
    settleLogoGeneration("notes", NOTES_INCARNATION_ID, "abandoned", conns.readwrite);

    expect(await recover()).toEqual([]);
    expect(logoState()).toEqual({ status: "abandoned", attempts: 1 });
  });

  test("a deletion already closing the gate takes the row with the tree", async () => {
    claimedAndAbandonedByACrash();
    // Deletion's own reader-draining state. Recovery holds the incarnation's read token
    // while it looks at the tree, so a gate it cannot acquire is a tree it must not judge.
    readGates.synchronizeCatalog([TARGET]);
    await readGates.closeAndDrain(TARGET);

    expect(await recover()).toEqual([]);
    expect(logoState()?.status).toBe("generating");
  });
});

// Everything recovery does, it decides from a snapshot taken before it asked for mutation
// ownership. What it does when that snapshot has gone stale, or when the tree cannot
// answer at all, is where a paid drawing gets thrown away.
describe("what recovery refuses to decide from", () => {
  test("a tree it could not read leaves a present row exactly as it is", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();
    await recover();
    expect(logoState()?.status).toBe("present");

    const incarnationRoot = join(artifactsRoot, "notes", NOTES_INCARNATION_ID);
    chmodSync(incarnationRoot, 0o000);
    try {
      const recovered = await recover();

      // The drawing is there, readable, paid for. A `catch` that read every errno as "the
      // file is gone" would reconcile it to the permanent placeholder, and L7 then forbids
      // ever drawing another.
      expect(recovered).toEqual([]);
      expect(logoState()).toEqual({ status: "present", attempts: 1 });
    } finally {
      chmodSync(incarnationRoot, 0o755);
    }

    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
  });

  // The catastrophic mistake this closes: an artifacts root pointing somewhere else makes
  // every accepted drawing look lost, and `abandoned` is terminal.
  test("an incarnation tree that is not there at all is not a lost drawing", async () => {
    claimedAndAbandonedByACrash();
    installArtwork();
    await recover();
    expect(logoState()?.status).toBe("present");

    const elsewhere = join(dir, "somewhere-else");
    mkdirSync(elsewhere, { recursive: true });
    const recovered = await recoverCapabilityLogos({
      databases: conns,
      mutationCoordinator: createMutationCoordinator(),
      readGates,
      artifactsRoot: elsewhere,
      claims,
    });

    expect(recovered).toEqual([]);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
  });

  test("something that is not a file at the logo path reconciles nothing", async () => {
    claimedAndAbandonedByACrash();
    mkdirSync(storedLogo(), { recursive: true });

    expect(await recover()).toEqual([]);
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });
  });

  test("a row claimed while it waited for the write lease is not released under it", async () => {
    claimedAndAbandonedByACrash();
    const mutationCoordinator = createMutationCoordinator();

    let releaseBuild = (): void => {};
    const buildHeld = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const build = mutationCoordinator.withBuildLease(
      mutationCoordinator.reserveBuild(),
      () => buildHeld,
    );

    // Recovery has decided from `generating`/1 and is now queued behind the build.
    const pass = recover({ mutationCoordinator, admissionMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Meanwhile the row is reconciled and re-claimed by something else, and that claim is
    // running: attempt 2 is drawing right now.
    releaseLogoClaim("notes", NOTES_INCARNATION_ID, conns.readwrite);
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    const ticket = claims.begin(TARGET);
    ticket.claimed();

    releaseBuild();
    await build;
    const recovered = await pass;
    ticket.end();

    // The stale decision would have satisfied the transition's own `generating` predicate
    // and released a paid call's row — leaving a third claim free to draw at the same time.
    expect(recovered).toEqual([]);
    expect(logoState()).toEqual({ status: "generating", attempts: 2 });
  });

  test("two passes over one row move it once and report it once", async () => {
    claimedAndAbandonedByACrash();
    const mutationCoordinator = createMutationCoordinator();

    const [first, second] = await Promise.all([
      recover({ mutationCoordinator }),
      recover({ mutationCoordinator }),
    ]);

    expect([...first, ...second]).toHaveLength(1);
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
  });
});
