// The two addresses a logo tile talks to — platform code adjacent to, never inside, the fixed
// `/capability/:id/:action` convention. Four segments, so no Action can collide (ADR-0007).
//
// `POST …/logo-attempt` is a paid mutation, which is why it is a POST and why its response is
// `no-store`: an attempt encoded as a GET is one a browser, a prefetcher or a proxy is entitled
// to make on its own. It answers with the one tile it acted on, re-rendered and deliberately
// inert, so a swap cannot recursively spend the remaining attempts.
//
// `GET …/logo.svg` serves the accepted bytes as they arrived, immutable, at an address binding the
// semantic id and the incarnation: L7 never remakes those bytes, and a deleted id may be rebuilt
// with different artwork. Every other state, a mismatched incarnation and a missing file fail
// closed with `no-store`, so an early 404 cannot outlive artwork that arrives later (L8).

import type { Context, Hono } from "hono";
import { errorDetail } from "../../platform/errors.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
} from "../../runtime/concurrency/read-gates.ts";
import { renderCapabilityLogoFace } from "../../server/http/index.ts";
import {
  type CapabilityLogoAttemptOutcome,
  readActiveIncarnationCatalog,
  readAttemptTarget,
  runCapabilityLogoAttempt,
} from "./generation/attempt.ts";
import type { RunningLogoClaims } from "./generation/claims.ts";
import {
  createRecraftLogoProvider,
  DEFAULT_LOGO_GENERATION_TIMEOUT_MS,
  type LogoGenerationProvider,
} from "./generation/provider.ts";
import { readCapabilityLogo } from "./storage/storage.ts";

export interface CapabilityLogoRouteDeps {
  readonly registryDatabases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly artifactsRoot: string;
  /** Injected in every test. Defaults to the real, paid service. */
  readonly logoProvider?: LogoGenerationProvider;
  /** The attempts running in this process, shared with desk-load recovery. */
  readonly logoClaims: RunningLogoClaims;
  /** Test seam for {@link LOGO_CLAIM_OBSERVATION_MS}, the default bound. */
  readonly logoClaimObservationMs?: number;
}

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * How long a claim loser watches the winner: ADR-0007 gives a loser a bounded observation, not a
 * poll, and the winner's own wall-clock bound plus install time is the longest it can run.
 */
const LOGO_CLAIM_OBSERVATION_MS = DEFAULT_LOGO_GENERATION_TIMEOUT_MS + 5_000;

/**
 * A year is the longest age HTTP defines, and `immutable` stops even a reload revalidating. Safe
 * only because of L7 and the incarnation: a rebuild mints a new address sharing no cache entry.
 */
const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" } as const;

/**
 * The stored bytes go out untouched (L8), so the response makes the address inert when it is opened
 * as a document: `sandbox` removes scripting, and `nosniff` stops a browser guessing the type.
 */
const PICTURE_ONLY_HEADERS = {
  "content-type": "image/svg+xml",
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

/**
 * The body depends on this request header and is cached for a year: a shared cache that stored the
 * compressed variant without being told would hand it to the next client, decodable or not.
 */
const VARY_ON_ENCODING = { vary: "accept-encoding" } as const;

/**
 * Whether this client said it can decode gzip. Parsed, not substring-matched: `gzip;q=0` is the
 * explicit refusal and reads as acceptance to anything looking for four letters. `*` counts.
 */
function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  let wildcard: number | undefined;
  for (const entry of header.split(",")) {
    const [rawName, ...parameters] = entry.split(";");
    const name = rawName?.trim().toLowerCase();
    if (name !== "gzip" && name !== "*") continue;
    const declared = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));
    // An unparseable weight is NaN and every comparison below is therefore false, which
    // sends the stored bytes — the safe answer to a header nobody can read.
    const quality = declared ? Number.parseFloat(declared.slice(2)) : 1;
    // Naming gzip settles it however the entries are ordered (RFC 9110 §12.5.3): a
    // client that names it only to refuse it is not talked round by a later wildcard.
    if (name === "gzip") return quality > 0;
    wildcard = quality;
  }
  return wildcard !== undefined && wildcard > 0;
}

/**
 * One drawing's bytes, compressed per request rather than kept: `immutable` means a client asks
 * once per incarnation, so a resident copy of every logo would grow to save work nobody repeats.
 */
function servePicture(c: Context, stored: Uint8Array<ArrayBuffer>): Response {
  const compress = acceptsGzip(c.req.header("accept-encoding"));
  const body = compress ? Bun.gzipSync(stored) : stored;
  return c.body(body, 200, {
    ...PICTURE_ONLY_HEADERS,
    ...IMMUTABLE,
    ...VARY_ON_ENCODING,
    // Stated rather than inferred: a HEAD has no body for the framework to measure, and
    // RFC 9110 §9.3.2 requires it to answer with the same fields a GET would.
    "content-length": String(body.byteLength),
    ...(compress ? { "content-encoding": "gzip" } : {}),
  });
}

