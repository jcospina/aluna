import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createMutationCoordinator,
  type MutationCoordinator,
  type MutationLease,
} from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import { createReadGateCoordinator } from "../read-gates/index.ts";
import {
  getCapabilityLogoState,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  settleLogoGeneration,
} from "../registry/index.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { type CapabilityLogoAttemptDeps, runCapabilityLogoAttempt } from "./attempt.ts";
import { createRunningLogoClaims } from "./claims.ts";
import {
  createRecraftLogoProvider,
  LogoGenerationError,
  type LogoGenerationProvider,
} from "./provider.ts";
import type { LogoGenerationRequest } from "./request.ts";
import { capabilityLogoPath } from "./storage.ts";

// Everything here runs against an injected provider. No case reaches the network, and
// the one that must prove a real request shape asserts on what the fake was handed.

const TARGET = { capabilityId: "notes", incarnationId: NOTES_INCARNATION_ID };
const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  artifactsRoot = join(dir, "capabilities");
  mkdirSync(artifactsRoot, { recursive: true });
  install(conns, notesRow());
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

interface RecordingProvider extends LogoGenerationProvider {
  readonly calls: LogoGenerationRequest[];
}

function providerReturning(bytes: Uint8Array): RecordingProvider {
  const calls: LogoGenerationRequest[] = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return bytes;
    },
  };
}

function providerFailing(reason: "http" | "timeout" = "http"): RecordingProvider {
  const calls: LogoGenerationRequest[] = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      throw new LogoGenerationError(reason, "the service is unavailable");
    },
  };
}

function deps(
  provider: LogoGenerationProvider,
  overrides: Partial<CapabilityLogoAttemptDeps> = {},
): CapabilityLogoAttemptDeps {
  return {
    databases: conns,
    mutationCoordinator: createMutationCoordinator(),
    readGates: createReadGateCoordinator(),
    artifactsRoot,
    provider,
    claims: createRunningLogoClaims(),
    ...overrides,
  };
}

/** Put the row back at the birth state, as a delete-and-rebuild would. */
function rebornWithNoLogo(): void {
  conns.readwrite
    .query("UPDATE capability_registry SET logo_status = 'absent', logo_attempts = 0 WHERE id = ?")
    .run("notes");
}

function logoState() {
  return getCapabilityLogoState("notes", NOTES_INCARNATION_ID, conns.readonly);
}

function stagingEntries(): string[] {
  const staging = join(artifactsRoot, "notes", NOTES_INCARNATION_ID, ".staging");
  return existsSync(staging) ? readdirSync(staging) : [];
}

describe("a successful attempt", () => {
  test("installs the bytes and marks the lifecycle present", async () => {
    const provider = providerReturning(ARTWORK);

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));

    expect(outcome).toBe("installed");
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(
      readFileSync(capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID)).equals(
        ARTWORK,
      ),
    ).toBe(true);
    expect(stagingEntries()).toEqual([]);
  });

  test("the request it makes is built from the row's own stored inputs", async () => {
    const provider = providerReturning(ARTWORK);

    await runCapabilityLogoAttempt(TARGET, deps(provider));

    expect(provider.calls).toHaveLength(1);
    const request = provider.calls[0];
    expect(request?.prompt).toContain("an open notebook");
    // notesRow authors `leaf`, whose closed companion is `shade`, and stores seed 184206.
    expect(request?.random_seed).toBe(184206);
    expect(request?.controls.colors[0]).toEqual(request?.controls.background_color);
  });

  test("one accepted artwork per incarnation — a second attempt is never claimable", async () => {
    const provider = providerReturning(ARTWORK);
    await runCapabilityLogoAttempt(TARGET, deps(provider));

    const second = await runCapabilityLogoAttempt(TARGET, deps(provider));

    expect(second).toBe("unclaimed");
    expect(provider.calls).toHaveLength(1);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
  });
});

