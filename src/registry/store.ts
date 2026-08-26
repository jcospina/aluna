// The capability registry access module (ARCH §6.3
// "Capability Registry", §7, PLAN decision 8).
//
// The registry is the source of truth for everything Aluna has become: one lean
// row per capability — spec + incarnation + version + artifacts pointer. Handlers, the item renderer,
// and tests are version-keyed caches derived from the spec; this table is the thing
// they are derived *from*.
//
// Access follows the platform's data access model: the insert
// rides `db`, the single constrained write path; reads default to `dbReadonly`,
// the read path on which a write is physically impossible. Both sides of the
// round-trip validate against the Zod row shape — a malformed row can neither
// enter the registry nor come back out of it unnoticed.

import type { Database } from "bun:sqlite";
import { db, dbReadonly } from "../persistence/db.ts";
import { isCapabilityIdReservedByDeletion } from "./deletion-tombstones.ts";
import {
  type CapabilityLogoState,
  capabilityLogoStateSchema,
  type LogoHueFamily,
  type LogoShade,
  type LogoStatus,
  logoHueFamilySchema,
  logoSeedSchema,
  resolveLogoShades,
} from "./logo.ts";
import {
  type CapabilityRegistryWrite,
  type CapabilityRow,
  type CapabilityTool,
  capabilityRegistryWriteSchema,
  capabilityRowSchema,
  logoSubjectSchema,
  type ReadDependency,
} from "./spec.ts";

/**
 * The registry table, created by platform migration 0002 (src/persistence/migrations.ts).
 * A fixed platform constant (never user input), so interpolating it into the
 * SQL below is safe — same convention as the migrations ledger.
 */
export const REGISTRY_TABLE = "capability_registry";

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

// The row as SQLite stores it: the structured parts (`schema`, `ui_intent`,
// `tools`, `read_dependencies`) serialized as JSON text, everything else a scalar column.
interface StoredRow {
  id: string;
  label: string;
  subject: string;
  ground: string;
  companion: string;
  noun: string;
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
}

/**
 * The columns a write supplies. The logo lifecycle pair is deliberately absent:
 * it is born at the column default and moves only through {@link claimLogoGeneration}
 * and {@link settleLogoGeneration}, so no ordinary registry write — least of all an
 * evolution CAS built from a row read seconds earlier — can roll a won claim back.
 */
const WRITE_COLUMNS =
  "id, label, subject, ground, companion, noun, incarnation_id, version, seed, schema, ui_intent, behavior, behavioral_errors, tools, read_dependencies, artifacts_path, prompt_context";

const WRITE_PLACEHOLDERS = WRITE_COLUMNS.split(", ")
  .map(() => "?")
  .join(", ");

const ROW_COLUMNS = `${WRITE_COLUMNS}, logo_status, logo_attempts`;

// Rehydrate a stored row and re-validate it. Validating on the way out too is
// deliberate: the registry drives DDL, routing, and generation, so a row that
// no longer conforms (hand-edited db, future shape drift) fails loudly at the
// read site instead of misbehaving three derivations later.
function parseStoredRow(stored: StoredRow): CapabilityRow {
  const schema = JSON.parse(stored.schema) as CapabilityRow["schema"];
  return capabilityRowSchema.parse({
    id: stored.id,
    label: stored.label,
    subject: stored.subject,
    ground: stored.ground,
    companion: stored.companion,
    noun: stored.noun,
    incarnation_id: stored.incarnation_id,
    version: stored.version,
    seed: stored.seed,
    logo: { status: stored.logo_status, attempts: stored.logo_attempts },
    schema,
    ui_intent: JSON.parse(stored.ui_intent),
    behavior: stored.behavior,
    behavioral_errors: JSON.parse(stored.behavioral_errors),
    tools: JSON.parse(stored.tools),
    read_dependencies: JSON.parse(stored.read_dependencies),
    artifacts_path: stored.artifacts_path,
    prompt_context: stored.prompt_context,
  });
}

/**
 * Insert one capability row through the read-write connection. The row is
 * validated first — an invalid row throws (ZodError) and writes nothing, which
 * is the loud failure the build's commit step leans on. A duplicate id throws
 * the primary-key violation: duplicates are the resolver's job to deflect
 * (PLAN decision 6 — no collision logic here), so reaching this is a bug.
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

  // Both branches RETURN the row they actually left behind, so the caller receives
  // the stored logo lifecycle rather than an echo of what it passed in. The update
  // sets neither the seed nor the lifecycle: both belong to the incarnation, and the
  // incarnation survives evolution unchanged.
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
             SET label = ?, subject = ?, ground = ?, companion = ?, noun = ?, incarnation_id = ?, version = ?,
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
 * What a caller may hand a write: the write shape, or a whole row it already holds.
 * A row's logo lifecycle is dropped here rather than written — writes do not own it —
 * so passing one is a convenience, never a way to set a status.
 */
export type CapabilityRegistryWriteInput = CapabilityRegistryWrite | CapabilityRow;

