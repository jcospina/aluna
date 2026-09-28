#!/usr/bin/env bun
/**
 * Runs a command in a process group of its own and kills the whole group once it holds more
 * memory than a cap.
 *
 * A mutant can turn a loop into endless allocation: one `bun test` under `bun run mutate` climbed
 * to 20 GB in 20 seconds, which is how this machine was taken down before. Stryker's timeout is
 * far too slow for that, so every test run a mutation check makes goes through this. A run the
 * guard stops exits 137, and Stryker counts the mutant as killed, as it counts a timeout.
 *
 * The group, not the parent-child tree, is what is watched: a process whose parent exits is
 * handed to launchd and would drop out of a tree. The watch lasts until the group is empty, and
 * if `ps` cannot be read the guard kills rather than runs blind.
 *
 * @example
 *   bun scripts/memory-guard.ts bun test ./src/a.test.ts
 *   bun scripts/memory-guard.ts --max-bytes=1073741824 bun test ./src/a.test.ts
 */

import { spawn, spawnSync } from "node:child_process";

export const DEFAULT_CAP_BYTES = 4 * 1024 ** 3;
const SAMPLE_MS = 50;
export const BLIND_SAMPLES = 3;
export const KILLED_STATUS = 137;

/** Resident bytes and live pids of process group `group`, from `ps -Ao pid=,pgid=,rss=` (KiB). */
export function groupUsage(group: number, table: string): { bytes: number; pids: number[] } {
  let bytes = 0;
  const pids: number[] = [];
  for (const line of table.split("\n")) {
    const [pid, pgid, kib] = line.trim().split(/\s+/).map(Number);
    if (pgid !== group || pid === undefined || kib === undefined || Number.isNaN(kib)) continue;
    bytes += kib * 1024;
    pids.push(pid);
  }
  return { bytes, pids };
}

export function parseGuardArgs(argv: readonly string[]): { cap: number; command: string[] } {
  const flag = argv[0]?.startsWith("--max-bytes=") ? argv[0] : undefined;
  const cap = flag === undefined ? DEFAULT_CAP_BYTES : Number(flag.slice("--max-bytes=".length));
  if (!(cap > 0)) throw new Error(`--max-bytes must be a positive number: ${flag}`);
  const command = argv.slice(flag === undefined ? 0 : 1);
  if (command.length === 0) throw new Error("usage: memory-guard [--max-bytes=N] <command…>");
  return { cap, command };
}

export interface Sample {
  readonly blind: number;
  /** Why the group must die, or "" while it may run. */
  readonly killFor: string;
  readonly groupEmpty: boolean;
}

/** One look at the group: `table` is `ps` output, or `null` when `ps` could not be read. */
export function sample(
  table: string | null,
  group: number,
  cap: number,
  blindBefore: number,
): Sample {
  const blind = table === null ? blindBefore + 1 : 0;
  if (blind >= BLIND_SAMPLES) {
    return { blind, killFor: "the process table could not be read", groupEmpty: false };
  }
  if (table === null) return { blind, killFor: "", groupEmpty: false };
  const { bytes, pids } = groupUsage(group, table);
  const killFor = bytes > cap ? `it held ${bytes} bytes, over ${cap}` : "";
  return { blind, killFor, groupEmpty: pids.length === 0 };
}

/** The process table, or `null` when `ps` could not be read. */
function processTable(): string | null {
  const ps = spawnSync("ps", ["-Ao", "pid=,pgid=,rss="], { encoding: "utf8" });
  return ps.status === 0 && typeof ps.stdout === "string" ? ps.stdout : null;
}

function killGroup(group: number): void {
  try {
    process.kill(-group, "SIGKILL");
  } catch {
    // The group is already empty.
  }
}

if (import.meta.main) {
  const { cap, command } = parseGuardArgs(process.argv.slice(2));
  const [file = "", ...args] = command;
  const child = spawn(file, args, { detached: true, stdio: "inherit" });
  if (child.pid === undefined) {
    console.error(`memory guard: could not start ${file}`);
    process.exit(127);
  }
  const group = child.pid;
  let status: number | null = null;
  let blind = 0;
  child.on("exit", (code, signal) => {
    status = code ?? 128 + (signal === "SIGKILL" ? 9 : 15);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      killGroup(group);
      process.exit(KILLED_STATUS);
    });
  }
  const watch = setInterval(() => {
    const next = sample(processTable(), group, cap, blind);
    blind = next.blind;
    if (next.killFor !== "") killGroup(group);
    if (next.killFor === "" && (!next.groupEmpty || status === null)) return;
    clearInterval(watch);
    if (next.killFor !== "")
      console.error(`memory guard: ${command.join(" ")} killed: ${next.killFor}`);
    process.exit(next.killFor === "" ? (status ?? 0) : KILLED_STATUS);
  }, SAMPLE_MS);
}
