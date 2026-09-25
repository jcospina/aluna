// The capability registry access module (ARCH §6.3, §7; PLAN decision 8).
//
// The registry is the source of truth for everything Aluna has become: one lean row per
// capability — spec, incarnation, version, artifacts pointer. Handlers, the item renderer and
// tests are version-keyed caches derived from the spec; this table is what they derive from.
//
// Access follows the platform's data access model. The insert rides `db`, the single constrained
// write path; reads default to `dbReadonly`, where a write is physically impossible. Both sides
// validate against the Zod row shape, so a malformed row can neither enter the registry nor come
// back out of it unnoticed.

import type { Database } from "bun:sqlite";
import { db, dbReadonly } from "../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../platform/persistence/table-names.ts";
import { canonicalCapabilityLabel } from "../labels.ts";
import {
  type CapabilityLogoState,
  capabilityLogoStateSchema,
  LOGO_MAX_CLAIMED_ATTEMPTS,
  type LogoHueFamily,
  type LogoShade,
  type LogoStatus,
  logoHueFamilySchema,
  logoSeedSchema,
  resolveLogoShades,
} from "../logo.ts";
import {
  type CapabilityRegistryWrite,
  type CapabilityRow,
  type CapabilityTool,
  canonicalizeStoredCapabilityShape,
  capabilityRegistryWriteSchema,
  capabilityRowSchema,
  logoSubjectSchema,
  type ReadDependency,
} from "../spec/spec.ts";
import { isCapabilityIdReservedByDeletion } from "./deletion-tombstones.ts";

/**
 * The registry table, created by platform migration 0002. A fixed platform constant, never user
 * input, so interpolating it into the SQL below is safe.
 */
export { REGISTRY_TABLE } from "../../platform/persistence/table-names.ts";

export type CapabilityRegistryExpectation =
  | { readonly state: "absent" }
  | {
      readonly state: "active";
      readonly capabilityId: string;
      readonly incarnationId: string;
      readonly version: number;
    };

export class StaleCapabilityRegistryError extends Error {
  override readonly name = "StaleCapabilityRegistryError";
}

/** A new build authored an id an active capability already holds. */
export class CapabilityIdActiveError extends Error {
  override readonly name = "CapabilityIdActiveError";
  /** The name the desk shows for the capability holding the id. */
  readonly label: string;

  constructor(active: CapabilityRow) {
    super(`Capability id "${active.id}" is already held by an active capability.`);
    this.label = canonicalCapabilityLabel(active);
  }
}

// The row as SQLite stores it: the structured parts (`schema`, `ui_intent`,
// `tools`, `read_dependencies`) serialized as JSON text, everything else a scalar column.
interface StoredRow {
  id: string;
  label: string;
  subject: string;
  ground: string;
  companion: string;
  noun: string;
  plural_noun: string;
  incarnation_id: string;
  version: number;
  seed: number;
  schema: string;
  ui_intent: string;
  behavior: string;
  behavioral_errors: string;
  tools: string;
  read_dependencies: string;
  artifacts_path: string;
  prompt_context: string;
  logo_status: string;
  logo_attempts: number;
  display_label_override: string | null;
}

/**
 * The columns a write supplies. The logo lifecycle pair is absent: it moves only through
 * {@link claimLogoGeneration} and {@link settleLogoGeneration}, so no write can roll a claim back.
 */
const WRITE_COLUMNS =
  "id, label, subject, ground, companion, noun, plural_noun, incarnation_id, version, seed, schema, ui_intent, behavior, behavioral_errors, tools, read_dependencies, artifacts_path, prompt_context";

const WRITE_PLACEHOLDERS = WRITE_COLUMNS.split(", ")
  .map(() => "?")
  .join(", ");

// Everything a write supplies plus the two things it may not touch — the logo lifecycle and the
// display-label override. Both are read here and moved only by the dedicated functions below.
const ROW_COLUMNS = `${WRITE_COLUMNS}, logo_status, logo_attempts, display_label_override`;

