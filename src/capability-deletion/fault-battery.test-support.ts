// Shared fixtures for the deletion fault battery. Not a test file (no `*.test.ts`), so
// bun never runs it; it exists so the battery itself stays one readable acceptance list.

import { expect } from "bun:test";

import type { PlatformDatabase } from "../persistence/db.ts";
import type { CapabilityIncarnation } from "../read-gates/index.ts";
import type { CapabilityRow } from "../registry/index.ts";
import type { FakeOwnedResourceStore } from "./seam-fakes/owned-resources.test-support.ts";

export const METRIC_ID = "metric-under-deletion";
export const BUILD_ID = "build-under-deletion";

/** Both incarnation-keyed measurement stores ARCH §6.3 keeps outside the cleanup seam. */
export function seedGenerationMetric(conns: PlatformDatabase, incarnationId: string): void {
  conns.readwrite.run(
    "INSERT INTO generation_metrics (id, outcome, intent_type, intent_confidence, model, incarnation_id) VALUES (?, ?, ?, ?, ?, ?)",
    [METRIC_ID, "success", "new_capability", 1, "fake", incarnationId],
  );
  conns.readwrite.run(
    "INSERT INTO generation_lifecycle_metrics (build_id, incarnation_id, capability_id, lifecycle_status, outcome) VALUES (?, ?, ?, ?, ?)",
    [BUILD_ID, incarnationId, "notes", "success", "activated"],
  );
}

/** Generation metrics survive every deletion scenario; nothing in the seam may touch them. */
export function expectGenerationMetricSurvives(
  conns: PlatformDatabase,
  incarnationId: string,
): void {
  expect(
    conns.readonly
      .query("SELECT id, incarnation_id FROM generation_metrics WHERE id = ?")
      .get(METRIC_ID),
  ).toEqual({ id: METRIC_ID, incarnation_id: incarnationId });
  expect(
    conns.readonly
      .query(
        "SELECT build_id, incarnation_id, outcome FROM generation_lifecycle_metrics WHERE build_id = ?",
      )
      .get(BUILD_ID),
  ).toEqual({ build_id: BUILD_ID, incarnation_id: incarnationId, outcome: "activated" });
}

export function tableExists(conns: PlatformDatabase, name: string): boolean {
  return (
    conns.readonly
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== null
  );
}

export function stagePending(store: FakeOwnedResourceStore, row: CapabilityRow, key: string): void {
  store.stage({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    key,
    fieldName: "text",
    fieldLifecycle: "active",
    shape: "file",
    state: "pending",
  });
}

export function incarnationOf(row: CapabilityRow): CapabilityIncarnation {
  return { capabilityId: row.id, incarnationId: row.incarnation_id };
}
