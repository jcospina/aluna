import { afterAll, expect, test } from "bun:test";
import {
  createScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import { REGISTRY_TABLE } from "./store.ts";

// The registry row stays lean (ARCH §6.3): every column is listed here by hand, so adding one
// is a decision this file records rather than a side effect of a migration. The list IS the
// policy; nothing it is compared with derives from it.
//
// A test rather than a `*.policy.ts`, because the columns are only knowable by running the
// migrations: 0012 adds three of them from a loop, so the migration text does not spell them out.

const env = createScratchDbEnv("omni-crud-registry-columns-");
afterAll(() => teardownScratchDbEnv(env));

test("the registry row carries exactly the columns the platform decided on", () => {
  const columns = env.conns.readonly
    .query(`SELECT name FROM pragma_table_info('${REGISTRY_TABLE}') ORDER BY cid`)
    .all() as { name: string }[];

  expect(columns.map((column) => column.name)).toEqual([
    "id",
    "label",
    "version",
    "schema",
    "ui_intent",
    "behavior",
    "tools",
    "artifacts_path",
    "prompt_context",
    "behavioral_errors",
    "incarnation_id",
    "read_dependencies",
    "lifecycle_state",
    "deletion_manifest",
    "deletion_created_at",
    // Cleanup progress rides the tombstone so a wedged deletion is visible to an
    // operator across restarts, not just in the log of the process that hit it.
    "deletion_cleanup_attempts",
    "deletion_cleanup_error",
    "subject",
    "ground",
    "noun",
    "seed",
    "logo_status",
    "logo_attempts",
    "companion",
    // The one name the platform owns. Nullable and defaultless: a capability nobody has
    // renamed says so, rather than restating its authored label in a second column.
    "display_label_override",
    "plural_noun",
  ]);
});
