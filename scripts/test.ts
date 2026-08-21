#!/usr/bin/env bun
/**
 * The platform's test runner: shards `bun test` across worker processes.
 *
 * `bun test` runs every file sequentially inside one process, which made the
 * suite slow and — worse — let files leak state into each other through module
 * singletons and the SQLite runtime. Sharding fixes both: each worker is a fresh
 * process, so cross-file order dependence becomes impossible rather than merely
 * unlikely, and the wall clock drops to roughly the longest shard.
 *
 * Determinism is the point. Given the same files and the same `--shards`, the
 * assignment is identical on every machine: files are sorted, then packed
 * longest-first using the recorded durations in `test-durations.json`. Nothing
 * consults wall-clock time, PIDs, or filesystem iteration order.
 *
 *   bun run test                  # sharded, deterministic, merged report
 *   bun run test --shards=1       # one process (matches plain `bun test`)
 *   bun run test src/router       # only files under a path
 *   bun run test --randomize      # shuffle within each shard, seed printed
 *   bun run test --rerun-each=3   # flake hunt
 *   bun run test --junit=out.xml  # merged JUnit for CI
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DURATIONS_PATH = join(REPO_ROOT, "scripts", "test-durations.json");
/** Weight for a file with no recorded duration: assume it is on the slow side. */
const UNKNOWN_FILE_WEIGHT_MS = 1_000;
/**
 * A per-test timeout should catch a hang, not double as a performance assertion.
 * Bun's 5s default does the latter: the heaviest gate tests really do spend ~7s
 * compiling TypeScript, so on a loaded machine they failed as `TimeoutError`
 * while passing on an idle one — the single largest source of "it passes for me"
 * disagreements. Bound the hang generously and let wall-clock cost show up in the
 * slowest-tests table instead.
 */
const DEFAULT_TEST_TIMEOUT_MS = 30_000;

interface TestCase {
  readonly suite: string;
  readonly name: string;
  readonly file: string;
  readonly line: string;
  readonly timeMs: number;
  readonly failure?: string;
}

interface ShardResult {
  readonly index: number;
  readonly files: readonly string[];
  readonly exitCode: number;
  readonly signal: string | null;
  readonly wallMs: number;
  readonly cases: readonly TestCase[];
  readonly output: string;
  readonly junit: string;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const files = discoverTestFiles(options.paths);

  if (files.length === 0) {
    console.error(`No test files matched: ${options.paths.join(", ") || "(repo)"}`);
    process.exit(1);
  }

  const shardCount = Math.max(1, Math.min(options.shards, files.length));
  const shards = packShards(files, shardCount, loadDurations());

  console.log(
    `Running ${files.length} test file${files.length === 1 ? "" : "s"} ` +
      `across ${shards.length} shard${shards.length === 1 ? "" : "s"}` +
      (options.seed === undefined ? "" : ` (seed ${options.seed})`),
  );

  const startedAt = performance.now();
  void Promise.all(shards.map((shardFiles, index) => runShard(shardFiles, index, options))).then(
    (results) => {
      const wallMs = performance.now() - startedAt;
      const failed = report(results, wallMs, shards.length);
      if (options.junitPath) writeMergedJunit(results, options.junitPath);
      if (options.writeDurations) writeDurations(results);
      process.exit(failed ? 1 : 0);
    },
  );
}

interface Options {
  readonly paths: readonly string[];
  readonly shards: number;
  readonly seed?: number;
  readonly randomize: boolean;
  readonly rerunEach?: number;
  readonly timeoutMs?: number;
  readonly bail: boolean;
  readonly junitPath?: string;
  readonly writeDurations: boolean;
  readonly testNamePattern?: string;
}

function parseOptions(argv: readonly string[]): Options {
  const paths: string[] = [];
  let shards = defaultShardCount();
  let seed: number | undefined;
  let randomize = false;
  let rerunEach: number | undefined;
  let timeoutMs: number | undefined;
  let bail = false;
  let junitPath: string | undefined;
  let writeDurations = false;
  let testNamePattern: string | undefined;

  for (const argument of argv) {
    const [flag, value] = argument.startsWith("--")
      ? (argument.split("=", 2) as [string, string | undefined])
      : ["", undefined];
    switch (flag) {
      case "--shards":
        shards = Number(value);
        break;
      case "--seed":
        seed = Number(value);
        randomize = true;
        break;
      case "--randomize":
        randomize = true;
        break;
      case "--rerun-each":
        rerunEach = Number(value);
        break;
      case "--timeout":
        timeoutMs = Number(value);
        break;
      case "--bail":
        bail = true;
        break;
      case "--junit":
        junitPath = value;
        break;
      case "--write-durations":
        writeDurations = true;
        break;
      case "-t":
      case "--test-name-pattern":
        testNamePattern = value;
        break;
      default:
        if (argument.startsWith("--")) {
          console.error(`Unknown flag: ${argument}`);
          process.exit(1);
        }
        paths.push(argument);
    }
  }

  if (randomize && seed === undefined) seed = Math.floor(Math.random() * 2 ** 31);
  return {
    paths,
    shards,
    seed,
    randomize,
    rerunEach,
    timeoutMs,
    bail,
    junitPath,
    writeDurations,
    testNamePattern,
  };
}

