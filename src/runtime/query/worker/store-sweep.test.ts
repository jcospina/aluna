import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARTIFACTS_ROOT_ENV_VAR,
  DEFAULT_ARTIFACTS_ROOT,
} from "../../../builder/artifacts/artifacts-root.ts";
import { addedPaths, platformRoots, sweepPlatformStores } from "./store-sweep.test-support.ts";

const planted: string[] = [];
const configuredArtifactsRoot = process.env[ARTIFACTS_ROOT_ENV_VAR];

afterEach(() => {
  for (const path of planted.splice(0)) rmSync(path, { recursive: true, force: true });
  process.env[ARTIFACTS_ROOT_ENV_VAR] = configuredArtifactsRoot;
});

test("a file written one level into any platform root is a path the sweep adds", () => {
  const database = new Database(":memory:");
  const desk = mkdtempSync(join(tmpdir(), "omni-crud-sweep-"));
  planted.push(desk);

  for (const root of platformRoots()) {
    const before = sweepPlatformStores(database, desk);
    const directory = join(root, "planted");
    planted.push(directory);
    mkdirSync(directory);
    writeFileSync(join(directory, "leak.txt"), "a question written down");

    expect(addedPaths(before, sweepPlatformStores(database, desk))).toEqual([
      directory,
      join(directory, "leak.txt"),
    ]);
  }
  database.close();
});

test("the sweep refuses a root inside the repo rather than read the user's corpus", () => {
  process.env[ARTIFACTS_ROOT_ENV_VAR] = DEFAULT_ARTIFACTS_ROOT;
  expect(() => platformRoots()).toThrow(/would read the real/);
});
