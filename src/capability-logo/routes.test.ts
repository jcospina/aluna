import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createApp } from "../app/app.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createReadGateCoordinator, type ReadGateCoordinator } from "../read-gates/index.ts";
import {
  abandonMissingCapabilityLogo,
  claimLogoGeneration,
  getCapabilityLogoState,
} from "../registry/index.ts";
import {
  install,
  NOTES_INCARNATION_ID,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { LogoGenerationError, type LogoGenerationProvider } from "./provider.ts";
import { installCapabilityLogo } from "./storage.ts";

// A route test, so the provider is injected through `createApp`. Nothing here reaches the
// network — the whole point of the seam is that a paid call has to be handed in.

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

// A real drawing, with its C2PA manifest and its 220 paths — the only thing that can
// prove the compressed response gives provenance back byte for byte.
const SPECIMEN = readFileSync(resolve(import.meta.dir, "../../design/assets/logos/recipes.svg"));

const ATTEMPT_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo-attempt`;
const LOGO_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo.svg`;

const GZIP: RequestInit = { headers: { "accept-encoding": "gzip, deflate, br" } };

/** What the ADR's immutable delivery has to say, exactly. */
const IMMUTABLE = "public, max-age=31536000, immutable";

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

function appWith(
  logoProvider: LogoGenerationProvider,
  readGates?: ReadGateCoordinator,
  overrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  return createApp({
    artifactsRoot,
    logoProvider,
    readGates,
    capabilityRouter: { databases: conns },
    buildDatabases: conns,
    ...overrides,
  });
}

const drawing: LogoGenerationProvider = { generate: async () => ARTWORK };
const drawingSpecimen: LogoGenerationProvider = { generate: async () => SPECIMEN };
const unavailable: LogoGenerationProvider = {
  generate: () => Promise.reject(new LogoGenerationError("http", "the service is down")),
};

function logoState() {
  return getCapabilityLogoState("notes", NOTES_INCARNATION_ID, conns.readonly);
}

/** The one path an incarnation's accepted artwork is ever served from. */
function storedLogo(): string {
  return join(artifactsRoot, "notes", NOTES_INCARNATION_ID, "logo.svg");
}

describe("the attempt route", () => {
  test("claims, installs, and answers with the capability's real tile", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    expect(html).toContain('id="capability-logo-face-notes"');
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
    expect(html).toContain('id="capability-logo-face-notes"');
    expect(html).toContain("logo-tile--pending");
    expect(html).not.toContain("logo-attempt");
    expect(html).not.toContain('hx-trigger="load"');
  });

  test("replaces only the face — nothing else comes back with it", async () => {
    install(conns, notesRow());

    const html = await (await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT)).text();

    // The button and nothing around it. This is the one swap on the desk nobody asked
    // for, and the menu and the rename editor beside the button are the user's own
    // state: a picture arriving must never take away a name being typed (5.9/01).
    expect(html.match(/data-capability-logo\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("data-logo-slot");
    expect(html).not.toContain("data-logo-menu");
    expect(html).not.toContain("data-logo-rename");
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
    expect(Buffer.from(await response.arrayBuffer()).equals(ARTWORK)).toBe(true);
  });

  // Opening the address as a document has to render a picture and run nothing. The stored
  // bytes are never touched (L8), so the whole of that guarantee is these three headers:
  // no scripting of any kind, no guessing at another type, and no download prompt.
  test("is inert when its address is opened directly as a document", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(LOGO_PATH);

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
  });

  test("marks a present incarnation's artwork immutable", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(LOGO_PATH);

    // Safe only because of L7 and the incarnation in the path: these exact bytes are
    // never remade, and the one thing that changes a capability's picture mints a new
    // address that shares no cache entry with this one.
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
  });

  test("compresses the response, and it decompresses to exactly what is stored", async () => {
    install(conns, notesRow());
    await appWith(drawingSpecimen).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawingSpecimen).request(LOGO_PATH, GZIP);
    const wire = Buffer.from(await response.arrayBuffer());

    expect(response.headers.get("content-encoding")).toBe("gzip");
    // The body depends on a request header and is cached for a year, so a shared cache
    // has to be told not to hand the compressed variant to a client that never asked.
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(wire.length).toBeLessThan(SPECIMEN.length / 2);

    // Stated rather than inferred, so a HEAD answers with the fields a GET would.
    expect(response.headers.get("content-length")).toBe(String(wire.length));

    const decompressed = Buffer.from(Bun.gunzipSync(wire));
    // Byte-identical to the file at the incarnation root, manifest and all: provenance is
    // kept rather than stripped, and compression changes nothing on disk.
    expect(decompressed.equals(SPECIMEN)).toBe(true);
    expect(decompressed.equals(readFileSync(storedLogo()))).toBe(true);
    expect(decompressed.includes("c2pa")).toBe(true);
  });

  test("a client that cannot decode gzip is sent the stored bytes as they are", async () => {
    install(conns, notesRow());
    await appWith(drawingSpecimen).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawingSpecimen).request(LOGO_PATH, {
      headers: { "accept-encoding": "identity" },
    });

    // Compression is an optimization; the response has to be correct for a client that
    // never asked for it.
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    // This is the variant a shared cache would otherwise store under a bare URL key for a
    // year and then hand to a client that never asked for it.
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("content-length")).toBe(String(SPECIMEN.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(SPECIMEN)).toBe(true);
  });
  // Content negotiation, exhaustively: the header decides, and every reading that is not
  // an unambiguous "yes" sends the stored bytes, which every client can read.
  test.each([
    ["gzip, deflate, br", true],
    ["GZIP", true],
    ["  gzip  ", true],
    ["deflate, gzip;q=0.5", true],
    ["*", true],
    ["identity;q=1, *;q=0.5", true],
    ["", false],
    ["identity", false],
    ["deflate, br", false],
    ["gzip;q=0", false],
    ["gzip;q=0.000", false],
    ["*;q=0", false],
    ["x-gzip", false],
    ["gzip;q=abc", false],
    ["gzip;q=", false],
    // The wildcard does not overrule a client that named gzip to refuse it, whichever
    // order the two arrive in (RFC 9110 §12.5.3).
    ["gzip;q=0, *", false],
    ["*, gzip;q=0", false],
  ] as const)("`accept-encoding: %s` is compressed: %s", async (header, compressed) => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(LOGO_PATH, {
      headers: { "accept-encoding": header },
    });
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.headers.get("content-encoding")).toBe(compressed ? "gzip" : null);
    expect(Buffer.from(compressed ? Bun.gunzipSync(body) : body).equals(ARTWORK)).toBe(true);
  });
});

