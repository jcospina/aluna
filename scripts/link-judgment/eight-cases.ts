#!/usr/bin/env bun
// The eight-case set, run by hand and only with the owner's approval at the time. Without --spend
// it rehearses: every desk loads, the prompts render, the provider is configured, and nothing is
// sent. With it, the cases run one after another, the first failed call ends the pass so no later
// case spends on the same fault, and every line lands in a file under passes/ as well as on the
// terminal, so a closed terminal loses nothing that was paid for.
//
// Every platform root moves to scratch before anything that reads one loads: `db.ts` opens its
// file on import, and that file defaults to the owner's corpus. Hence the dynamic imports below.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ARTIFACTS_ROOT_ENV_VAR,
  DEFAULT_ARTIFACTS_ROOT,
} from "../../src/builder/artifacts/artifacts-root.ts";
import { errorMessage } from "../../src/platform/errors.ts";
import {
  OBJECT_STORE_ROOT,
  OBJECT_STORE_ROOT_ENV_VAR,
} from "../../src/platform/files/store/object-store-root.ts";
import { DB_PATH, DB_PATH_ENV_VAR } from "../../src/platform/persistence/db-path.ts";
import type { Provider } from "../../src/platform/provider/index.ts";
import { EIGHT_CASES, type EightCase, STAGES } from "./cases.ts";
import type { CaseResult, CaseWatch, Stage } from "./pass.ts";

const SCRIPT = "bun scripts/link-judgment/eight-cases.ts";

const USAGE = [
  `Usage: ${SCRIPT} [--spend] [--case N[,N...]]`,
  "  (no --spend)   rehearse the selected cases and send nothing",
  `  --spend        make the calls, at most ${STAGES.length} per case`,
  `  --case         run only these cases, 1 to ${EIGHT_CASES.length}; all of them by default`,
].join("\n");

interface Invocation {
  readonly spend: boolean;
  readonly cases: readonly EightCase[];
}

function casesNamed(values: readonly string[]): readonly EightCase[] {
  const numbers = new Set<number>();
  for (const text of values.flatMap((value) => value.split(",")).map((each) => each.trim())) {
    const known = /^\d+$/.test(text) && EIGHT_CASES.find(({ number }) => number === Number(text));
    if (!known) throw new Error(`There is no case "${text}".`);
    numbers.add(known.number);
  }
  return EIGHT_CASES.filter(({ number }) => numbers.has(number));
}