// Rehydrate a stored row and re-validate it. The registry drives DDL, routing and generation, so a
// row that no longer conforms fails loudly at the read site rather than three derivations later.
function parseStoredRow(stored: StoredRow): CapabilityRow {
  const schema = JSON.parse(stored.schema) as CapabilityRow["schema"];
  // Rows written before a form-intent collection existed omit it; absence canonicalizes to empty
  // here rather than being backfilled, so no historical row is rewritten and no version invented.
  return capabilityRowSchema.parse(
    canonicalizeStoredCapabilityShape({
      id: stored.id,
      label: stored.label,
      subject: stored.subject,
      ground: stored.ground,
      companion: stored.companion,
      noun: stored.noun,
      plural_noun: stored.plural_noun,
      incarnation_id: stored.incarnation_id,
      version: stored.version,
      seed: stored.seed,
      logo: { status: stored.logo_status, attempts: stored.logo_attempts },
      display_label_override: stored.display_label_override,
      schema,
      ui_intent: JSON.parse(stored.ui_intent),
      behavior: stored.behavior,
      behavioral_errors: JSON.parse(stored.behavioral_errors),
      tools: JSON.parse(stored.tools),
      read_dependencies: JSON.parse(stored.read_dependencies),
      artifacts_path: stored.artifacts_path,
      prompt_context: stored.prompt_context,
    }),
  );
}

/**
 * Insert one capability row through the read-write connection. An invalid row or a duplicate id
 * throws and writes nothing.
 */
export function insertCapability(
  row: CapabilityRegistryWriteInput,
  database: Database = db,
): CapabilityRow {
  const valid = validateWrite(row);
  assertActiveReadDependencies(valid, database);
  if (isCapabilityIdReservedByDeletion(valid.id, database)) {
    throw new StaleCapabilityRegistryError(
      `Capability registry insert refused while deletion cleanup reserves ${valid.id}.`,
    );
  }

  const stored = database
    .query(
      `INSERT INTO ${REGISTRY_TABLE} (${WRITE_COLUMNS}) VALUES (${WRITE_PLACEHOLDERS})
       RETURNING ${ROW_COLUMNS}`,
    )
    .get(...storedValues(valid)) as StoredRow | null;

  if (!stored) {
    throw new Error(`Capability registry insert wrote no row for ${valid.id}.`);
  }
  return parseStoredRow(stored);
}

/**
 * Atomically install a new v1 row or replace one exact active incarnation/version.
 * A caller that classified against stale registry state changes nothing.
 */
export function compareAndSwapCapability(
  row: CapabilityRegistryWriteInput,
  expected: CapabilityRegistryExpectation,
  database: Database = db,
): CapabilityRow {
  const valid = validateWrite(row);
  assertActiveReadDependencies(valid, database);

  // Both branches RETURN the row they left behind, so the caller receives the stored logo
  // lifecycle rather than an echo. Seed, lifecycle and rename belong to the incarnation, and last.
  const stored = (
    expected.state === "absent"
      ? database
          .query(
            `INSERT INTO ${REGISTRY_TABLE} (${WRITE_COLUMNS})
             VALUES (${WRITE_PLACEHOLDERS})
             ON CONFLICT(id) DO NOTHING
             RETURNING ${ROW_COLUMNS}`,
          )
          .get(...storedValues(valid))
      : database
          .query(
            `UPDATE ${REGISTRY_TABLE}
             SET label = ?, subject = ?, ground = ?, companion = ?, noun = ?, plural_noun = ?,
                 incarnation_id = ?, version = ?,
                 schema = ?, ui_intent = ?, behavior = ?, behavioral_errors = ?, tools = ?,
                 read_dependencies = ?, artifacts_path = ?, prompt_context = ?
             WHERE id = ? AND incarnation_id = ? AND version = ?
               AND lifecycle_state = 'active'
             RETURNING ${ROW_COLUMNS}`,
          )
          .get(
            valid.label,
            valid.subject,
            valid.ground,
            valid.companion,
            valid.noun,
            valid.plural_noun,
            valid.incarnation_id,
            valid.version,
            JSON.stringify(valid.schema),
            JSON.stringify(valid.ui_intent),
            valid.behavior,
            JSON.stringify(valid.behavioral_errors),
            JSON.stringify(valid.tools),
            JSON.stringify(valid.read_dependencies),
            valid.artifacts_path,
            valid.prompt_context,
            expected.capabilityId,
            expected.incarnationId,
            expected.version,
          )
  ) as StoredRow | null;

  if (!stored) {
    const target =
      expected.state === "absent"
        ? `${valid.id} expected absent`
        : `${expected.capabilityId}/${expected.incarnationId}@v${expected.version}`;
    throw new StaleCapabilityRegistryError(`Capability registry CAS failed: ${target}.`);
  }
  return parseStoredRow(stored);
}

