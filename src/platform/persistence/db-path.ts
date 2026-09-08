/**
 * The single documented db-file convention (Epic 1.1, ARCH §6.3). All four platform stores —
 * registry, event log, data tables, metrics — live in this one file.
 *
 * Alone in a leaf module because `db.ts` opens the database in its module body: anything that
 * only wants to know where the file is (`bun run reset`) would otherwise create and connect to
 * one just by naming it.
 */
export const DB_PATH = "data/omni-crud.db";