// Every one of these has to fail closed: `no-store`, never the immutable policy, because
// a cached absence would outlive the artwork a later attempt is expected to deliver.
describe("the logo route, when there is nothing to serve", () => {
  test("a capability with no artwork yet answers 404 and is never cached", async () => {
    install(conns, notesRow());

    const response = await appWith(drawing).request(LOGO_PATH, GZIP);

    expect(response.status).toBe(404);
    // A request made before the artwork arrives must not cache its absence forever, so
    // it never receives the immutable policy — one early 404 would outlive the drawing.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  // The registry state is the gate, and only bytes-on-disk can prove it: a route that
  // consulted the file alone would pass every other "nothing to serve" case here, because
  // in all of those there is no file either. These two put a readable drawing at the
  // served path and still require a 404.
  //
  // Both are reached through the registry's own writers. `insertCapability` never writes
  // the logo lifecycle, so a row handed a status in its fixture stays `absent` and proves
  // nothing at all.
  test("a generating incarnation is refused even though its bytes are on disk", async () => {
    install(conns, notesRow());
    // Exactly what a claim whose process died between install and finalize leaves behind:
    // the file installed, the row still `generating`. Recovering it is desk-load
    // recovery's; refusing to serve it in the meantime is this route's.
    claimLogoGeneration("notes", NOTES_INCARNATION_ID, conns.readwrite);
    installCapabilityLogo({
      artifactsRoot,
      capabilityId: "notes",
      incarnationId: NOTES_INCARNATION_ID,
      attempt: 1,
      bytes: ARTWORK,
    });
    expect(logoState()?.status).toBe("generating");
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);

    const response = await appWith(drawing).request(LOGO_PATH, GZIP);

    // ADR-0007: no lifecycle ever said `present` over these bytes, so they are not served.
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
  });

  test("an abandoned incarnation is refused even though its bytes are on disk", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    expect(logoState()).toEqual({ status: "present", attempts: 1 });
    // The `present → abandoned` reconciliation ADR-0007 allows. The row is the record; a
    // file that outlives it is not a licence to keep drawing the desk from it.
    abandonMissingCapabilityLogo("notes", NOTES_INCARNATION_ID, conns.readwrite);
    expect(logoState()?.status).toBe("abandoned");
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);

    const response = await appWith(drawing).request(LOGO_PATH, GZIP);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readFileSync(storedLogo()).equals(ARTWORK)).toBe(true);
  });

  // A drawing truncated out of band is the same gap as a missing one, and a truthy empty
  // `Uint8Array` is exactly what would sail past a bare null check into a year-long cache.
  test("a present row whose file has been truncated to nothing serves nothing", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    writeFileSync(storedLogo(), "");

    const response = await appWith(drawing).request(LOGO_PATH, GZIP);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a present row whose file has gone missing serves nothing", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    // The row still says `present`; the bytes are gone. Reconciling that row to
    // `abandoned` is desk-load recovery's job — the route's job is to not
    // pretend, and to not let a browser cache the gap.
    rmSync(storedLogo());

    const response = await appWith(drawing).request(LOGO_PATH, GZIP);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("another incarnation's address does not serve this one's bytes", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);

    const response = await appWith(drawing).request(
      `/capability/notes/99999999-9999-4999-8999-999999999999/logo.svg`,
      GZIP,
    );

    // Deleting a capability and growing it again is the only route to a different logo,
    // so an incarnation-keyed address must never answer for a different lifetime.
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("holds the exact incarnation's read token while it serves", async () => {
    install(conns, notesRow());
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([{ capabilityId: "notes", incarnationId: NOTES_INCARNATION_ID }]);
    // A gate deletion has already closed refuses new tokens. If the route served without
    // asking for one, this would still hand out a picture deletion is draining against.
    await readGates.closeAndDrain({ capabilityId: "notes", incarnationId: NOTES_INCARNATION_ID });

    const response = await appWith(drawing, readGates).request(LOGO_PATH, GZIP);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("releases the token it took, on every path it can leave by", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const app = appWith(drawing, readGates);
    await app.request(ATTEMPT_PATH, ATTEMPT);

    await app.request(LOGO_PATH, GZIP);
    await app.request(LOGO_PATH);
    rmSync(storedLogo());
    // The missing-file exit is inside the token's scope, so it is the one that leaks if
    // the release is not in a `finally`.
    await app.request(LOGO_PATH, GZIP);

    expect(readGates.snapshot()).toEqual([
      {
        capabilityId: "notes",
        incarnationId: NOTES_INCARNATION_ID,
        state: "active",
        readerCount: 0,
      },
    ]);
    // Would hang to the drain deadline and throw if any of the three leaked a reader.
    await readGates.closeAndDrain(
      { capabilityId: "notes", incarnationId: NOTES_INCARNATION_ID },
      { timeoutMs: 50 },
    );
  });
});

