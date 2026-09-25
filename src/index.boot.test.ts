import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForLog } from "./platform/async.test-support.ts";
import {
  OBJECT_STORE_ROOT_ENV_VAR,
  STAGING_DIRECTORY,
} from "./platform/files/object-store-root.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omni-crud-boot-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("boot empties the upload staging directory before the server listens", async () => {
  const root = join(dir, "objects");
  const staging = join(root, STAGING_DIRECTORY);
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "unfinished-upload"), "bytes a previous process never finished");

  const proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
    cwd: dir,
    env: { ...process.env, PORT: "0", [OBJECT_STORE_ROOT_ENV_VAR]: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForLog(proc.stdout, "listening", 15_000);
    expect(readdirSync(staging)).toEqual([]);
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 20_000);
