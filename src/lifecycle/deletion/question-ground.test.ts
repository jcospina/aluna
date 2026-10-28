import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { ACTIVE_CAPABILITY_ATTRIBUTE } from "#shell/core/shell-dom.js";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { capabilityRecordsRegionId, collectionCountSentence } from "../../presentation/index.ts";
import * as recordCount from "../../runtime/data/access/record-count.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/schema/ddl.ts";
import {
  install,
  rowSpec,
  setupRouterTest,
  teardownRouterTest,
} from "../../runtime/router/dispatch/router.test-support.ts";
import * as cachedView from "../../server/http/cached-view.ts";
import { createTestApp } from "../../server/isolated-app.test-support.ts";
import {
  confirmationRequest,
  deletionTarget,
  dependentOnNotes,
} from "../../server/routes/lifecycle/deletion.test-support.ts";

// What the question stands over: the capability's own collection, under the veil, counted, and
// never taken for the capability the window has open.

describe("the question over the capability's own collection", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the question stands over the capability's own collection and counts what goes", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const { tableName } = deriveCapabilityTableDdl(rowSpec(target));
    for (const id of ["a", "b", "c"]) {
      conns.readwrite.run(`INSERT INTO "${tableName}" (id, text) VALUES (?, ?)`, [id, id]);
    }
    const app = createTestApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
    });

    const asked = await (
      await app.request("/capability-deletion/notes?restore_surface=neutral")
    ).text();
    const nouns = { noun: target.noun, plural: target.plural_noun };
    const ground = asked.slice(0, asked.indexOf('class="window__leaving'));
    // The records load under the veil the way they do in the open collection...
    expect(ground).toContain(`id="${capabilityRecordsRegionId(target.id)}"`);
    // ...but nothing marks them as the capability the window has open: the address, the title
    // and a later deletion's restoration all read that mark.
    expect(asked).not.toContain(ACTIVE_CAPABILITY_ATTRIBUTE);
    expect(asked.slice(ground.length)).toContain(collectionCountSentence(3, nouns));

    const blocker = dependentOnNotes();
    install(conns, blocker);
    const refused = await (
      await app.request(
        "/capability-deletion/notes/confirm",
        confirmationRequest(target.incarnation_id),
      )
    ).text();
    // A refusal is said over the same collection, which is still all there.
    expect(refused).toContain("data-capability-deletion-ending");
    expect(refused).toContain(`id="${capabilityRecordsRegionId(target.id)}"`);
    expect(refused).not.toContain(ACTIVE_CAPABILITY_ATTRIBUTE);

    conns.readwrite.run("DELETE FROM capability_registry WHERE id = ?", [blocker.id]);
    const failing = createTestApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
      capabilityDestructionFaults: {
        afterTableDropped: () => {
          throw new Error("stopped before the commit");
        },
      },
    });
    const failed = await (
      await failing.request(
        "/capability-deletion/notes/confirm",
        confirmationRequest(target.incarnation_id),
      )
    ).text();
    // A deletion that failed before its commit took nothing, and says so over what it kept.
    expect(failed).toContain("data-capability-deletion-ending");
    expect(failed).toContain(`id="${capabilityRecordsRegionId(target.id)}"`);
  });

  test("a collection that cannot be drawn or counted still lets the question be asked", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const app = createTestApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
    });
    const fail = (what: string) => () => {
      throw new Error(`cannot ${what}`);
    };
    const drawn = spyOn(cachedView, "renderCachedCapabilityCollection").mockImplementation(
      fail("draw"),
    );
    const counted = spyOn(recordCount, "countCapabilityRecords").mockImplementation(fail("count"));
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await app.request("/capability-deletion/notes?restore_surface=neutral");
      const asked = await response.text();
      expect(response.status).toBe(200);
      expect(asked).toContain("data-capability-deletion-focus");
      expect(asked).not.toContain(`id="${capabilityRecordsRegionId(target.id)}"`);
      // A count that could not be read is not zero records: it states no number at all.
      expect(/<p class="window__leaving-detail">([^<]*)<\/p>/.exec(asked)?.[1]).not.toMatch(/\d/);
      expect(drawn).toHaveBeenCalled();
      expect(counted).toHaveBeenCalled();
    } finally {
      drawn.mockRestore();
      counted.mockRestore();
      quiet.mockRestore();
    }
  });
});
