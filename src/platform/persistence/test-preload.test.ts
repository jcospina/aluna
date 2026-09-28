import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_ARTIFACTS_ROOT,
  resolveArtifactsRoot,
} from "../../builder/artifacts/artifacts-root.ts";
import { OBJECT_STORE_ROOT, resolveObjectStoreRoot } from "../files/object-store-root.ts";
import { DB_PATH, resolveDbPath } from "./db-path.ts";
import { PLATFORM_ROOT_DEFAULTS, withDefaultRoots } from "./test-roots.test-support.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const inside = (parent: string, path: string) => !relative(parent, path).startsWith("..");

const configured = () => [resolveDbPath(), resolveObjectStoreRoot(), resolveArtifactsRoot()];

test("under the test preload every platform root resolves outside the repo", () => {
  for (const root of configured()) {
    expect(isAbsolute(root), root).toBe(true);
    expect(inside(REPO_ROOT, root), root).toBe(false);
    expect(inside(tmpdir(), root), root).toBe(true);
  }
});

test("the roots share one scratch directory that mirrors the repo's layout", () => {
  const [database, store, artifacts] = configured();
  const scratch = resolve(dirname(database ?? ""), "..");
  expect([database, store, artifacts]).toEqual([
    resolve(scratch, DB_PATH),
    resolve(scratch, OBJECT_STORE_ROOT),
    resolve(scratch, DEFAULT_ARTIFACTS_ROOT),
  ]);
});

test("a spawned server handed the defaults resolves every root against its own cwd", () => {
  const env = withDefaultRoots();
  for (const name of Object.keys(PLATFORM_ROOT_DEFAULTS)) expect(env[name]).toBeUndefined();
  expect([resolveDbPath(env), resolveObjectStoreRoot(env), resolveArtifactsRoot(env)]).toEqual(
    Object.values(PLATFORM_ROOT_DEFAULTS),
  );
});
