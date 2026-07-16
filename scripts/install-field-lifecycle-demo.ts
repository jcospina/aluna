const SERVER_INSTALL_URL = "http://localhost:3030/demo/five-action-reference/install";
const FIELD_LIFECYCLE_DEMO_ID = "field_lifecycle_demo";
const MERGE_TARGET_ID = "merge-target";
const DELETE_TARGET_ID = "delete-target";

export async function requestFiveActionReferenceInstall(
  fetchInstall: typeof fetch = fetch,
): Promise<{ artifactsPath: string }> {
  const response = await fetchInstall(SERVER_INSTALL_URL, { method: "POST" });
  if (!response.ok) {
    throw new Error(`The running Aluna server refused the reference install (${response.status}).`);
  }
  return (await response.json()) as { artifactsPath: string };
}

if (import.meta.main) {
  try {
    const result = await requestFiveActionReferenceInstall();
    console.log(
      `Installed the development-only five-Action reference (${FIELD_LIFECYCLE_DEMO_ID}).`,
    );
    console.log(`Artifacts: ${result.artifactsPath}`);
    console.log("Open http://localhost:3030 and choose Journal entry from the toolbar.");
    console.log(`Partial-update target: ${MERGE_TARGET_ID}`);
    console.log(`Delete target: ${DELETE_TARGET_ID}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