/**
 * Move one capability's display-label override, and nothing else. Bound to the exact incarnation
 * and version the menu opened on: a recreated or evolved capability comes back `null`, a refusal.
 *
 * @returns the row as it now stands, or `null` when no active row matched.
 */
export function renameCapability(
  expectation: {
    readonly capabilityId: string;
    readonly incarnationId: string;
    readonly version: number;
    /**
     * A rename does not bump the version, so the version alone cannot tell two renames apart: two
     * menus opened on one version both matched, and the second overwrote the first, silently.
     */
    readonly previousOverride: string | null;
  },
  override: string | null,
  database: Database = db,
): CapabilityRow | null {
  // `IS` rather than `=`, because the expected previous override is `null` for a
  // capability that has never been renamed and SQL equality is never true of null.
  const stored = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET display_label_override = ?
       WHERE id = ? AND incarnation_id = ? AND version = ?
         AND display_label_override IS ?
         AND lifecycle_state = 'active'
       RETURNING ${ROW_COLUMNS}`,
    )
    .get(
      override,
      expectation.capabilityId,
      expectation.incarnationId,
      expectation.version,
      expectation.previousOverride,
    ) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
}

/**
 * The write shape, or a whole row a caller already holds. A row's logo lifecycle is dropped rather
 * than written, so passing one is a convenience and never a way to set a status.
 */
export type CapabilityRegistryWriteInput = CapabilityRegistryWrite | CapabilityRow;

function validateWrite(row: CapabilityRegistryWriteInput): CapabilityRegistryWrite {
  const write: Record<string, unknown> = { ...row };
  delete write.logo;
  delete write.display_label_override;
  return capabilityRegistryWriteSchema.parse(write);
}

function storedValues(row: CapabilityRegistryWrite): (string | number)[] {
  return [
    row.id,
    row.label,
    row.subject,
    row.ground,
    row.companion,
    row.noun,
    row.plural_noun,
    row.incarnation_id,
    row.version,
    row.seed,
    JSON.stringify(row.schema),
    JSON.stringify(row.ui_intent),
    row.behavior,
    JSON.stringify(row.behavioral_errors),
    JSON.stringify(row.tools),
    JSON.stringify(row.read_dependencies),
    row.artifacts_path,
    row.prompt_context,
  ];
}

/** Resolve one Action's exact committed dependency catalog or fail closed. */
export function resolveActionReadDependencies(
  row: CapabilityRow,
  action: CapabilityTool,
  database: Database = dbReadonly,
): CapabilityRow[] {
  const dependencies: readonly ReadDependency[] = row.read_dependencies[action];
  return dependencies.map((dependency) => resolveActiveDependency(dependency, database));
}

/** Reverse dependency lookup consumed by capability deletion in epic 4.9. */
export function listCapabilityDependents(
  target: Pick<CapabilityRow, "id" | "incarnation_id">,
  database: Database = dbReadonly,
): CapabilityRow[] {
  return listCapabilities(database).filter((candidate) =>
    Object.values(candidate.read_dependencies)
      .flat()
      .some(
        (dependency) =>
          dependency.capability_id === target.id &&
          dependency.incarnation_id === target.incarnation_id,
      ),
  );
}

function assertActiveReadDependencies(
  row: Pick<CapabilityRow, "read_dependencies">,
  database: Database,
): void {
  for (const dependency of Object.values(row.read_dependencies).flat()) {
    resolveActiveDependency(dependency, database);
  }
}

function resolveActiveDependency(dependency: ReadDependency, database: Database): CapabilityRow {
  const row = getCapability(dependency.capability_id, database);
  if (!row || row.incarnation_id !== dependency.incarnation_id) {
    throw new Error(
      `Read dependency ${dependency.capability_id}/${dependency.incarnation_id} does not resolve to one active registry row.`,
    );
  }
  return row;
}

/**
 * Fetch one capability by id, or null — the router's lookup for `/capability/:id/:action` (2.3).
 * Reads ride the read-only connection by convention.
 */
export function getCapability(id: string, database: Database = dbReadonly): CapabilityRow | null {
  const stored = database
    .query(
      `SELECT ${ROW_COLUMNS} FROM ${REGISTRY_TABLE}
       WHERE id = ? AND lifecycle_state = 'active'`,
    )
    .get(id) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
}

/**
 * Whether a new capability may take this id. The activation insert conflicts with any row holding
 * it, so an active capability and a deletion tombstone both make it unavailable.
 */
export function isCapabilityIdAvailable(id: string, database: Database = dbReadonly): boolean {
  return database.query(`SELECT 1 FROM ${REGISTRY_TABLE} WHERE id = ?`).get(id) === null;
}

/**
 * The active registry as a read gate takes it, one identity per capability: the catalog every
 * token that reads a single incarnation is acquired against. It reads no spec, since
 * {@link listCapabilities} re-parses every row — a cost a cold desk paid once per tile.
 */
export function readActiveIncarnationCatalog(
  database: Database,
): { readonly capabilityId: string; readonly incarnationId: string }[] {
  return database
    .query(
      `SELECT id AS capabilityId, incarnation_id AS incarnationId FROM ${REGISTRY_TABLE}
       WHERE lifecycle_state = 'active'
       ORDER BY id`,
    )
    .all() as { capabilityId: string; incarnationId: string }[];
}

/**
 * List every capability — the logo layer and the intent resolver both consume this (ARCH §6.3: the
 * resolver scans every row, which is why the row stays lean). Ordered by id, deterministically.
 */
export function listCapabilities(database: Database = dbReadonly): CapabilityRow[] {
  const stored = database
    .query(
      `SELECT ${ROW_COLUMNS} FROM ${REGISTRY_TABLE}
       WHERE lifecycle_state = 'active'
       ORDER BY id`,
    )
    .all() as StoredRow[];

  return stored.map(parseStoredRow);
}

/**
 * Everything one generation request needs, handed back by the claim that authorized it. The
 * colours are resolved here rather than stored: the seed already records what drew the artwork.
 */
export interface LogoGenerationClaim {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly subject: string;
  readonly groundFamily: LogoHueFamily;
  readonly companionFamily: LogoHueFamily;
  readonly ground: LogoShade;
  readonly companion: LogoShade;
  readonly seed: number;
  readonly attempts: number;
}

interface StoredLogoState {
  logo_status: string;
  logo_attempts: number;
}

/**
 * Win the right to spend one logo generation attempt: one conditional UPDATE, carrying the cap
 * ({@link LOGO_MAX_CLAIMED_ATTEMPTS}) so a process that dies has paid for what it ordered (L11).
 */
export function claimLogoGeneration(
  capabilityId: string,
  incarnationId: string,
  database: Database = db,
): LogoGenerationClaim | null {
  // The claim and the validation of what it claimed commit together, or an invalid row strands in
  // `generating` with its attempt already spent and no way back to `absent`.
  return database.transaction((): LogoGenerationClaim | null => {
    const claimed = database
      .query(
        `UPDATE ${REGISTRY_TABLE}
         SET logo_status = 'generating', logo_attempts = logo_attempts + 1
         WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
           AND logo_status = 'absent' AND logo_attempts < ${LOGO_MAX_CLAIMED_ATTEMPTS}
         RETURNING subject, ground, companion, seed, logo_attempts`,
      )
      .get(capabilityId, incarnationId) as {
      subject: unknown;
      ground: unknown;
      companion: unknown;
      seed: unknown;
      logo_attempts: number;
    } | null;

    if (!claimed) return null;

    const groundFamily = logoHueFamilySchema.parse(claimed.ground);
    const companionFamily = logoHueFamilySchema.parse(claimed.companion);
    const seed = logoSeedSchema.parse(claimed.seed);
    const [ground, companion] = resolveLogoShades(groundFamily, companionFamily, seed);

    return {
      capabilityId,
      incarnationId,
      subject: logoSubjectSchema.parse(claimed.subject),
      groundFamily,
      companionFamily,
      ground,
      companion,
      seed,
      attempts: claimed.logo_attempts,
    };
  })();
}

/**
 * Hand a won claim back without settling it: `generating` returns to `absent` and the attempt it
 * spent stays spent. The cap is not decided here — {@link claimLogoGeneration}'s `WHERE` is (L11).
 */
export function releaseLogoClaim(
  capabilityId: string,
  incarnationId: string,
  database: Database = db,
): CapabilityLogoState | null {
  const released = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET logo_status = 'absent'
       WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
         AND logo_status = 'generating'
       RETURNING logo_status, logo_attempts`,
    )
    .get(capabilityId, incarnationId) as StoredLogoState | null;

  return released ? toLogoState(released) : null;
}

