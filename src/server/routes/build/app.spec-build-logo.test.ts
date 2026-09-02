// The seam between a build and its logo, exercised through the real prompt → build →
// commit path.
//
// The two properties [ADR-0007](../../docs/adr/0007-capability-logo-contract.md) puts
// here are about *ordering*, and neither can be seen from inside the logo module:
//
//   - **A build never pays.** The Gate, publication and SQLite activation all happen
//     before anything is ordered, so a build that fails, goes stale or is cancelled costs
//     nothing. What proves it is that the logo provider is not called at all during the
//     build — the request only ever comes from the activated tile.
//   - **A logo failure cannot relabel the build.** The build is already `success` /
//     activated when the attempt runs, so provider trouble afterwards leaves the metrics
//     row and the capability exactly as they were.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { reconcileCapabilityArtifacts } from "../../../builder/artifacts/publication/artifact-reconciliation.ts";
import { LogoGenerationError, type LogoGenerationProvider } from "../../../lifecycle/logo/index.ts";
import type { GenerationMetrics } from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { getCapability } from "../../../registry/index.ts";
import {
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  runPromptBuild,
  teardownScratchDbEnv,
} from "../../app.test-support.ts";
import { createApp } from "../../app.ts";

setDefaultTimeout(15_000);

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeEach(() => {
  ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-build-logo-"));
});

afterEach(() => {
  teardownScratchDbEnv({ dir, conns, artifactsRoot });
});

interface CountingLogoProvider extends LogoGenerationProvider {
  calls: number;
}

function countingProvider(bytes: Uint8Array | null): CountingLogoProvider {
  const provider: CountingLogoProvider = {
    calls: 0,
    async generate() {
      provider.calls += 1;
      if (!bytes) throw new LogoGenerationError("http", "the service is unavailable");
      return bytes;
    },
  };
  return provider;
}

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

// What the tile sends. The paid route requires it, so nothing cross-origin can reach it.
const ATTEMPT: RequestInit = { method: "POST", headers: { "HX-Request": "true" } };

function buildingApp(logoProvider: LogoGenerationProvider): {
  app: ReturnType<typeof createApp>;
  rows: GenerationMetrics[];
} {
  const { rows, recordMetrics } = makeMetricsRecorder();
  const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
  return {
    rows,
    app: createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      logoProvider,
    }),
  };
}

