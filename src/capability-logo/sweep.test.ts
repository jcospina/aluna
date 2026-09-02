import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createApp } from "../app/app.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import {
  claimLogoGeneration,
  getCapabilityLogoState,
  releaseLogoClaim,
} from "../registry/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../runtime/concurrency/mutation-coordinator.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../runtime/router/dispatch/router.test-support.ts";
import { LogoGenerationError, type LogoGenerationProvider } from "./provider.ts";
import { capabilityLogoPath, installCapabilityLogo } from "./storage.ts";

// The sweep, exercised through the two real routes and the desk that names them, because
// the ordering they hold is the whole mechanism: a fresh render arms one attempt per
// `absent` tile, and only `absent` arms. Every provider here is injected — a sweep that
// reached the network would spend real credits per test run.

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

/** A second capability, so a desk with more than one faceless tile can be exercised. */
const RECIPES_INCARNATION_ID = "33333333-3333-4333-8333-333333333333";

const ATTEMPT_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo-attempt`;
const LOGO_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo.svg`;

const GZIP: RequestInit = { headers: { "accept-encoding": "gzip, deflate, br" } };

// What the tile sends. The paid route requires it, so nothing cross-origin can reach it.
const ATTEMPT: RequestInit = { method: "POST", headers: { "HX-Request": "true" } };

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  artifactsRoot = join(dir, "capabilities");
  mkdirSync(artifactsRoot, { recursive: true });
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

function appWith(
  logoProvider: LogoGenerationProvider,
  overrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  return createApp({
    artifactsRoot,
    logoProvider,
    capabilityRouter: { databases: conns },
    buildDatabases: conns,
    ...overrides,
  });
}

const drawing: LogoGenerationProvider = { generate: async () => ARTWORK };

function logoState() {
  return getCapabilityLogoState("notes", NOTES_INCARNATION_ID, conns.readonly);
}

function storedLogo(): string {
  return capabilityLogoPath(artifactsRoot, "notes", NOTES_INCARNATION_ID);
}

/**
 * Wait for a condition the request currently in flight is about to satisfy. The deadline
 * is wall-clock rather than a tick count, so a loaded machine that schedules the timer
 * late is given the same ten seconds a quiet one is.
 */
async function until(satisfied: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!satisfied() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(satisfied()).toBe(true);
}

interface GatedProvider extends LogoGenerationProvider {
  calls: number;
  finish(): void;
}

/** A drawing that lands only when the test says so, so two loads can genuinely race. */
function gatedDrawing(): GatedProvider {
  let finish = (): void => {};
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const provider: GatedProvider = {
    calls: 0,
    finish: () => {
      finish();
    },
    async generate() {
      provider.calls += 1;
      await held;
      return ARTWORK;
    },
  };
  return provider;
}

function countingFailure(): LogoGenerationProvider & { calls: number } {
  const provider = {
    calls: 0,
    generate: () => {
      provider.calls += 1;
      return Promise.reject(new LogoGenerationError("http", "the service is down"));
    },
  };
  return provider;
}

describe("what one desk load may spend", () => {
  test("two loads racing one faceless tile make one call, and both get the drawing", async () => {
    install(conns, notesRow());
    const provider = gatedDrawing();
    const app = appWith(provider);

    const winner = app.request(ATTEMPT_PATH, ATTEMPT);
    await until(() => logoState()?.status === "generating");
    const loser = app.request(ATTEMPT_PATH, ATTEMPT);
    provider.finish();
    const [first, second] = await Promise.all([winner, loser]);

    // The claim is atomic, so exactly one ~$0.08 call goes out for the two loads…
    expect(provider.calls).toBe(1);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    // …and the loser answers with what the winner produced rather than a stale placeholder,
    // having waited only on the winner's own completion.
    expect(await first.text()).toContain(`background-image: url('${LOGO_PATH}')`);
    expect(await second.text()).toContain(`background-image: url('${LOGO_PATH}')`);
  });

  test("a loser whose observation runs out answers with the tile as it stands", async () => {
    install(conns, notesRow());
    const provider = gatedDrawing();
    const app = appWith(provider, { logoClaimObservationMs: 5 });

    const winner = app.request(ATTEMPT_PATH, ATTEMPT);
    await until(() => logoState()?.status === "generating");
    const loser = await app.request(ATTEMPT_PATH, ATTEMPT);
    const html = await loser.text();

    // Bounded means bounded: it gives up and reports the row it can see, having spent
    // nothing and armed nothing. The next desk load is what fills this tile.
    expect(provider.calls).toBe(1);
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });
    expect(html).toContain("logo-tile--pending");
    expect(html).not.toContain("logo-attempt");

    provider.finish();
    await winner;
  });

  test("however many loads race it, one incarnation never costs more than three calls", async () => {
    install(conns, notesRow());
    const provider = countingFailure();
    const app = appWith(provider);

    // Four desk loads, each with eight tiles racing the same capability. Within a load the
    // atomic claim is what holds it to one call; across loads it is the third failure
    // settling the row to `abandoned`. Nothing here counts anything.
    for (let load = 0; load < 4; load += 1) {
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          await (await app.request(ATTEMPT_PATH, ATTEMPT)).text();
        }),
      );
    }

    expect(provider.calls).toBe(3);
    expect(logoState()).toEqual({ status: "abandoned", attempts: 3 });
  });

  test("after the third failure the desk stops asking and the placeholder is permanent", async () => {
    install(conns, notesRow());
    const provider = countingFailure();
    const app = appWith(provider);

    for (let load = 0; load < 3; load += 1) {
      const desk = await (await app.request("/")).text();
      expect(desk).toContain(`hx-post="${ATTEMPT_PATH}"`);
      await app.request(ATTEMPT_PATH, ATTEMPT);
    }

    const fourth = await (await app.request("/")).text();

    expect(provider.calls).toBe(3);
    expect(logoState()).toEqual({ status: "abandoned", attempts: 3 });
    // No trigger on the tile, and the POST it would have sent claims nothing anyway.
    expect(fourth).not.toMatch(/hx-post="[^"]*logo-attempt"/);
    expect(fourth).toContain("logo-tile--pending");
    await app.request(ATTEMPT_PATH, ATTEMPT);
    expect(provider.calls).toBe(3);
  });
});