/**
 * Leave headroom: each worker holds its own SQLite runtime and JSC heap, and the
 * Gate-heavy files fan out to TypeScript compiler processes of their own. More than
 * two top-level shards oversubscribes common development and CI hosts, turning the
 * 30-second hang guard into an accidental load-dependent performance assertion.
 */
function defaultShardCount(): number {
  return Math.max(1, Math.min(2, availableParallelism() - 1));
}

/** Sorted so shard assignment never depends on filesystem iteration order. */
function discoverTestFiles(paths: readonly string[]): readonly string[] {
  const all = [...new Bun.Glob("**/*.test.ts").scanSync({ cwd: REPO_ROOT })]
    .filter((file) => !file.startsWith("node_modules/") && !file.startsWith("dist/"))
    .map((file) => file.split("\\").join("/"))
    .sort();
  if (paths.length === 0) return all;
  const needles = paths.map((path) => relative(REPO_ROOT, resolve(path)).split("\\").join("/"));
  return all.filter((file) => needles.some((needle) => file.startsWith(needle)));
}

function loadDurations(): Record<string, number> {
  if (!existsSync(DURATIONS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(DURATIONS_PATH, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Longest-processing-time bin packing: place the slowest file into the shard
 * that is currently cheapest. Ties break on file name, so the result depends
 * only on the inputs.
 */
function packShards(
  files: readonly string[],
  shardCount: number,
  durations: Record<string, number>,
): readonly (readonly string[])[] {
  const weighted = [...files]
    .map((file) => ({ file, weight: durations[file] ?? UNKNOWN_FILE_WEIGHT_MS }))
    .sort((left, right) => right.weight - left.weight || left.file.localeCompare(right.file));

  const buckets = Array.from({ length: shardCount }, () => ({ total: 0, files: [] as string[] }));
  for (const { file, weight } of weighted) {
    let target = buckets[0];
    for (const bucket of buckets) if (bucket.total < target.total) target = bucket;
    target.files.push(file);
    target.total += weight;
  }
  return buckets.map((bucket) => bucket.files.sort());
}

async function runShard(
  files: readonly string[],
  index: number,
  options: Options,
): Promise<ShardResult> {
  const scratch = mkdtempSync(join(tmpdir(), `omni-crud-test-shard-${index}-`));
  const junitPath = join(scratch, "results.xml");
  const argv = ["test", "--reporter=junit", `--reporter-outfile=${junitPath}`, ...files];
  if (options.randomize) argv.push("--randomize");
  if (options.seed !== undefined) argv.push(`--seed=${options.seed}`);
  if (options.rerunEach !== undefined) argv.push(`--rerun-each=${options.rerunEach}`);
  argv.push(`--timeout=${options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS}`);
  if (options.bail) argv.push("--bail");
  if (options.testNamePattern !== undefined) argv.push("-t", options.testNamePattern);

  const startedAt = performance.now();
  const { exitCode, signal, output } = await execute(argv);
  const wallMs = performance.now() - startedAt;
  const junit = existsSync(junitPath) ? readFileSync(junitPath, "utf8") : "";
  rmSync(scratch, { recursive: true, force: true });

  return { index, files, exitCode, signal, wallMs, cases: parseJunit(junit), output, junit };
}

function execute(
  argv: readonly string[],
): Promise<{ exitCode: number; signal: string | null; output: string }> {
  return new Promise((resolveExecution) => {
    const child = spawn("bun", argv, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolveExecution({ exitCode: code ?? 0, signal, output });
    });
  });
}

/**
 * Bun's JUnit output nests `<testsuite>` by describe block and emits `<testcase>`
 * either self-closing or wrapping a `<failure>`. Only those two shapes matter,
 * so a scan beats pulling in an XML parser.
 */
function parseJunit(xml: string): readonly TestCase[] {
  const cases: TestCase[] = [];
  const pattern = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const body = match[3] ?? "";
    // Bun emits a bare `<failure type="TimeoutError"/>` with no message for
    // timeouts, so fall back to the type and then to the element text rather than
    // reporting a failure with nothing said about it.
    const failure = /<(failure|error)\b/.test(body)
      ? decodeXml(
          body.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/)?.[1] ||
            body.match(/<(?:failure|error)\b[^>]*type="([^"]*)"/)?.[1] ||
            body.replace(/<[^>]+>/g, " ").trim() ||
            "failed",
        )
      : undefined;
    cases.push({
      suite: decodeXml(attribute(attributes, "classname")),
      name: decodeXml(attribute(attributes, "name")),
      file: attribute(attributes, "file"),
      line: attribute(attributes, "line"),
      timeMs: Number(attribute(attributes, "time") || 0) * 1000,
      failure,
    });
  }
  return cases;
}