/**
 * Close a won claim: `generating → present`, or `→ abandoned` on the last allowed attempt. Only
 * from `generating`, so a late reply cannot resurrect it ({@link abandonMissingCapabilityLogo}).
 */
export function settleLogoGeneration(
  capabilityId: string,
  incarnationId: string,
  status: Extract<LogoStatus, "present" | "abandoned">,
  database: Database = db,
): CapabilityLogoState | null {
  const settled = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET logo_status = ?
       WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
         AND logo_status = 'generating'
       RETURNING logo_status, logo_attempts`,
    )
    .get(status, capabilityId, incarnationId) as StoredLogoState | null;

  return settled ? toLogoState(settled) : null;
}

/**
 * Reconcile a `present` row whose artwork has gone: it wears the placeholder and is never redrawn
 * (ADR-0007 L7). Bound to `present` alone, and reached only from desk-load recovery.
 */
export function abandonMissingCapabilityLogo(
  capabilityId: string,
  incarnationId: string,
  database: Database = db,
): CapabilityLogoState | null {
  const abandoned = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET logo_status = 'abandoned'
       WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
         AND logo_status = 'present'
       RETURNING logo_status, logo_attempts`,
    )
    .get(capabilityId, incarnationId) as StoredLogoState | null;

  return abandoned ? toLogoState(abandoned) : null;
}

/**
 * One incarnation's durable logo lifecycle, or null. Bound to the incarnation like the claim: a
 * capability rebuilt under the same id is a different lifetime owing its own artwork.
 */
export function getCapabilityLogoState(
  capabilityId: string,
  incarnationId: string,
  database: Database = dbReadonly,
): CapabilityLogoState | null {
  const stored = database
    .query(
      `SELECT logo_status, logo_attempts FROM ${REGISTRY_TABLE}
       WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'`,
    )
    .get(capabilityId, incarnationId) as StoredLogoState | null;

  return stored ? toLogoState(stored) : null;
}

function toLogoState(stored: StoredLogoState): CapabilityLogoState {
  return capabilityLogoStateSchema.parse({
    status: stored.logo_status,
    attempts: stored.logo_attempts,
  });
}

/**
 * Whether the registry table exists yet. The shell's on-load rehydration consults this so `GET /`
 * renders the cold-start shell before the first migration instead of failing on a missing table.
 */
export function isRegistryInitialized(database: Database = dbReadonly): boolean {
  const found = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(REGISTRY_TABLE);

  return found !== null;
}