describe("a failed attempt", () => {
  test("spends the claim, returns to absent, and leaves the capability usable", async () => {
    const provider = providerFailing();

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));

    expect(outcome).toBe("failed");
    // Finished, usable, placeholdered — the build is not touched by any of this.
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    expect(existsSync(capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID))).toBe(
      false,
    );
  });

  test("never strands the row in generating, whatever went wrong", async () => {
    const throwers: LogoGenerationProvider[] = [
      { generate: () => Promise.reject(new LogoGenerationError("timeout", "budget")) },
      { generate: () => Promise.reject(new LogoGenerationError("envelope", "garbage")) },
      { generate: () => Promise.reject(new LogoGenerationError("not_svg", "a png")) },
      { generate: () => Promise.reject(new Error("something nobody typed")) },
    ];

    for (const provider of throwers) {
      // A fresh lifetime per failure kind: the cap is enforced by the claim itself now, so
      // four failures in one row would stop being four attempts after the third.
      rebornWithNoLogo();
      const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));
      expect(outcome).toBe("failed");
      expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    }
  });

  test("removes its temporary bytes even when the install itself fails", async () => {
    // A final file already sitting there is the one thing install refuses, so this drives
    // the failure through the installer rather than the provider.
    const incarnationRoot = join(artifactsRoot, "notes", NOTES_INCARNATION_ID);
    mkdirSync(incarnationRoot, { recursive: true });
    const prior = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>');
    writeFileSync(join(incarnationRoot, "logo.svg"), prior);

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(providerReturning(ARTWORK)));

    expect(outcome).toBe("failed");
    expect(stagingEntries()).toEqual([]);
    // The prior final file survives untouched.
    expect(
      readFileSync(capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID)).equals(prior),
    ).toBe(true);
  });

  test("the third claimed failure abandons; there is never a fourth call", async () => {
    const provider = providerFailing();

    expect(await runCapabilityLogoAttempt(TARGET, deps(provider))).toBe("failed");
    expect(await runCapabilityLogoAttempt(TARGET, deps(provider))).toBe("failed");
    expect(await runCapabilityLogoAttempt(TARGET, deps(provider))).toBe("abandoned");

    expect(logoState()).toEqual({ status: "abandoned", attempts: LOGO_MAX_CLAIMED_ATTEMPTS });
    // `abandoned` is not claimable, so the fourth request spends nothing.
    expect(await runCapabilityLogoAttempt(TARGET, deps(provider))).toBe("unclaimed");
    expect(provider.calls).toHaveLength(LOGO_MAX_CLAIMED_ATTEMPTS);
  });
});

describe("an attempt that could never have succeeded", () => {
  test("an unconfigured service spends nothing, however many times the desk loads", async () => {
    // The harm this closes: `requireRecraftApiKey` throws inside `generate`, which the
    // attempt swallows as an ordinary failure. Without the preflight, three page loads on
    // a machine with no key permanently abandoned every capability's logo — and nothing
    // ever decrements an attempt.
    const unconfigured: LogoGenerationProvider = {
      isConfigured: () => false,
      generate: () => Promise.reject(new LogoGenerationError("unconfigured", "no key")),
    };

    for (let load = 0; load < 4; load += 1) {
      expect(await runCapabilityLogoAttempt(TARGET, deps(unconfigured))).toBe("unclaimed");
    }

    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
  });

  test("the real client reports itself unconfigured when the key is missing", () => {
    expect(createRecraftLogoProvider({ env: {} }).isConfigured?.()).toBe(false);
    expect(createRecraftLogoProvider({ env: { RECRAFT_API_KEY: "  " } }).isConfigured?.()).toBe(
      false,
    );
    expect(createRecraftLogoProvider({ env: { RECRAFT_API_KEY: "k" } }).isConfigured?.()).toBe(
      true,
    );
  });
});

describe("the coordinator and the read gate", () => {
  test("the claim waits in ordinary FIFO order behind a held build lease", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const provider = providerReturning(ARTWORK);

    let releaseBuild: (() => void) | undefined;
    const buildHeld = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const build = mutationCoordinator.withBuildLease(
      mutationCoordinator.reserveBuild(),
      () => buildHeld,
    );

    const attempt = runCapabilityLogoAttempt(TARGET, deps(provider, { mutationCoordinator }));
    // Give the attempt every chance to jump the queue.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Nothing has been claimed and nothing has been ordered while the build holds the lease.
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
    expect(provider.calls).toHaveLength(0);

    releaseBuild?.();
    await build;
    expect(await attempt).toBe("installed");
  });

  test("provider work observes the incarnation's cancellation signal", async () => {
    const readGates = createReadGateCoordinator();
    // Recorded in the closure and asserted after the run: an `expect` inside the injected
    // provider would be swallowed by the attempt's own catch and could never fail.
    let observed: AbortSignal | undefined;
    let abortedDuringCall: boolean | undefined;
    const provider: LogoGenerationProvider = {
      async generate(_request, signal) {
        observed = signal;
        // Deletion closing the gate is what aborts a call already in flight.
        const closing = readGates.closeAndDrain(TARGET, { timeoutMs: 50 });
        await new Promise((resolve) => setTimeout(resolve, 1));
        abortedDuringCall = signal.aborted;
        void closing.catch(() => undefined);
        throw new LogoGenerationError("cancelled", "gate closed");
      },
    };

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider, { readGates }));

    expect(observed).toBeDefined();
    expect(abortedDuringCall).toBe(true);
    expect(outcome).toBe("failed");
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
  });

  test("a closed gate refuses the attempt without spending one", async () => {
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([TARGET]);
    const closing = readGates.closeAndDrain(TARGET, { timeoutMs: 200 });
    const provider = providerReturning(ARTWORK);

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider, { readGates }));

    expect(outcome).toBe("unclaimed");
    expect(provider.calls).toHaveLength(0);
    // Nothing is decremented, ever — so an attempt that could not reach the provider must
    // never have been claimed. Three of these would otherwise reach the permanent
    // placeholder for a capability nobody deleted.
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
    expect(existsSync(capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID))).toBe(
      false,
    );
    readGates.reopen(await closing);
  });

  test("finalization does not run inside the read-token scope", async () => {
    // The hazard the coordinator's own doc comment names: awaiting a queued acquisition
    // while holding read tokens deadlocks against deletion, which takes its lease and
    // *then* closes the gate. So the observation that matters is not "a token was held
    // during the call" but "no token was still held when mutation ownership was asked
    // for again".
    const readGates = createReadGateCoordinator();
    const mutationCoordinator = createMutationCoordinator();
    const readersAtEachWrite: number[] = [];
    const observing = {
      ...mutationCoordinator,
      withPlatformWrite: <T>(body: (lease: MutationLease) => T | Promise<T>) => {
        readersAtEachWrite.push(
          readGates.snapshot().reduce((total, gate) => total + gate.readerCount, 0),
        );
        return mutationCoordinator.withPlatformWrite(body);
      },
    } as MutationCoordinator;

    let readersDuringCall = -1;
    const provider: LogoGenerationProvider = {
      async generate() {
        readersDuringCall = readGates
          .snapshot()
          .reduce((total, gate) => total + gate.readerCount, 0);
        return ARTWORK;
      },
    };

    const outcome = await runCapabilityLogoAttempt(
      TARGET,
      deps(provider, { readGates, mutationCoordinator: observing }),
    );

    expect(outcome).toBe("installed");
    // The claim, then the finalization — and neither of the two coordinator writes was
    // made while a read token was outstanding.
    expect(readersAtEachWrite).toEqual([0, 0]);
    // The paid half, in between, is the part that holds one.
    expect(readersDuringCall).toBe(1);
    expect(readGates.snapshot().every((gate) => gate.readerCount === 0)).toBe(true);
  });
});

