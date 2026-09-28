import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// A test builds the app through `createTestApp`, never `createApp`, whose defaults are the stores
// every file in the process shares (isolated-app.test-support.ts).

const ROOT = resolve(import.meta.dir, "../..");
const HELPER = "src/server/isolated-app.test-support.ts";
const TEST_FILE = /\.(test|test-support|policy)\.ts$/;
const NAMED_IMPORT = /import\s*\{[^}]*\bcreateApp\b[^}]*\}\s*from\s*"[^"]*\/app\.ts"/;
const WHOLE_MODULE =
  /import\s*\*\s*as\s+\w+\s+from\s*"[^"]*\/app\.ts"|import\(\s*"[^"]*\/app\.ts"\s*\)/;

/** Whether a file reaches `createApp`: by name, or through the whole module, bound or dynamic. */
const buildsTheApp = (source: string): boolean =>
  NAMED_IMPORT.test(source) || (WHOLE_MODULE.test(source) && /\bcreateApp\b/.test(source));

function testFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { recursive: true, encoding: "utf8" })
    .filter((name) => TEST_FILE.test(name))
    .map((name) => join(directory, name));
}

test("no test builds the app on its real stores", () => {
  const scanned = [...testFiles("src"), ...testFiles("scripts")];
  expect(scanned).toContain(HELPER);
  const offenders = scanned.filter(
    (path) => path !== HELPER && buildsTheApp(readFileSync(join(ROOT, path), "utf8")),
  );
  expect(offenders).toEqual([]);
});
