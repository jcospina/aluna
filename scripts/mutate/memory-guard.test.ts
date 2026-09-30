import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import {
  BLIND_SAMPLES,
  groupUsage,
  KILLED_STATUS,
  parseGuardArgs,
  sample,
} from "./memory-guard.ts";

const GUARD = join(import.meta.dir, "memory-guard.ts");
const BUN = process.execPath;
const MIB = 1024 ** 2;
const table = ["10 10 100", "11 10 200", "12 10 300", "13 99 400", "20 1 5000"].join("\n");

/** Allocates up to `mib` then idles: bounded, so a guard that regressed cannot take the machine down. */
const hog = (mib: number) =>
  `const hoard = []; for (let i = 0; i < ${mib}; i++) hoard.push(new Uint8Array(${MIB}).fill(1)); setTimeout(() => {}, 15000);`;

function guarded(args: string[], env: Record<string, string | undefined> = process.env) {
  return Bun.spawn([BUN, GUARD, ...args], { stderr: "pipe", stdout: "pipe", env });
}

describe("the memory guard's arithmetic", () => {
  test("counts every process in the group, and only the group", () => {
    expect(groupUsage(10, table)).toEqual({ bytes: (100 + 200 + 300) * 1024, pids: [10, 11, 12] });
    expect(groupUsage(99, table)).toEqual({ bytes: 400 * 1024, pids: [13] });
    expect(groupUsage(7, table)).toEqual({ bytes: 0, pids: [] });
  });

  test("kills over the cap, lets a group under it run, and notices when it is gone", () => {
    expect(sample(table, 99, 1024 ** 2, 0)).toEqual({ blind: 0, killFor: "", groupEmpty: false });
    expect(sample(table, 99, 1000, 0).killFor).toContain("over 1000");
    expect(sample(table, 7, 1000, 0)).toEqual({ blind: 0, killFor: "", groupEmpty: true });
  });

  test("tolerates a missed look or two, then kills rather than runs blind", () => {
    let blind = 0;
    for (let look = 1; look < BLIND_SAMPLES; look++) {
      const next = sample(null, 99, 1000, blind);
      expect(next).toEqual({ blind: look, killFor: "", groupEmpty: false });
      blind = next.blind;
    }
    expect(sample(null, 99, 1000, blind).killFor).toContain("could not be read");
    expect(sample(table, 99, 1024 ** 2, blind).blind).toBe(0);
  });

  test("refuses a run it cannot guard", () => {
    expect(() => parseGuardArgs([])).toThrow(/usage/);
    expect(() => parseGuardArgs(["--max-bytes=0", "true"])).toThrow(/positive/);
    expect(parseGuardArgs(["--max-bytes=10", "bun", "x"])).toEqual({
      cap: 10,
      command: ["bun", "x"],
    });
  });
});

describe("the memory guard, running", () => {
  test("passes a well-behaved command's exit status through", async () => {
    expect(await guarded([BUN, "-e", "process.exit(3)"]).exited).toBe(3);
  });

  test("stops a runaway long before it can take the machine down", async () => {
    const started = Date.now();
    const run = guarded([`--max-bytes=${256 * MIB}`, BUN, "-e", hog(1500)]);
    expect(await run.exited).toBe(KILLED_STATUS);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await new Response(run.stderr).text()).toContain("memory guard");
  }, 20_000);

  test("still watches a descendant whose parent has already exited", async () => {
    const orphaning = `Bun.spawn([${JSON.stringify(BUN)}, "-e", ${JSON.stringify(hog(1500))}]); process.exit(0);`;
    const run = guarded([`--max-bytes=${256 * MIB}`, BUN, "-e", orphaning]);
    expect(await run.exited).toBe(KILLED_STATUS);
  }, 20_000);

  test("kills rather than runs blind when the process table cannot be read", async () => {
    const run = guarded([BUN, "-e", "setTimeout(() => {}, 15000)"], {
      ...process.env,
      PATH: dirname(BUN),
    });
    expect(await run.exited).toBe(KILLED_STATUS);
    expect(await new Response(run.stderr).text()).toContain("could not be read");
  }, 20_000);
});
