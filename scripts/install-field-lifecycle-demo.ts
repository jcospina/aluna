import { db } from "../src/db.ts";
import { FIELD_LIFECYCLE_DEMO_ID, installFieldLifecycleDemo } from "../src/demo/field-lifecycle.ts";
import { runMigrations } from "../src/migrations.ts";

try {
  runMigrations(db);
  const result = installFieldLifecycleDemo({ database: db });
  console.log(`Installed the ${FIELD_LIFECYCLE_DEMO_ID} living demo.`);
  console.log(`Artifacts: ${result.artifactsPath}`);
  console.log("Open http://localhost:3030 and choose Field lifecycle from the toolbar.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