/**
 * Claim and spend an attempt, or watch a load already drawing this tile for a bounded moment.
 * Every other `unclaimed` reason (`present`, `abandoned`, deleted, no key) returns at once.
 */
async function spendOrObserve(
  target: CapabilityIncarnation,
  deps: CapabilityLogoRouteDeps,
  provider: LogoGenerationProvider,
  abandoned: AbortSignal,
): Promise<void> {
  let outcome: CapabilityLogoAttemptOutcome | null = null;
  try {
    outcome = await runCapabilityLogoAttempt(target, {
      databases: deps.registryDatabases,
      mutationCoordinator: deps.mutationCoordinator,
      readGates: deps.readGates,
      artifactsRoot: deps.artifactsRoot,
      provider,
      claims: deps.logoClaims,
    });
  } catch (error) {
    // The attempt swallows every ordinary failure, so reaching here means something structural.
    // The desk still gets a tile: a logo is never worth a broken desk.
    console.error(
      `omni-crud logo attempt for ${target.capabilityId}/${target.incarnationId} raised:`,
      errorDetail(error),
    );
    return;
  }
  if (outcome !== "unclaimed") return;
  await deps.logoClaims.awaitWinner(
    target,
    deps.logoClaimObservationMs ?? LOGO_CLAIM_OBSERVATION_MS,
    abandoned,
  );
}

export function registerCapabilityLogoRoutes(app: Hono, deps: CapabilityLogoRouteDeps): void {
  // Constructed lazily: a missing key must not stop the server from booting, exactly as
  // the text spine's key does not. It surfaces as a failed attempt instead.
  let provider: LogoGenerationProvider | undefined = deps.logoProvider;
  const resolveProvider = (): LogoGenerationProvider => {
    provider ??= createRecraftLogoProvider();
    return provider;
  };

  app.post("/capability/:id/:incarnation_id/logo-attempt", async (c) => {
    const target = {
      capabilityId: c.req.param("id"),
      incarnationId: c.req.param("incarnation_id"),
    };

    // Same-origin, enforced: `HX-Request` is a custom header, so a cross-origin request carrying it
    // needs a CORS preflight this route never answers — no visited page can burn three attempts.
    if (c.req.header("HX-Request") !== "true") {
      return c.body(null, 404, NO_STORE);
    }

    await spendOrObserve(target, deps, resolveProvider(), c.req.raw.signal);

    // Re-read rather than infer from the outcome: the tile states what the registry now
    // holds, which is also the right answer when this request lost the claim to another.
    const row = readAttemptTarget(target, deps.registryDatabases);
    // The face, not the slot: this swap is the only one nobody asked for, and the menu and rename
    // editor beside it are the user's own state (5.9/01). An empty body takes a deleted tile away.
    return c.html(
      row ? renderCapabilityLogoFace(row, { armLogoAttempt: false }) : "",
      200,
      NO_STORE,
    );
  });

  app.get("/capability/:id/:incarnation_id/logo.svg", (c) => {
    const capabilityId = c.req.param("id");
    const incarnationId = c.req.param("incarnation_id");
    // Both halves of the address must name the same active row: an address minted for a lifetime
    // since rebuilt must answer nothing, or its year-long cache entry holds the wrong face.
    const row = readAttemptTarget({ capabilityId, incarnationId }, deps.registryDatabases);
    if (row?.logo.status !== "present") {
      // Never cached: a request made before the artwork arrives must not cache its
      // absence forever, and `absent` is a state a later attempt is expected to leave.
      return c.body(null, 404, NO_STORE);
    }

    // The read token is held for the serve, so deletion cannot race the file out from
    // under an in-flight response.
    const tokens = deps.readGates.tryAcquire({
      catalog: readActiveIncarnationCatalog(deps.registryDatabases.readonly),
      incarnations: [{ capabilityId, incarnationId }],
    });
    if (!tokens) return c.body(null, 404, NO_STORE);

    try {
      const stored = readCapabilityLogo(deps.artifactsRoot, capabilityId, incarnationId);
      // `present` with no readable file is for `recovery.ts` to reconcile; an empty one is the same
      // gap: a truthy empty `Uint8Array` would sail past and be cached as a blank tile for a year.
      if (!stored || stored.byteLength === 0) return c.body(null, 404, NO_STORE);
      return servePicture(c, stored);
    } finally {
      deps.readGates.release(tokens);
    }
  });
}
