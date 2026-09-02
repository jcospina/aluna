// The two addresses a logo tile talks to — platform code adjacent to, never inside, the
// fixed `/capability/:id/:action` convention the generated UI targets. Four segments
// rather than three, so a capability can never declare an Action that collides with one
// (ADR-0007, Consequences).
//
// `POST …/logo-attempt` is a paid mutation, which is why it is a POST and why its response
// is `no-store`: an attempt encoded as a GET is one a browser, a prefetcher or a proxy is
// entitled to make on its own. It answers with the one tile it acted on, re-rendered and
// deliberately inert, so a swap cannot recursively spend the remaining attempts.
//
// `GET …/logo.svg` serves the accepted bytes exactly as they arrived, immutable. The
// address binds the semantic id *and* the incarnation: L7 says those bytes are never
// remade, and the incarnation is what keeps that honest, since a deleted id may be rebuilt
// with different artwork. Every other state, a mismatched incarnation and a missing file
// fail closed with `no-store`, so an early 404 cannot outlive artwork that arrives later.
// Responses are compressed and picture-only; the stored bytes are never touched (L8).

import type { Context, Hono } from "hono";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
} from "../../runtime/concurrency/read-gates.ts";
import { renderCapabilityLogoFace } from "../../web/index.ts";
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
 * How long a claim loser watches the winner before answering with whatever the registry
 * then holds.
 *
 * Two desk loads racing the same faceless tile mean one of them made the call and the
 * other has nothing to do. ADR-0007 gives that one a bounded observation of the winner
 * rather than an instant resting placeholder — the second tab should light up with the
 * first, not one desk load later — and forbids turning it into a poll: what is awaited
 * here is the winner's own completion, which costs one promise and no interval.
 *
 * The bound is the winner's own wall-clock bound plus the moment it needs to install and
 * finalize, because observing longer than the winner can possibly run is not a bound on
 * anything real. It is therefore never the longer request of the two: the winner is
 * already holding its own POST open for exactly this drawing.
 */
const LOGO_CLAIM_OBSERVATION_MS = DEFAULT_LOGO_GENERATION_TIMEOUT_MS + 5_000;

/**
 * A year is the longest age HTTP defines as meaningful, and `immutable` additionally
 * tells a browser not to revalidate even on an explicit reload. Both are only safe
 * because of L7 and the incarnation in the path: these bytes are never remade, and the
 * one event that changes a capability's picture — delete, then rebuild — mints a new
 * incarnation and therefore a different address that shares no cache entry with this one.
 */
const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" } as const;

/**
 * The stored bytes are handed out untouched (L8), so the response — not the file — is
 * what makes the address inert when it is opened as a document rather than drawn as a
 * picture. `sandbox` with no allow-list removes scripting entirely, and `nosniff` stops
 * a browser deciding the bytes are something else.
 */
const PICTURE_ONLY_HEADERS = {
  "content-type": "image/svg+xml",
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

/**
 * The response body depends on this request header, and it is cached for a year: a shared
 * cache that stored the compressed variant without being told would hand it to the next
 * client along, decodable or not.
 */
const VARY_ON_ENCODING = { vary: "accept-encoding" } as const;

/**
 * Whether this client said it can decode gzip.
 *
 * Parsed rather than substring-matched, because `gzip;q=0` is the explicit way to say
 * *not* gzip and reads as an acceptance to anything looking for the four letters. `*`
 * counts, and a missing header means identity: compression is an optimization, and the
 * response has to be correct for a client that never asked for it.
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
 * One drawing's bytes, as the immutable picture-only response the ADR describes.
 *
 * Compressed per request rather than kept: `immutable` means a client asks once per
 * incarnation and then draws from its own cache for a year, so a resident copy of every
 * logo ever served would grow without bound to save work nobody repeats.
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
 * This request's whole share of the work: claim and spend an attempt, or — when another
 * load is already drawing this very tile — watch that one for a bounded moment.
 *
 * Every other `unclaimed` reason (`present`, `abandoned`, a deleted row, a missing key)
 * has no winner to watch and returns at once. Nothing here spends twice, and the desk
 * that rendered this tile finished rendering before the request was sent.
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
    // The attempt swallows every ordinary failure itself, so reaching here means
    // something structural — a coordinator write that threw, a row that cannot make a
    // request. The desk still gets a tile: a logo is never worth a broken desk.
    console.error(
      `omni-crud logo attempt for ${target.capabilityId}/${target.incarnationId} raised:`,
      error instanceof Error ? error.message : error,
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

    // Same-origin, enforced rather than assumed. `HX-Request` is a custom header, so a
    // cross-origin request carrying it needs a CORS preflight this route never answers —
    // which is what stops a page the user happens to visit from posting a form here and
    // burning three paid attempts. The tile is the only caller, and it always sends it.
    if (c.req.header("HX-Request") !== "true") {
      return c.body(null, 404, NO_STORE);
    }

    await spendOrObserve(target, deps, resolveProvider(), c.req.raw.signal);

    // Re-read rather than infer from the outcome: the tile states what the registry now
    // holds, which is also the right answer when this request lost the claim to another.
    const row = readAttemptTarget(target, deps.registryDatabases);
    // The face and not the slot: this swap is the only one on the desk nobody asked for,
    // and the menu and the rename editor beside the button are the user's own state
    // (5.9/01). A capability deleted while its logo was being drawn has no tile; an empty
    // body swapped as `outerHTML` takes the button off the desk, which is correct.
    return c.html(
      row ? renderCapabilityLogoFace(row, { armLogoAttempt: false }) : "",
      200,
      NO_STORE,
    );
  });

  app.get("/capability/:id/:incarnation_id/logo.svg", (c) => {
    const capabilityId = c.req.param("id");
    const incarnationId = c.req.param("incarnation_id");
    // Both halves of the address have to name the same active row. A semantic id that
    // matches is not enough: an address minted for a lifetime that has since been deleted
    // and rebuilt must answer nothing rather than fall through to the new drawing, or the
    // year-long cache entry it was granted would be holding the wrong capability's face.
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
      // `present` with no readable file is a row desk-load recovery reconciles to
      // `abandoned` (`recovery.ts`). The route's job is to not pretend, and above all to
      // not let a browser cache the gap under a directive that outlives every attempt
      // that could still fill it. An empty file is that same gap: no drawing ever
      // validated as zero bytes, so it is a truncation, and a truthy empty `Uint8Array`
      // would otherwise sail straight past this guard and be cached as a blank tile for
      // a year.
      if (!stored || stored.byteLength === 0) return c.body(null, 404, NO_STORE);
      return servePicture(c, stored);
    } finally {
      deps.readGates.release(tokens);
    }
  });
}