function attribute(attributes: string, name: string): string {
  return attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function report(results: readonly ShardResult[], wallMs: number, shardCount: number): boolean {
  const cases = results.flatMap((result) => [...result.cases]);
  const failures = cases.filter((testCase) => testCase.failure !== undefined);
  // A worker that dies without writing JUnit (segfault, OOM) reports nothing.
  // Surfacing it as a first-class failure keeps a crash from reading as a pass.
  const crashed = results.filter(
    (result) => result.exitCode !== 0 && result.cases.every((c) => c.failure === undefined),
  );

  reportShards(results);
  reportFailures(failures);
  for (const result of crashed) reportCrash(result);
  reportSlowest(cases);

  const passed = cases.length - failures.length;
  const criticalShardMs = Math.max(...results.map((result) => result.wallMs));
  console.log("─".repeat(72));
  console.log(
    `${passed} passed  ${failures.length} failed  ${cases.length} total  ` +
      `in ${seconds(wallMs)} (slowest shard ${seconds(criticalShardMs)}, ${shardCount} shards)`,
  );

  return failures.length > 0 || crashed.length > 0;
}

function reportShards(results: readonly ShardResult[]): void {
  console.log("");
  for (const result of [...results].sort((left, right) => left.index - right.index)) {
    const failed = result.cases.filter((testCase) => testCase.failure !== undefined).length;
    const status = result.exitCode === 0 ? "ok  " : "FAIL";
    console.log(
      `  shard ${result.index}  ${status}  ${pad(result.cases.length, 4)} tests  ` +
        `${pad(failed, 3)} failed  ${seconds(result.wallMs)}  ${result.files.length} files`,
    );
  }
}

function reportFailures(failures: readonly TestCase[]): void {
  if (failures.length === 0) return;
  console.log(`\n${"─".repeat(72)}\nFailures\n`);
  for (const failure of failures) {
    console.log(`  ✗ ${failure.suite ? `${failure.suite} > ` : ""}${failure.name}`);
    console.log(`    ${failure.file}:${failure.line}`);
    if (failure.failure) console.log(`    ${failure.failure.split("\n")[0]}`);
    console.log("");
  }
}

function reportCrash(result: ShardResult): void {
  console.log(`\n${"─".repeat(72)}\nShard ${result.index} died without reporting results`);
  console.log(`  exit=${result.exitCode}${result.signal ? ` signal=${result.signal}` : ""}`);
  console.log(`  files: ${result.files.join(", ")}`);
  console.log(result.output.split("\n").slice(-25).join("\n"));
}

function reportSlowest(cases: readonly TestCase[]): void {
  const slowest = [...cases].sort((left, right) => right.timeMs - left.timeMs).slice(0, 5);
  if (slowest.length === 0 || (slowest[0]?.timeMs ?? 0) <= 250) return;
  console.log(`${"─".repeat(72)}\nSlowest tests\n`);
  for (const testCase of slowest) {
    console.log(`  ${pad(Math.round(testCase.timeMs), 6)}ms  ${testCase.name}`);
  }
  console.log("");
}

function pad(value: number, width: number): string {
  return String(value).padStart(width);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function writeMergedJunit(results: readonly ShardResult[], outputPath: string): void {
  const suites = results
    .flatMap((result) => result.junit.match(/<testsuite\b[\s\S]*?<\/testsuite>/g) ?? [])
    .join("\n");
  const cases = results.flatMap((result) => [...result.cases]);
  const failures = cases.filter((testCase) => testCase.failure !== undefined).length;
  writeFileSync(
    outputPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<testsuites name="omni-crud" tests="${cases.length}" failures="${failures}">\n` +
      `${suites}\n</testsuites>\n`,
  );
  console.log(`JUnit report written to ${outputPath}`);
}

/** Refresh the balancing weights from a real run (`--write-durations`). */
function writeDurations(results: readonly ShardResult[]): void {
  const totals: Record<string, number> = {};
  for (const result of results) {
    for (const testCase of result.cases) {
      if (!testCase.file) continue;
      totals[testCase.file] = (totals[testCase.file] ?? 0) + testCase.timeMs;
    }
    // Attribute per-shard startup to its files so single-test files that still
    // pay module-load cost are not packed as if they were free.
    const measured = result.cases.reduce((sum, testCase) => sum + testCase.timeMs, 0);
    const overhead = Math.max(0, result.wallMs - measured) / Math.max(1, result.files.length);
    for (const file of result.files) totals[file] = (totals[file] ?? 0) + overhead;
  }
  const rounded = Object.fromEntries(
    Object.entries(totals)
      .map(([file, ms]) => [file, Math.round(ms)])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
  writeFileSync(DURATIONS_PATH, `${JSON.stringify(rounded, null, 2)}\n`);
  console.log(`Balancing weights written to ${relative(REPO_ROOT, DURATIONS_PATH)}`);
}

main();