describe("a build and the logo it does not pay for", () => {
  test("nothing is ordered while the build runs, and the activated tile arms one attempt", async () => {
    const logoProvider = countingProvider(ARTWORK);
    const { app, rows } = buildingApp(logoProvider);

    const { events } = await runPromptBuild(app, "track my notes");

    // The Gate, publication and activation have all succeeded and nothing has been
    // ordered: the request comes from the tile, after this stream has closed.
    expect(logoProvider.calls).toBe(0);
    expect(rows[0]?.outcome).toBe("success");

    const row = getCapability("notes", conns.readonly);
    expect(row?.logo).toEqual({ status: "absent", attempts: 0 });

    // The commit swap stands the registry-backed tile on the desk with its one attempt
    // armed, bound to the incarnation activation just minted.
    const commit = eventData(events, "commit");
    expect(commit).toContain(`/capability/notes/${row?.incarnation_id}/logo-attempt`);
    expect(commit).toContain('hx-trigger="load"');
  });

  test("a logo failure afterwards changes neither the build's outcome nor its capability", async () => {
    const logoProvider = countingProvider(null);
    const { app, rows } = buildingApp(logoProvider);

    await runPromptBuild(app, "track my notes");
    const before = getCapability("notes", conns.readonly);
    const metricsBefore = JSON.stringify(rows);

    const attempt = await app.request(`/capability/notes/${before?.incarnation_id}/logo-attempt`, {
      ...ATTEMPT,
    });

    expect(attempt.status).toBe(200);
    expect(logoProvider.calls).toBe(1);
    // One metrics row, still `success`. A provider failure is not a build failure.
    expect(JSON.stringify(rows)).toBe(metricsBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("success");

    const after = getCapability("notes", conns.readonly);
    // The capability is untouched but for the spend it now records.
    expect(after?.version).toBe(before?.version);
    expect(after?.incarnation_id).toBe(before?.incarnation_id);
    expect(after?.artifacts_path).toBe(before?.artifacts_path);
    expect(after?.logo).toEqual({ status: "absent", attempts: 1 });

    // Finished, usable and placeholdered: its collection still opens and still lists.
    const view = await app.request("/capability/notes", {
      headers: { "HX-Request": "true" },
    });
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('data-active-capability-id="notes"');
  });

  test("the artwork lands on the desk when the service answers", async () => {
    const logoProvider = countingProvider(ARTWORK);
    const { app } = buildingApp(logoProvider);

    await runPromptBuild(app, "track my notes");
    const row = getCapability("notes", conns.readonly);
    const attempt = await app.request(`/capability/notes/${row?.incarnation_id}/logo-attempt`, {
      ...ATTEMPT,
    });

    expect(await attempt.text()).toContain(
      `background-image: url('/capability/notes/${row?.incarnation_id}/logo.svg')`,
    );
    expect(getCapability("notes", conns.readonly)?.logo).toEqual({
      status: "present",
      attempts: 1,
    });

    // And the desk shows it on the next load, with nothing left to claim.
    const desk = await (await app.request("/")).text();
    expect(desk).toContain(`/capability/notes/${row?.incarnation_id}/logo.svg`);
    // Nothing left to claim. Named at the attempt route rather than at every POST on the
    // desk: the logo's own menu carries a rename form, and the shell loads the attempt
    // module's script on every page whether or not a tile has one to spend.
    expect(desk).not.toContain('hx-post="/capability/notes');
  });
});

describe("a build that never activates", () => {
  test("orders nothing, and stands no armed tile on the desk", async () => {
    // A structurally broken Handler fails the Gate, so publication and activation never
    // happen. Nothing may be spent for a capability that can still be refused (L10), and
    // the only thing that ever arms an attempt is a registry-backed tile — which a build
    // that produced no row cannot have.
    const logoProvider = countingProvider(ARTWORK);
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC, undefined, {
      create: "export const create = (",
      repairs: ["export const create = (", "export const create = ("],
    });
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      logoProvider,
    });

    const { events } = await runPromptBuild(app, "track my notes");

    expect(rows[0]?.outcome).not.toBe("success");
    expect(getCapability("notes", conns.readonly)).toBeNull();
    expect(logoProvider.calls).toBe(0);
    // No tile, armed or otherwise: there is no incarnation to bind an attempt to.
    expect(events.map((event) => event.data).join("")).not.toContain("logo-attempt");
    // And the desk itself offers nothing to claim.
    expect(await (await app.request("/")).text()).not.toMatch(/hx-post="[^"]*logo-attempt"/);
  });
});

describe("the artifact tree after a logo lands", () => {
  test("reconciliation accepts a real published tree that has grown a face", async () => {
    // Reconciliation runs at boot (`src/index.ts`) and at the head of every new build and
    // evolution. It enumerates the incarnation directory the logo now lives in, so it has
    // to know the file by name: when it did not, the first capability to grow artwork made
    // every later build fail and the platform unbootable.
    const logoProvider = countingProvider(ARTWORK);
    const { app } = buildingApp(logoProvider);
    await runPromptBuild(app, "track my notes");
    const row = getCapability("notes", conns.readonly);
    await app.request(`/capability/notes/${row?.incarnation_id}/logo-attempt`, ATTEMPT);
    expect(getCapability("notes", conns.readonly)?.logo.status).toBe("present");

    const result = reconcileCapabilityArtifacts({
      database: conns.readwrite,
      artifactsRoot,
    });

    expect(result.removed).toEqual([]);
    expect(result.committed).toEqual([
      {
        capabilityId: "notes",
        incarnationId: row?.incarnation_id ?? "",
        liveVersion: 1,
        versions: [1],
      },
    ]);
    // The published v1 inventory is untouched: the artwork is a sibling, never a member.
    expect(readdirSync(join(artifactsRoot, "notes", row?.incarnation_id ?? "")).sort()).toEqual([
      ".staging",
      "logo.svg",
      "v1",
    ]);
    expect(
      readdirSync(join(artifactsRoot, "notes", row?.incarnation_id ?? "", "v1")),
    ).not.toContain("logo.svg");
  });
});
