// The two addresses a logo tile talks to.
//
// Both are platform code adjacent to — never inside — the fixed `/capability/:id/:action`
// convention the generated UI targets. Four segments rather than three, so a capability
// can never declare an Action that collides with one
// ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md), Consequences).
//
// `POST …/logo-attempt` is a **paid mutation**, which is why it is a POST and why its
// response is `no-store`: an attempt encoded as a GET is one a browser, a prefetcher or
// a proxy is entitled to make on its own. It answers with the one tile it acted on,
// re-rendered from the registry and deliberately inert — a failure that returns the row
// to `absent` comes back without a load trigger, so a swap cannot recursively spend the
// remaining attempts inside one page load.
//
// `GET …/logo.svg` serves the accepted bytes exactly as they arrived, gated on the exact
// active incarnation being `present`. **5.5/03 owns the rest of that route**: the
// immutable cache directive, the compressed response and the ADR's full statement of the
// picture-only rule. What is here is the minimum that makes this issue's artwork visible
// on the desk — correct type, sniffing off, inert as a document, and never cached while
// absent.

import { readFileSync } from "node:fs";
import type { Hono } from "hono";
import type { MutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import type { ReadGateCoordinator } from "../read-gates/index.ts";
import { readActiveRegistryCatalog } from "../registry/index.ts";
import { renderCapabilityLogo } from "../web/index.ts";
import { readAttemptTarget, runCapabilityLogoAttempt } from "./attempt.ts";
import { createRecraftLogoProvider, type LogoGenerationProvider } from "./provider.ts";
import { capabilityLogoExists, capabilityLogoPath } from "./storage.ts";

export interface CapabilityLogoRouteDeps {
  readonly registryDatabases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
  readonly artifactsRoot: string;
  /** Injected in every test. Defaults to the real, paid service. */
  readonly logoProvider?: LogoGenerationProvider;
}

const NO_STORE = { "cache-control": "no-store" } as const;

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

    try {
      await runCapabilityLogoAttempt(target, {
        databases: deps.registryDatabases,
        mutationCoordinator: deps.mutationCoordinator,
        readGates: deps.readGates,
        artifactsRoot: deps.artifactsRoot,
        provider: resolveProvider(),
      });
    } catch (error) {
      // The attempt swallows every ordinary failure itself, so reaching here means
      // something structural — a coordinator write that threw, a row that cannot make a
      // request. The desk still gets a tile: a logo is never worth a broken desk.
      console.error(
        `omni-crud logo attempt for ${target.capabilityId}/${target.incarnationId} raised:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Re-read rather than infer from the outcome: the tile states what the registry now
    // holds, which is also the right answer when this request lost the claim to another.
    const row = readAttemptTarget(target, deps.registryDatabases);
    // A capability deleted while its logo was being drawn has no tile; an empty body
    // swapped as `outerHTML` takes the button off the desk, which is correct.
    return c.html(row ? renderCapabilityLogo(row, { armLogoAttempt: false }) : "", 200, NO_STORE);
  });

  app.get("/capability/:id/:incarnation_id/logo.svg", (c) => {
    const capabilityId = c.req.param("id");
    const incarnationId = c.req.param("incarnation_id");
    const row = readAttemptTarget({ capabilityId, incarnationId }, deps.registryDatabases);
    if (row?.logo.status !== "present") {
      // Never cached: a request made before the artwork arrives must not cache its
      // absence forever.
      return c.body(null, 404, NO_STORE);
    }

    // The read token is held for the serve, so deletion cannot race the file out from
    // under an in-flight response.
    const tokens = deps.readGates.tryAcquire({
      catalog: readActiveRegistryCatalog(deps.registryDatabases.readonly).capabilities.map(
        (candidate) => ({
          capabilityId: candidate.id,
          incarnationId: candidate.incarnation_id,
        }),
      ),
      incarnations: [{ capabilityId, incarnationId }],
    });
    if (!tokens) return c.body(null, 404, NO_STORE);

    try {
      const path = capabilityLogoPath(deps.artifactsRoot, capabilityId, incarnationId);
      if (!capabilityLogoExists(deps.artifactsRoot, capabilityId, incarnationId)) {
        return c.body(null, 404, NO_STORE);
      }
      return c.body(readFileSync(path), 200, { ...PICTURE_ONLY_HEADERS, ...NO_STORE });
    } finally {
      deps.readGates.release(tokens);
    }
  });
}