describe("bytes that were never acknowledged", () => {
  test("a discard removes only the file this attempt installed", async () => {
    // The safety here is the inode, not the path. "Only this attempt could have written
    // here" is an invariant of today's single-claim lifecycle, and the retry sweep is
    // exactly the code that could add a second writer — while removing *accepted*
    // artwork is unrecoverable, because the route refuses a missing file and L7 forbids
    // redrawing.
    const other = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>');
    const provider: LogoGenerationProvider = {
      async generate() {
        // Something else settles the row and puts its own artwork at the same path while
        // this attempt is still drawing.
        settleLogoGeneration("notes", NOTES_INCARNATION_ID, "abandoned", conns.readwrite);
        return ARTWORK;
      },
    };
    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));
    expect(outcome).toBe("superseded");

    // This attempt's bytes were discarded; a different file at the same path would not be.
    const path = capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID);
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, other);
    expect(readFileSync(path).equals(other)).toBe(true);
  });
});

describe("a superseded or deleted target", () => {
  test("a failure whose row vanished mid-call releases nothing and says so", async () => {
    const provider: LogoGenerationProvider = {
      generate() {
        // The capability was deleted while the service was drawing.
        conns.readwrite.query("DELETE FROM capability_registry WHERE id = ?").run("notes");
        return Promise.reject(new LogoGenerationError("http", "the service is down"));
      },
    };

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));

    // Not "failed": there is no row left to have returned to `absent`.
    expect(outcome).toBe("superseded");
    expect(logoState()).toBeNull();
  });

  test("an attempt for the wrong incarnation claims nothing", async () => {
    const provider = providerReturning(ARTWORK);

    const outcome = await runCapabilityLogoAttempt(
      { capabilityId: "notes", incarnationId: "99999999-9999-4999-8999-999999999999" },
      deps(provider),
    );

    expect(outcome).toBe("unclaimed");
    expect(provider.calls).toHaveLength(0);
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
  });

  test("a late success cannot mark a row some other state already settled", async () => {
    const provider: LogoGenerationProvider = {
      async generate() {
        // While the drawing was being made, the row was reconciled to `abandoned`.
        settleLogoGeneration("notes", NOTES_INCARNATION_ID, "abandoned", conns.readwrite);
        return ARTWORK;
      },
    };

    const outcome = await runCapabilityLogoAttempt(TARGET, deps(provider));

    // Reported as superseded, not as `installed`: the registry recorded no transition.
    expect(outcome).toBe("superseded");
    expect(logoState()).toEqual({ status: "abandoned", attempts: 1 });
    // And the bytes go with it. No lifecycle ever said `present`, so nothing would ever
    // serve them — and left there they would make every later attempt fail on EEXIST.
    expect(existsSync(capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID))).toBe(
      false,
    );
    expect(stagingEntries()).toEqual([]);
  });
});