function validateWrite(row: CapabilityRegistryWriteInput): CapabilityRegistryWrite {
  const write: Record<string, unknown> = { ...row };
  delete write.logo;
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
 * Fetch one capability by id, or null when it doesn't exist — the router's
 * lookup for `/capability/:id/:action` (2.3). Reads ride the read-only
 * connection by convention.
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
 * List every capability — logo-layer rehydration on load and the intent resolver's
 * classification context both consume this (ARCH §6.3: the resolver scans every
 * row, which is why the row stays lean). Ordered by id so both consumers see
 * one stable, deterministic order.
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
 * Everything one generation request needs, handed back by the claim that authorized
 * it: the incarnation's stored seed, its subject, the two **resolved shades** the
 * request will carry, and the attempt this claim has just spent.
 *
 * The two colours are resolved here rather than stored, because the seed already is the
 * record of what drew the artwork: `resolveLogoShades` is pure and total over
 * (families, seed), so a retry of a capability that has no picture yet asks for exactly
 * the drawing the first attempt would have made. The authored families stay beside them
 * so a caller — the developer panel, a test — can say which hue was named and which
 * shade of it came up.
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
 * Win the right to spend one logo generation attempt, atomically.
 *
 * The claim is a single conditional UPDATE: only a row that is still `absent` moves
 * to `generating`, and the attempt counter rises in the same statement. Two desk
 * loads sweeping the same faceless capability therefore cannot both proceed — the
 * loser's `changes` is zero and it gets `null` — and the count rises when the claim
 * is *won*, before any provider is called, so a process that dies mid-request has
 * still paid for what it ordered (ADR-0007 L11).
 *
 * Binding the incarnation as well as the id is what keeps a claim from surviving a
 * delete-and-recreate: the new incarnation is a different capability's lifetime and
 * owes its own artwork.
 *
 * Returns `null` whenever the claim is not won — already claimed, already settled,
 * a tombstoned or missing row, or a different incarnation.
 */
export function claimLogoGeneration(
  capabilityId: string,
  incarnationId: string,
  database: Database = db,
): LogoGenerationClaim | null {
  // The claim and the validation of what it claimed commit together. Validating after
  // an autocommitted UPDATE would leave a row that cannot produce a valid request in
  // `generating` with its attempt already spent and no way back to `absent`.
  return database.transaction((): LogoGenerationClaim | null => {
    const claimed = database
      .query(
        `UPDATE ${REGISTRY_TABLE}
         SET logo_status = 'generating', logo_attempts = logo_attempts + 1
         WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
           AND logo_status = 'absent'
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
 * Hand a won claim back without settling it: `generating` returns to `absent` and the
 * attempt it spent stays spent. This is what a failed-but-not-final attempt does, and
 * what recovery does for a claim whose process died — without it a claim strands, since
 * only `absent` is ever claimable (ADR-0007 L11).
 *
 * How many times a capability may be re-claimed is the retry sweep's policy (PLAN
 * decision 38, epic 5.5/04). This is the transition that policy needs; the `WHERE` of
 * {@link claimLogoGeneration} is where the cap itself belongs when it arrives, because
 * that is the only place it can be enforced without a race.
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
 * Move a logo to a terminal status: `generating → present` when accepted artwork is
 * installed, and `generating → abandoned` when the attempt just spent was the last one
 * allowed. A `present` row may also be reconciled to `abandoned` — accepted artwork
 * later found missing is settled, never redrawn (ADR-0007 L7).
 *
 * Every other starting state changes nothing and returns `null`, so a late reply from
 * an attempt some other state has already superseded cannot resurrect it.
 */
export function settleLogoGeneration(
  capabilityId: string,
  incarnationId: string,
  status: Extract<LogoStatus, "present" | "abandoned">,
  database: Database = db,
): CapabilityLogoState | null {
  const settleable: LogoStatus[] =
    status === "abandoned" ? ["generating", "present"] : ["generating"];
  const settled = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET logo_status = ?
       WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'
         AND logo_status IN (${settleable.map(() => "?").join(", ")})
       RETURNING logo_status, logo_attempts`,
    )
    .get(status, capabilityId, incarnationId, ...settleable) as StoredLogoState | null;

  return settled ? toLogoState(settled) : null;
}

/**
 * One incarnation's durable logo lifecycle, or null when no active row owns it. Bound
 * to the incarnation exactly like the claim: a capability deleted and rebuilt under the
 * same id is a different lifetime owing its own artwork, so answering for the previous
 * one would let a dead lifetime's `present` be read as this one's.
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
 * Whether the registry table exists yet. False on a brand-new platform db that has
 * not run the platform migrations. The shell's on-load rehydration
 * consults this so `GET /` renders the cold-start shell *before* the first migration
 * instead of failing on a missing table; every other reader runs post-migration and
 * need not ask.
 */
export function isRegistryInitialized(database: Database = dbReadonly): boolean {
  const found = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(REGISTRY_TABLE);

  return found !== null;
}
