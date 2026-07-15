const SERVER_INSTALL_URL = "http://localhost:3030/demo/five-action-reference/install";
const FIELD_LIFECYCLE_DEMO_ID = "field_lifecycle_demo";

try {
  let result: { artifactsPath: string };
  try {
    const response = await fetch(SERVER_INSTALL_URL, { method: "POST" });
    if (!response.ok) {
      throw new Error(
        `The running Aluna server refused the reference install (${response.status}).`,
      );
    }
    result = (await response.json()) as { artifactsPath: string };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;

    const [
      { db },
      { installFieldLifecycleDemo },
      { runMigrations },
      { createMutationCoordinator },
    ] = await Promise.all([
      import("../src/db.ts"),
      import("../src/demo/field-lifecycle.ts"),
      import("../src/migrations.ts"),
      import("../src/mutation-coordinator/index.ts"),
    ]);
    runMigrations(db);
    result = await installFieldLifecycleDemo({
      database: db,
      mutationCoordinator: createMutationCoordinator(),
    });
  }
  console.log(`Installed the development-only five-Action reference (${FIELD_LIFECYCLE_DEMO_ID}).`);
  console.log(`Artifacts: ${result.artifactsPath}`);
  console.log("Open http://localhost:3030 and choose Journal entry from the toolbar.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
