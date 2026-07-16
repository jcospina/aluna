import { dlopen, JSCallback, type Library, ptr, suffix, toArrayBuffer } from "bun:ffi";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SEARCH_NORMALIZE_SQL_FUNCTION = "platform_search_normalize";

const EXTENSION_ENTRY_POINT = "sqlite3_platformnormalize_init";
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
 * Bun's macOS SQLite is Apple's extension-disabled build. Point Bun at the
 * conventional Homebrew SQLite before the first connection is opened so the
 * platform-owned scalar function can be registered on every query connection.
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
  }
  runtimeConfigured = true;
}

/** Register the single platform search normalizer on a SQLite connection. */
export function registerPlatformSqlFunctions(database: Database): void {
  if (registeredDatabases.has(database)) return;
  const bridge = ensureNativeBridge();
  database.loadExtension(bridge.path, EXTENSION_ENTRY_POINT);
  registeredDatabases.add(database);
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function ensureNativeBridge(): NativeBridge {
  if (nativeBridge) return nativeBridge;
  const extensionPath = compileExtension();
  const callback = new JSCallback(
    (input, length) => {
      const value = new TextDecoder().decode(toArrayBuffer(input, 0, length));
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

function compileExtension(): string {
  const hash = createHash("sha256").update(EXTENSION_SOURCE).digest("hex").slice(0, 16);
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
