import { expect, test } from "bun:test";

import type { PlatformDatabase } from "../../persistence/db.ts";
import {
  insertCapabilityDeletionTombstone,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../router/router.test-support.ts";
import { revalidateResolvedRequest } from "./core-builder.ts";
import { resolvedNewCapabilityRequest } from "./resolved-request.ts";

test("a proposed id reserved by pending deletion cleanup is refused at the provider boundary", () => {
  let dir: string;
  let conns: PlatformDatabase;
  ({ dir, conns } = setupRouterTest());
  try {
    const target = notesRow();
    install(conns, target);
    const fingerprint = readActiveRegistryCatalog(conns.readonly).fingerprint;
    conns.readwrite.transaction(() => {
      insertCapabilityDeletionTombstone(
        { capabilityId: target.id, incarnationId: target.incarnation_id, manifest: [] },
        conns.readwrite,
      );
    })();

    const outcome = revalidateResolvedRequest(
      resolvedNewCapabilityRequest({
        prompt: "recreate my notes",
        intent: {
          type: "new_capability",
          confidence: 0.9,
          target_capability: "notes",
          resolution: "namespace",
          proposed_identity: { id: "notes", label: "Notes" },
          proposed_action: "Recreate notes.",
          user_facing_label: "Setting that up.",
          requires_confirmation: false,
        },
        catalogFingerprint: fingerprint,
        resolver: {
          intent: { type: "new_capability", confidence: 0.9, targetCapability: "notes" },
          model: "test-model",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          catalogFingerprint: fingerprint,
        },
      }),
      conns,
    );

    expect(outcome).toMatchObject({
      kind: "stale",
      refusal: { reason: "expected_absent_collision", capabilityId: "notes" },
    });
  } finally {
    teardownRouterTest(dir, conns);
  }
});