// The recovery half, seen from the outside: a row a crash left in `generating` renders a
// resting placeholder, and only `absent` arms — so unless the load reconciles it first,
// that capability is never offered another attempt at all.
describe("what a desk load reconciles before it draws", () => {
  test("a claim a crash interrupted is offered another attempt by the very next load", async () => {
    install(conns, notesRow());
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });
    const app = appWith(drawing);

    const desk = await (await app.request("/")).text();

    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    expect(desk).toContain(`hx-post="${ATTEMPT_PATH}"`);

    expect((await app.request(ATTEMPT_PATH, ATTEMPT)).status).toBe(200);
    expect(logoState()).toEqual({ status: "present", attempts: 2 });
  });

  test("an interrupted claim whose drawing did land needs no attempt at all", async () => {
    install(conns, notesRow());
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    installCapabilityLogo({
      artifactsRoot,
      capabilityId: "notes",
      incarnationId: NOTES_INCARNATION_ID,
      attempt: 1,
      bytes: ARTWORK,
    });
    const provider = countingFailure();

    const desk = await (await appWith(provider).request("/")).text();

    expect(provider.calls).toBe(0);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(desk).toContain(`background-image: url('${LOGO_PATH}')`);
  });

  test("artwork that has gone leaves a permanent placeholder, never an immutable 404", async () => {
    install(conns, notesRow());
    const provider = countingFailure();
    const app = appWith(provider);
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    expect(logoState()?.status).toBe("present");
    rmSync(storedLogo());

    const desk = await (await app.request("/")).text();

    // L7's once-accepted rule still applies after loss: reconciled, not redrawn.
    expect(provider.calls).toBe(0);
    expect(logoState()).toEqual({ status: "abandoned", attempts: 1 });
    expect(desk).toContain("logo-tile--pending");
    expect(desk).not.toContain("logo.svg");
    expect(desk).not.toMatch(/hx-post="[^"]*logo-attempt"/);

    // And the address the desk no longer names still fails closed if anything asks.
    const response = await app.request(LOGO_PATH, GZIP);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("the desk renders and a capability opens while a sweep is still drawing", async () => {
    install(conns, notesRow());
    const provider = gatedDrawing();
    const app = appWith(provider);

    const sweeping = app.request(ATTEMPT_PATH, ATTEMPT);
    await until(() => logoState()?.status === "generating");

    const desk = await app.request("/");
    const opened = await app.request("/capability/notes");

    expect(desk.status).toBe(200);
    expect(await desk.text()).toContain("logo-tile--pending");
    expect(opened.status).toBe(200);
    // The row is still mid-attempt, untouched by either read.
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });

    provider.finish();
    await sweeping;
  });
});