// The immutable directive is only as good as the page that names the address. A stale desk
// would go on asking for a deleted lifetime's picture, and the browser would answer it out
// of the year-long entry that address was granted, without the server hearing about it.
describe("what surrounds the immutable response", () => {
  test("the desk that names the artwork address is never itself stored", async () => {
    install(conns, notesRow());

    const desk = await appWith(drawing).request("/");

    expect(desk.status).toBe(200);
    expect(desk.headers.get("cache-control")).toBe("no-store");
  });

  // A bare 404 is heuristically cacheable (RFC 9111 §4.2.2), so an address that is not a
  // route at all must not be remembered as missing either.
  test("an address that is no route at all is still not cacheable", async () => {
    const response = await appWith(drawing).request("/capability/notes/not-a-route/at-all");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

// Deletion is the only thing that ever takes a logo off the desk, and the incarnation in
// the address is what makes the year-long cache directive survive it.
describe("the logo route, across a delete and a rebuild", () => {
  /** A row whose artifacts sit under the scratch root, so real deletion can bind to it. */
  function deskRow(incarnationId: string) {
    return notesRow({
      incarnation_id: incarnationId,
      artifacts_path: join(artifactsRoot, "notes", incarnationId, "v1"),
    });
  }

  function logoPath(incarnationId: string): string {
    return `/capability/notes/${incarnationId}/logo.svg`;
  }

  async function deleteNotes(app: ReturnType<typeof appWith>, incarnationId: string) {
    return app.request("/capability-deletion/notes/confirm", {
      method: "POST",
      body: new URLSearchParams({ incarnation_id: incarnationId }),
    });
  }

  test("deleting the capability takes the artwork with it and the address stops serving", async () => {
    install(conns, deskRow(NOTES_INCARNATION_ID));
    const app = appWith(drawing);
    await app.request(ATTEMPT_PATH, ATTEMPT);
    const stored = join(artifactsRoot, "notes", NOTES_INCARNATION_ID, "logo.svg");
    expect(existsSync(stored)).toBe(true);

    expect((await deleteNotes(app, NOTES_INCARNATION_ID)).status).toBe(200);

    // The artwork has no cleanup path of its own: it lives at the incarnation root, and
    // deletion already owns that whole tree.
    expect(existsSync(stored)).toBe(false);
    const response = await appWith(drawing).request(LOGO_PATH, GZIP);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a rebuilt semantic id gets a different address the old cache entry cannot answer", async () => {
    const REBUILT = "33333333-3333-4333-8333-333333333333";
    install(conns, deskRow(NOTES_INCARNATION_ID));
    await appWith(drawing).request(ATTEMPT_PATH, ATTEMPT);
    await deleteNotes(appWith(drawing), NOTES_INCARNATION_ID);

    install(conns, deskRow(REBUILT));
    await appWith(drawingSpecimen).request(`/capability/notes/${REBUILT}/logo-attempt`, ATTEMPT);

    // A different address entirely, so a browser holding the deleted lifetime's bytes for
    // a year has nothing to hand back — the whole reason the incarnation is in the path.
    expect(logoPath(REBUILT)).not.toBe(LOGO_PATH);
    const rebuilt = await appWith(drawingSpecimen).request(logoPath(REBUILT), GZIP);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(Buffer.from(Bun.gunzipSync(await rebuilt.arrayBuffer())).equals(SPECIMEN)).toBe(true);

    // And the dead address never falls through to the new drawing.
    const dead = await appWith(drawingSpecimen).request(LOGO_PATH, GZIP);
    expect(dead.status).toBe(404);
    expect(dead.headers.get("cache-control")).toBe("no-store");

    // The desk asks for the new one and never mentions the old.
    const desk = await (await appWith(drawingSpecimen).request("/")).text();
    expect(desk).toContain(`background-image: url('${logoPath(REBUILT)}')`);
    expect(desk).not.toContain(NOTES_INCARNATION_ID);
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
