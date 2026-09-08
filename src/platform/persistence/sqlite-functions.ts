import { dlopen, JSCallback, type Library, ptr, suffix, toArrayBuffer } from "bun:ffi";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const EXTENSION_ENTRY_POINT = "sqlite3_platformnormalize_init";
const UNICODE_MARK = /^\p{M}$/u;
const UNICODE_DIACRITIC = /^\p{Diacritic}$/u;
const LATIN_SCRIPT = /^\p{Script=Latin}$/u;
const EXTENSION_SOURCE = `
#include <sqlite3ext.h>
SQLITE_EXTENSION_INIT1

typedef const char *(*normalize_callback)(const char *, int);
static normalize_callback callback = 0;

#if defined(_WIN32)
#define OMNI_EXPORT __declspec(dllexport)
#else
#define OMNI_EXPORT __attribute__((visibility("default")))
#endif

OMNI_EXPORT void set_normalizer_callback(void *fn) {
  callback = (normalize_callback)fn;
}

static void platform_search_normalize(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
) {
  if (argc != 1 || sqlite3_value_type(argv[0]) == SQLITE_NULL) {
    sqlite3_result_null(context);
    return;
  }
  if (!callback) {
    sqlite3_result_error(context, "platform normalizer callback is not registered", -1);
    return;
  }

  const unsigned char *input = sqlite3_value_text(argv[0]);
  const char *output = callback((const char *)input, sqlite3_value_bytes(argv[0]));
  sqlite3_result_text(context, output, -1, SQLITE_TRANSIENT);
}

OMNI_EXPORT int sqlite3_platformnormalize_init(
  sqlite3 *database,
  char **error,
  const sqlite3_api_routines *api
) {
  (void)error;
  SQLITE_EXTENSION_INIT2(api);
  return sqlite3_create_function_v2(
    database,
    "platform_search_normalize",
    1,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC,
    0,
    platform_search_normalize,
    0,
    0,
    0
  );
}
`;

const registeredDatabases = new WeakSet<Database>();
let runtimeConfigured = false;
let sqliteLibraryPath: string | undefined;
let nativeBridge: NativeBridge | undefined;
let callbackOutput = Buffer.from([0]);

type NativeBridge = {
  readonly path: string;
  readonly callback: JSCallback;
  readonly library: Library<{
    readonly set_normalizer_callback: {
      readonly args: readonly ["ptr"];
      readonly returns: "void";
    };
  }>;
};

/**
 * Bun's macOS SQLite is Apple's extension-disabled build, so point Bun at the conventional
 * Homebrew SQLite before the first connection opens and the scalar function can register on it.
 */
export function configureSqliteRuntime(): void {
  if (runtimeConfigured) return;
  if (process.platform === "darwin") {
    const configured = process.env.OMNI_CRUD_SQLITE_LIBRARY;
    const candidates = [
      configured,
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    ].filter((candidate): candidate is string => Boolean(candidate));
    const library = candidates.find(existsSync);
    if (!library) {
      throw new Error(
        "Search normalization requires extension-capable SQLite. Install Homebrew sqlite or set OMNI_CRUD_SQLITE_LIBRARY to libsqlite3.dylib.",
      );
    }
    Database.setCustomSQLite(library);
    sqliteLibraryPath = library;
  }
  runtimeConfigured = true;
}

/** Register the single platform search normalizer on a SQLite connection. */
export function registerPlatformSqlFunctions(database: Database): void {
  if (registeredDatabases.has(database)) return;
  assertExtensionAbiMatchesRuntime(database);
  const bridge = ensureNativeBridge();
  database.loadExtension(bridge.path, EXTENSION_ENTRY_POINT);
  registeredDatabases.add(database);
}

/**
 * Compile against one SQLite and load into another and `sqlite3_create_function_v2` lands on a
 * null pointer: the process dies with "Segmentation fault at address 0x0" rather than throwing.
 * So every way of not knowing the ABI refuses instead of skipping. Only one platform pins a
 * library, and where nothing is pinned the headers and the library are one install.
 */
function assertExtensionAbiMatchesRuntime(database: Database): void {
  if (!sqliteLibraryPath) {
    if (process.platform !== "darwin") return;
    throw new Error(
      "Cannot register the SQLite search extension: the pinned libsqlite3 is unnamed on this " +
        "thread — configureSqliteRuntime() was never called here, or it threw before recording " +
        "the path — so the ABI the extension would compile against cannot be checked.",
    );
  }
  const includeDirectory = resolveSqliteIncludeDirectory();
  const headerVersion = includeDirectory ? readHeaderVersion(includeDirectory) : undefined;
  if (!headerVersion) {
    throw new Error(
      `SQLite ABI unknown: ${sqliteLibraryPath} is pinned, but no readable sqlite3ext.h and ` +
        "sqlite3.h sit beside it, so the extension would compile against this platform's default " +
        "headers and segfault whenever they disagree with the loaded library. Point " +
        "OMNI_CRUD_SQLITE_LIBRARY at a libsqlite3 whose matching headers are installed alongside it.",
    );
  }
  const runtimeVersion = (
    database.query("select sqlite_version() as version").get() as { version: string }
  ).version;
  if (headerVersion === runtimeVersion) return;
  throw new Error(
    `SQLite ABI mismatch: the search extension would be compiled against ${headerVersion} ` +
      `(headers in ${includeDirectory}) but the loaded library reports ${runtimeVersion}. ` +
      "Point OMNI_CRUD_SQLITE_LIBRARY at a libsqlite3 whose matching headers are installed alongside it.",
  );
}