function invocation(): Invocation {
  const { values } = parseArgs({
    options: {
      spend: { type: "boolean", default: false },
      case: { type: "string", multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });
  return { spend: values.spend, cases: values.case ? casesNamed(values.case) : EIGHT_CASES };
}

let invoked: Invocation;
try {
  invoked = invocation();
} catch (error) {
  console.error(`${errorMessage(error)}\n\n${USAGE}`);
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "omni-crud-eight-cases-"));
process.env[DB_PATH_ENV_VAR] = join(scratch, DB_PATH);
process.env[ARTIFACTS_ROOT_ENV_VAR] = join(scratch, DEFAULT_ARTIFACTS_ROOT);
process.env[OBJECT_STORE_ROOT_ENV_VAR] = join(scratch, OBJECT_STORE_ROOT);
const removeScratch = () => rmSync(scratch, { recursive: true, force: true });

let record: (text: string) => void = () => {};
/** Starts the pass's record. A write that fails says so once and leaves the terminal alone. */
function startRecord(): string {
  const directory = join(import.meta.dir, "passes");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${new Date().toISOString().replaceAll(":", "-")}.txt`);
  record = (text) => {
    try {
      appendFileSync(file, `${text}\n`);
    } catch (error) {
      record = () => {};
      console.error(`The record ${file} stopped: ${errorMessage(error)}`);
    }
  };
  return file;
}
const say = (text: string) => {
  console.log(text);
  record(text);
};
const warn = (text: string) => {
  console.error(text);
  record(text);
};

let reportInterruption: (signal: string) => void = () => {};
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
let interrupted = false;
for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = true;
    try {
      reportInterruption(signal);
    } finally {
      removeScratch();
      process.exit(code);
    }
  });
}

const rerunFrom = (cases: readonly EightCase[], first: number) =>
  `${SCRIPT} --spend --case ${cases
    .map(({ number }) => number)
    .filter((number) => number >= first)
    .join(",")}`;

async function spendPass(cases: readonly EightCase[], provider: Provider): Promise<number> {
  const { runCase } = await import("./pass.ts");
  const { caseBlock, failedWhere, resultsTable } = await import("./report.ts");
  const results: CaseResult[] = [];
  let running:
    | { readonly eightCase: EightCase; readonly watch: CaseWatch; stage?: Stage }
    | undefined;
  reportInterruption = (signal) => {
    const now = running;
    if (!now) return say(`\n${resultsTable(results)}\n`);
    const during = now.stage ? `during its ${now.stage} call` : "before its first call";
    const partial = now.watch.partial?.(`${signal} stopped it ${during}`);
    if (partial) say(`\n${caseBlock(partial)}\n`);
    say(`${resultsTable(partial ? [...results, partial] : results)}\n`);
    const unpaid = now.stage ? "; that call's tokens are not in the total" : "";
    warn(
      `${signal} stopped case ${now.eightCase.number} ${during}${unpaid}. To run it and the ` +
        `cases after it: ${rerunFrom(cases, now.eightCase.number)}`,
    );
  };
  for (const eightCase of cases) {
    const watch: CaseWatch = {
      onCall: (stage) => {
        if (running) running.stage = stage;
        say(`  waiting on the ${stage}…`);
      },
    };
    running = { eightCase, watch };
    say(`Running case ${eightCase.number}…`);
    const result = await runCase(eightCase, provider, scratch, watch);
    results.push(result);
    running = undefined;
    say(`${caseBlock(result)}\n`);
    if (result.failure) break;
  }
  say(`${resultsTable(results)}\n`);
  const last = results.at(-1);
  if (!last?.failure) return 0;
  const at = last.eightCase.number;
  const later = cases.some(({ number }) => number > at)
    ? ", so no later case spent on the same fault. To run it and the cases after it: "
    : ". To run it again: ";
  warn(
    `The pass stopped at case ${at}, where ${failedWhere(last.failure.stage)} failed${later}` +
      rerunFrom(cases, at),
  );
  return 1;
}

async function main({ spend, cases }: Invocation): Promise<number> {
  const { rehearse } = await import("./pass.ts");
  const { planText } = await import("./report.ts");
  const { createProvider, resolveProviderConfig } = await import(
    "../../src/platform/provider/index.ts"
  );
  const { db } = await import("../../src/platform/persistence/db.ts");
  if (!db.filename.startsWith(scratch)) {
    throw new Error(
      `The platform database opened ${db.filename}, outside scratch. Nothing was sent.`,
    );
  }
  const rehearsed = rehearse(cases, scratch);
  let config: ReturnType<typeof resolveProviderConfig>;
  try {
    config = resolveProviderConfig();
  } catch (error) {
    console.log(planText(rehearsed, null));
    console.error(`Not ready, and nothing was sent: ${errorMessage(error)}`);
    return 1;
  }
  const plan = planText(rehearsed, `${config.model} at ${config.baseURL}`);
  if (!spend) {
    console.log(`${plan}\nRehearsal only: nothing was sent. Add --spend to make the calls.`);
    return 0;
  }
  const file = startRecord();
  say(`${plan}\nThis pass is recorded in ${file}\n`);
  return spendPass(cases, createProvider());
}

let code = 1;
try {
  code = await main(invoked);
} catch (error) {
  warn(`The eight-case script failed: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  removeScratch();
}
process.exit(code);
