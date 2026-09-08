// Test preload — pins the SQLite runtime and seals the network before any test file is
// evaluated.
//
// `configureSqliteRuntime` must run before the process opens its first SQLite connection (Bun's
// macOS SQLite is Apple's extension-disabled build, so the platform points Bun at Homebrew's).
// Only `db.ts` called it, at module scope, which made the invariant depend on which test file
// bun happened to evaluate first: a file that opens its own `new Database(...)` without
// importing `db.ts` loads the default build, and the later `setCustomSQLite` throws
// `SQLite already loaded` — aborting `db.ts` and leaving every importer in the dead zone.

import { configureSqliteRuntime } from "./sqlite-functions.ts";

configureSqliteRuntime();

// Every test drives the Builder through fake providers, so an outbound request means a fake was
// missed: it bills per call and makes results depend on the environment. Loopback stays open.
const realFetch = globalThis.fetch;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

globalThis.fetch = ((input: Parameters<typeof realFetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // A relative or otherwise non-absolute URL never leaves the process.
    return realFetch(input, init);
  }
  if (LOOPBACK_HOSTS.has(hostname)) return realFetch(input, init);
  throw new Error(
    `Blocked a network request to ${hostname} from the test suite. Tests must run ` +
      "against fakes — a real request costs money and makes results depend on the " +
      "environment. Inject a fake provider or stub the transport instead.",
  );
}) as typeof realFetch;