export function normalizeSearchText(value: string): string {
  const decomposed = value.normalize("NFKD").toLocaleLowerCase("und");
  let folded = "";
  let followsLatinBase = false;

  for (const character of decomposed) {
    if (UNICODE_MARK.test(character)) {
      if (!(followsLatinBase && UNICODE_DIACRITIC.test(character))) folded += character;
      continue;
    }
    folded += character;
    followsLatinBase = LATIN_SCRIPT.test(character);
  }

  return folded.normalize("NFKC");
}

function ensureNativeBridge(): NativeBridge {
  if (nativeBridge) return nativeBridge;
  const extensionPath = compileExtension();
  const callback = new JSCallback(
    (input, length) => {
      // SQLite may represent an empty TEXT value as a null pointer with zero length, and Bun's
      // `toArrayBuffer(null, 0, 0)` returns no decodable buffer for one.
      const value = length === 0 ? "" : new TextDecoder().decode(toArrayBuffer(input, 0, length));
      callbackOutput = Buffer.from(`${normalizeSearchText(value)}\0`);
      return ptr(callbackOutput);
    },
    { args: ["ptr", "i32"], returns: "ptr" },
  );
  if (!callback.ptr) throw new Error("Could not allocate the SQLite normalizer callback.");
  const library = dlopen(extensionPath, {
    set_normalizer_callback: { args: ["ptr"], returns: "void" },
  });
  library.symbols.set_normalizer_callback(callback.ptr);
  nativeBridge = { path: extensionPath, callback, library };
  return nativeBridge;
}

/**
 * An extension reaches its host through `sqlite3_api_routines`, whose layout grows each release.
 * The macOS default include path is Apple's SDK; `configureSqliteRuntime` loads Homebrew's.
 */
function resolveSqliteIncludeDirectory(): string | undefined {
  if (!sqliteLibraryPath) return undefined;
  // /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib -> /opt/homebrew/opt/sqlite/include
  const includeDirectory = join(dirname(dirname(sqliteLibraryPath)), "include");
  return existsSync(join(includeDirectory, "sqlite3ext.h")) ? includeDirectory : undefined;
}

/** The `SQLITE_VERSION` the given include directory would compile against. */
function readHeaderVersion(includeDirectory: string): string | undefined {
  const header = join(includeDirectory, "sqlite3.h");
  if (!existsSync(header)) return undefined;
  return readFileSync(header, "utf8").match(/#define\s+SQLITE_VERSION\s+"([^"]+)"/)?.[1];
}

function compileExtension(): string {
  const includeDirectory = resolveSqliteIncludeDirectory();
  const headerVersion = includeDirectory ? readHeaderVersion(includeDirectory) : undefined;
  // The ABI depends on the headers as much as on the source, so both feed the cache key: a stale
  // artifact compiled against the wrong SQLite would otherwise be reused after the fix.
  const hash = createHash("sha256")
    .update(EXTENSION_SOURCE)
    .update(includeDirectory ?? "default-include")
    .update(headerVersion ?? "unknown-version")
    .digest("hex")
    .slice(0, 16);
  const basename = `omni-crud-platform-normalize-${process.platform}-${process.arch}-${hash}`;
  const sourcePath = join(tmpdir(), `${basename}.c`);
  const extensionPath = join(tmpdir(), `${basename}.${suffix}`);
  if (existsSync(extensionPath)) return extensionPath;
  writeFileSync(sourcePath, EXTENSION_SOURCE);

  const platformArguments =
    process.platform === "darwin"
      ? ["-dynamiclib", "-fPIC", "-undefined", "dynamic_lookup"]
      : ["-shared", "-fPIC"];
  const compilation = Bun.spawnSync([
    process.env.CC ?? "cc",
    ...platformArguments,
    ...(includeDirectory ? ["-I", includeDirectory] : []),
    sourcePath,
    "-o",
    extensionPath,
  ]);
  if (compilation.exitCode !== 0) {
    throw new Error(
      `Could not compile the SQLite normalizer extension: ${compilation.stderr.toString().trim()}`,
    );
  }
  return extensionPath;
}