// Recovery runs before a desk is drawn, which puts it in the render path — so what it
// does when it cannot get what it needs matters as much as what it does when it can.
describe("what recovery refuses to hold up", () => {
  test("a desk still renders while a build holds the platform's write lease", async () => {
    install(conns, notesRow());
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    const mutationCoordinator = createMutationCoordinator();
    const app = appWith(drawing, { mutationCoordinator });

    let releaseBuild = (): void => {};
    const buildHeld = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const build = mutationCoordinator.withBuildLease(
      mutationCoordinator.reserveBuild(),
      () => buildHeld,
    );

    const started = Date.now();
    const desk = await app.request("/");
    const waited = Date.now() - started;

    // A platform write queues behind a build reservation, and a build holds its lease for
    // as long as a build takes. Recovery gives up on its bounded admission instead, so the
    // desk is drawn from the row as it stands and the next load reconciles it.
    expect(desk.status).toBe(200);
    expect(waited).toBeLessThan(5_000);
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });

    releaseBuild();
    await build;

    // Nothing was lost: the load after the build finishes does the reconciliation.
    await app.request("/");
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
  });

  test("one capability that cannot be reconciled does not strand the rest", async () => {
    install(conns, notesRow());
    install(conns, notesRow({ id: "recipes", incarnation_id: RECIPES_INCARNATION_ID }));
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    claimLogoGeneration("recipes", RECIPES_INCARNATION_ID, conns.readwrite);

    // The first row's write throws where nothing ordinarily can — a structural failure,
    // not the busy platform the admission budget covers.
    const mutationCoordinator = createMutationCoordinator();
    let first = true;
    const failing = {
      ...mutationCoordinator,
      withPlatformWrite: (...args: Parameters<MutationCoordinator["withPlatformWrite"]>) => {
        if (first) {
          first = false;
          return Promise.reject(new Error("the coordinator fell over"));
        }
        return mutationCoordinator.withPlatformWrite(...args);
      },
    } as unknown as MutationCoordinator;

    const desk = await appWith(drawing, { mutationCoordinator: failing }).request("/");

    expect(desk.status).toBe(200);
    expect(logoState()).toEqual({ status: "generating", attempts: 1 });
    expect(getCapabilityLogoState("recipes", RECIPES_INCARNATION_ID, conns.readonly)).toEqual({
      status: "absent",
      attempts: 1,
    });
  });
});

describe("more than one faceless capability", () => {
  test("every absent tile on the desk arms its own incarnation-bound attempt", async () => {
    install(conns, notesRow());
    install(conns, notesRow({ id: "recipes", incarnation_id: RECIPES_INCARNATION_ID }));
    const provider = countingFailure();
    const app = appWith(provider);

    const desk = await (await app.request("/")).text();

    expect(desk).toContain(`hx-post="${ATTEMPT_PATH}"`);
    expect(desk).toContain(`hx-post="/capability/recipes/${RECIPES_INCARNATION_ID}/logo-attempt"`);
    expect(desk.match(/hx-post="[^"]*logo-attempt"/g) ?? []).toHaveLength(2);

    // One load, one attempt each — the claims are independent because they are bound to
    // different incarnations.
    await Promise.all([
      app.request(ATTEMPT_PATH, ATTEMPT),
      app.request(`/capability/recipes/${RECIPES_INCARNATION_ID}/logo-attempt`, ATTEMPT),
    ]);

    expect(provider.calls).toBe(2);
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    expect(getCapabilityLogoState("recipes", RECIPES_INCARNATION_ID, conns.readonly)).toEqual({
      status: "absent",
      attempts: 1,
    });
  });

  test("a capability opened by URL reconciles the whole desk it draws", async () => {
    install(conns, notesRow());
    install(conns, notesRow({ id: "recipes", incarnation_id: RECIPES_INCARNATION_ID }));
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    const app = appWith(drawing);

    // Direct navigation, not an htmx logo click: it rehydrates the whole logo layer and
    // arms every absent tile, so it is a desk load and owes the same reconciliation.
    const page = await app.request("/capability/recipes");

    expect(page.status).toBe(200);
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    expect(await page.text()).toContain(`hx-post="${ATTEMPT_PATH}"`);
  });
});

describe("a tile with nothing left to ask for", () => {
  test("an absent row at the cap rests rather than arming a POST it cannot win", async () => {
    install(conns, notesRow());
    // `absent` with every attempt spent: claimable by shape, refused by count. Arming on
    // the status alone would animate this tile on every load for a picture that is not
    // coming, and send a paid-route POST each time to be told so.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
      releaseLogoClaim("notes", NOTES_INCARNATION_ID, conns.readwrite);
    }
    const provider = countingFailure();
    const app = appWith(provider);

    const desk = await (await app.request("/")).text();

    expect(desk).toContain("logo-tile--pending");
    expect(desk).not.toMatch(/hx-post="[^"]*logo-attempt"/);
    // And the address itself still refuses, so the tile is not the only thing holding it.
    await app.request(ATTEMPT_PATH, ATTEMPT);
    expect(provider.calls).toBe(0);
    expect(logoState()).toEqual({ status: "absent", attempts: 3 });
  });
});
