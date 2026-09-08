import { join } from "node:path";

import type { CapabilityRow } from "../../../registry/index.ts";
import { notesRow } from "../../../runtime/router/dispatch/router.test-support.ts";

// The capability a deletion suite deletes, and the confirmed answer that takes it away. Shared
// by the two suites that ask what a deletion leaves behind.

/** The notes fixture, standing in a real artifacts tree under `dir` so its files can be removed. */
export function deletionTarget(dir: string): CapabilityRow {
  const target = notesRow();
  return {
    ...target,
    artifacts_path: join(dir, "artifacts", target.id, target.incarnation_id, "v1"),
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
  };
}

/** A confirmed deletion that leaves the desk on no capability at all. */
export function confirmationRequest(incarnationId: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ incarnation_id: incarnationId, restore_surface: "neutral" }),
  };
}
