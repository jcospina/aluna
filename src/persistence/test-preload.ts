// Test preload — pins the SQLite runtime and seals the network before any test
// file is evaluated.
//
// `configureSqliteRuntime()` must run before the process opens its first SQLite
// connection (Bun's macOS SQLite is Apple's extension-disabled build, so the
// platform points Bun at Homebrew's before anything connects). Only `db.ts`
// called it, at module scope, which made the invariant depend on which test file
// bun happened to evaluate first: a file that opens its own `new Database(...)`
// without importing `db.ts` would load the default build first, and the later
// `setCustomSQLite` would throw `SQLite already loaded` — aborting `db.ts` and
// leaving every importer with `db` in the temporal dead zone.
//
// Preloading makes the ordering explicit instead of alphabetical luck.

import { configureSqliteRuntime } from "./sqlite-functions.ts";

configureSqliteRuntime();

// A test that reaches the network is both a cost (the AI provider bills per call)
// and the largest single source of environment-dependent results. Every test
// drives the Builder through fake providers, so an outbound request means a fake
// was missed — fail it loudly at the call site instead of letting it spend money
// or flake in CI. Loopback stays open for tests that bind a local server.
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
