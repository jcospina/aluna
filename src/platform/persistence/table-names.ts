// Every platform-owned table name, and the prefix a generated capability's table carries.
//
// Alone in a leaf because the modules that own these tables open the database in their module
// bodies. Anything that only needs to know what a table is called — `bun run reset`, a migration
// — would otherwise connect to the platform just by naming one. Each owning module re-exports
// its own name, so the name and the machinery still read together where they are used.

export const REGISTRY_TABLE = "capability_registry";
export const GENERATION_METRICS_TABLE = "generation_metrics";
export const GENERATION_LIFECYCLE_TABLE = "generation_lifecycle_metrics";
export const INTENT_RESOLUTION_METRICS_TABLE = "intent_resolution_metrics";
export const EVENT_LOG_TABLE = "event_log";
export const EVENT_LOG_OWNERSHIP_TABLE = "event_log_ownership";

/** Every generated capability's data table is `cap_<id>`; nothing else in the file carries it. */
export const CAPABILITY_TABLE_PREFIX = "cap_";

/**
 * The object store's local root. No module owns it yet — M7 builds the store — so it is named
 * here beside the tables rather than in whichever script happens to sweep it.
 */
export const OBJECT_STORE_ROOT = "storage";
