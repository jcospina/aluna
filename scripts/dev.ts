#!/usr/bin/env bun
/**
 * The development server runner: restart on authored-source changes only.
 *
 * `bun --watch src/index.ts` cannot be used here. Bun's watcher restarts the
 * process whenever *any* file in the module graph changes, and a capability's
 * generated Handler files under `capabilities/` enter that graph the moment the
 * router dynamically imports them (src/router/router.ts). Generated artifacts are
 * runtime data, not source, and the platform rewrites them while it is serving:
 * a build writes a new incarnation, an evolution replaces one, and permanent
 * deletion removes one outright.
 *
 * That last case was a live bug. Deleting a capability removed exactly the files
 * Bun was watching, so the watcher tore the server down *while the confirmation
 * response was still being written*. The browser saw a severed connection instead
 * of a response, HTMX therefore swapped nothing (`htmx:sendError`), and the
 * confirmation panel stayed on screen at the same URL even though the capability
 * was already permanently gone — the deletion looked like it had done nothing.
 *
 * Watching only authored source fixes that at the root: generated artifacts churn
 * as much as the platform needs without ever touching the running process.
 * `public/` is deliberately not watched — those assets are read from disk per
 * request, so a browser reload already picks up an edit.
 */

import { watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT = join(REPO_ROOT, "src", "index.ts");

/** The one authored tree the running server is compiled from. */
const WATCHED_ROOTS = [join(REPO_ROOT, "src")] as const;

/**
 * Editors write a file in several syscalls, and format-on-save can touch a handful
 * of files at once. Coalesce a burst into a single restart.
 */
const RESTART_DEBOUNCE_MS = 120;

/**
 * Only source the server actually runs should cost a restart. Test files sit in the
 * same tree but never enter the server's module graph, so editing one while the app
 * is open would otherwise bounce it for nothing.
 */
export function isRestartWorthy(path: string | null): boolean {
  if (!path) return false;
  if (path.endsWith("~") || path.endsWith(".swp") || path.includes(".DS_Store")) return false;
  if (path.includes(".test.") || path.includes(".test-support.")) return false;
  return [".ts", ".tsx", ".js", ".json"].some((extension) => path.endsWith(extension));
}

function runDevServer(): void {
  let child: Bun.Subprocess | null = null;
  let restarting: Promise<void> = Promise.resolve();
  let pendingRestart: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const start = (): void => {
    if (stopped) return;
    child = Bun.spawn(["bun", ENTRYPOINT], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
    });
  };

  const stopChild = async (): Promise<void> => {
    const running = child;
    child = null;
    if (!running) return;
    running.kill();
    await running.exited;
  };

  const scheduleRestart = (path: string | null): void => {
    if (!isRestartWorthy(path)) return;
    if (pendingRestart) clearTimeout(pendingRestart);
    pendingRestart = setTimeout(() => {
      pendingRestart = null;
      // Chain restarts so a second burst cannot spawn a server against a port the
      // previous one has not released yet.
      restarting = restarting.then(async () => {
        if (stopped) return;
        console.log(`\nomni-crud restarting (${relativeToRoot(path ?? "")})`);
        await stopChild();
        start();
      });
    }, RESTART_DEBOUNCE_MS);
  };

  for (const root of WATCHED_ROOTS) {
    watch(root, { recursive: true }, (_event, filename) => {
      scheduleRestart(filename === null ? null : join(root, filename.toString()));
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopped = true;
      void stopChild().then(() => process.exit(0));
    });
  }

  console.log(`omni-crud dev: watching ${WATCHED_ROOTS.map(relativeToRoot).join(", ")}`);
  start();
}

function relativeToRoot(path: string): string {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

if (import.meta.main) runDevServer();
