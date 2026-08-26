import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createApp } from "../app/app.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { getCapabilityLogoState } from "../registry/index.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { LogoGenerationError, type LogoGenerationProvider } from "./provider.ts";

// A route test, so the provider is injected through `createApp`. Nothing here reaches the
// network — the whole point of the seam is that a paid call has to be handed in.

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const ATTEMPT_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo-attempt`;
const LOGO_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo.svg`;

// What the tile sends. htmx puts `HX-Request` on every request it makes, and the route
// requires it, so a cross-origin form cannot reach the paid operation.
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

function appWith(logoProvider: LogoGenerationProvider) {
  return createApp({
    artifactsRoot,
    logoProvider,
    capabilityRouter: { databases: conns },
    buildDatabases: conns,
  });
}

const drawing: LogoGenerationProvider = { generate: async () => ARTWORK };
const unavailable: LogoGenerationProvider = {
  generate: () => Promise.reject(new LogoGenerationError("http", "the service is down")),
};

function logoState() {
  return getCapabilityLogoState("notes", NOTES_INCARNATION_ID, conns.readonly);
}

describe("the attempt route", () => {
  test("claims, installs, and answers with the capability's real tile", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(html).toContain('id="capability-logo-notes"');
    expect(html).toContain(`background-image: url('${LOGO_PATH}')`);
    expect(html).not.toContain("logo-tile--pending");
  });

  // A paid mutation must never be reachable by anything a browser, a prefetcher or a
  // proxy may do on its own.
  test("is a POST, and a GET of the same address is not a route", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(ATTEMPT_PATH);

    expect(response.status).toBe(404);
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
  });

  // `HX-Request` is a custom header, so a cross-origin request carrying it needs a CORS
  // preflight this route never answers. Without the check, any page the user visits could
  // post a plain form here and burn a capability's three ~$0.08 attempts.
  test("a request that did not come from the tile reaches nothing", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(ATTEMPT_PATH, { method: "POST" });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
  });

  test("its response is never cached", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("the tile it answers with is inert, even when the row is still absent", async () => {
    install(conns, notesRow());

    const response = await appWith(unavailable).request(ATTEMPT_PATH, ATTEMPT);
    const html = await response.text();

    // The row went back to `absent` for a later sweep…
    expect(logoState()).toEqual({ status: "absent", attempts: 1 });
    // …but the markup that came back carries no load trigger, so one page load cannot
    // recursively spend all three attempts.
    expect(html).toContain('id="capability-logo-notes"');
    expect(html).toContain("logo-tile--pending");
    expect(html).not.toContain("logo-attempt");
    expect(html).not.toContain('hx-trigger="load"');
  });

  test("replaces only the tile — nothing else comes back with it", async () => {
    install(conns, notesRow());

    const html = await (await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT)).text();

    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("hx-swap-oob");
    expect(html).not.toContain("capability-collection");
    expect(html).not.toContain("<html");
  });

  test("an attempt bound to another incarnation claims nothing", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(
      "/capability/notes/99999999-9999-4999-8999-999999999999/logo-attempt",
      ATTEMPT,
    );

    expect(await response.text()).toBe("");
    expect(logoState()).toEqual({ status: "absent", attempts: 0 });
  });

  test("an unknown capability answers with an empty tile rather than an error", async () => {
    const response = await appWith(drawing).request(
      `/capability/ghost/${NOTES_INCARNATION_ID}/logo-attempt`,
      ATTEMPT,
    );

    expect(response.status).toBe(200);
    // Swapped as outerHTML, an empty body takes the button off the desk — which is the
    // right answer for a capability that is no longer there.
    expect(await response.text()).toBe("");
  });
});

describe("the logo route", () => {
  test("serves the stored bytes of a present incarnation, declared as a picture", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(LOGO_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await response.arrayBuffer()).equals(ARTWORK)).toBe(true);
  });

  test("a capability with no artwork yet answers 404 and is never cached", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(LOGO_PATH);

    expect(response.status).toBe(404);
    // A request made before the artwork arrives must not cache its absence forever.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a present row whose file has gone missing serves nothing", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    // The row still says `present`; the bytes are gone. Reconciling that row to
    // `abandoned` is the recovery sweep's job (5.5/04) — the route's job is to not
    // pretend, and to not let a browser cache the gap.
    rmSync(join(artifactsRoot, "notes", NOTES_INCARNATION_ID, "logo.svg"));

    const response = await appWith(drawing).request(LOGO_PATH);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("another incarnation's address does not serve this one's bytes", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(
      "/capability/notes/99999999-9999-4999-8999-999999999999/logo.svg",
    );

    // Deleting a capability and growing it again is the only route to a different logo,
    // so an incarnation-keyed address must never answer for a different lifetime.
    expect(response.status).toBe(404);
  });
});

describe("the desk", () => {
  test("an absent tile arms exactly one incarnation-bound attempt", async () => {
    install(conns, notesRow());

    const html = await (await appWith(drawing).request("/")).text();

    expect(html).toContain(`hx-post="${ATTEMPT_PATH}"`);
    expect(html.match(/hx-post="[^"]*logo-attempt"/g) ?? []).toHaveLength(1);
    expect(html).toContain('hx-trigger="load"');
    expect(html).toContain('hx-target="#capability-logo-notes"');
  });

  test("once artwork lands, the tile is the artwork and arms nothing", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const html = await (await appWith(drawing).request("/")).text();

    expect(html).toContain(`background-image: url('${LOGO_PATH}')`);
    expect(html).not.toMatch(/hx-post="[^"]*logo-attempt"/);
  });
});
