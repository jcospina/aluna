import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app.ts";
import { openDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { installFieldLifecycleDemo } from "./field-lifecycle.ts";

// This integration runs the complete five-Action Gate twice; leave headroom when
// Bun executes compiler-heavy suites concurrently.
setDefaultTimeout(15_000);

describe("five-Action reference installer admission", () => {
  test("server-side refresh waits for shared mutation admission and gates before replacing live state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aluna-five-action-refresh-"));
    const databases = openDatabase(join(dir, "demo.db"));
    const artifactsRoot = join(dir, "capabilities");
    try {
      runMigrations(databases.readwrite);
      const installed = await installFieldLifecycleDemo({
        database: databases.readwrite,
        artifactsRoot,
        mutationCoordinator: createMutationCoordinator(),
      });
      expect(installed.gate.outcomes.map(({ rung, status }) => `${rung}:${status}`)).toEqual([
        "structural:passed",
        "smoke:passed",
        "behavioral:skipped",
        "design-lint:passed",
      ]);
      const mutationCoordinator = createMutationCoordinator();
      const recordLease = mutationCoordinator.tryAcquireRecordWrite();
      if (!recordLease) throw new Error("expected a record lease");
      const app = createApp({
        artifactsRoot,
        buildDatabases: databases,
        capabilityRouter: { databases },
        mutationCoordinator,
      });

      const refresh = app.request("/demo/five-action-reference/install", { method: "POST" });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (
          mutationCoordinator.snapshot().queuedTickets.some((ticket) => ticket.kind === "build")
        ) {
          break;
        }
        await Bun.sleep(5);
      }

      expect(mutationCoordinator.snapshot()).toMatchObject({
        activeLease: { kind: "record" },
        queuedTickets: [{ kind: "build" }],
      });
      expect(mutationCoordinator.release(recordLease)).toBe(true);

      const response = await refresh;
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        gate: Array<{ rung: string; status: string }>;
      };
      expect(body.status).toBe("installed");
      expect(body.gate.map(({ rung, status }) => `${rung}:${status}`)).toEqual([
        "structural:passed",
        "smoke:passed",
        "behavioral:skipped",
        "design-lint:passed",
      ]);
      expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
      expect(await (await app.request("/")).text()).toContain("Journal entry");
    } finally {
      databases.readonly.close();
      databases.readwrite.close();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
