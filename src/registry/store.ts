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
  LOGO_MAX_CLAIMED_ATTEMPTS,
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
  canonicalizeStoredCapabilityShape,
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
  display_label_override: string | null;
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

// Everything a write supplies plus the two things it may not touch: the logo lifecycle,
// and the platform's own display-label override. Both are read here and moved only by the
// dedicated functions below.
const ROW_COLUMNS = `${WRITE_COLUMNS}, logo_status, logo_attempts, display_label_override`;

// Rehydrate a stored row and re-validate it. Validating on the way out too is
// deliberate: the registry drives DDL, routing, and generation, so a row that
// no longer conforms (hand-edited db, future shape drift) fails loudly at the
// read site instead of misbehaving three derivations later.
function parseStoredRow(stored: StoredRow): CapabilityRow {
  const schema = JSON.parse(stored.schema) as CapabilityRow["schema"];
  // Rows written before a form-intent collection existed omit it; absence canonicalizes
  // to empty here rather than being backfilled into storage, so no historical row is
  // rewritten and no version is manufactured.
  return capabilityRowSchema.parse(
    canonicalizeStoredCapabilityShape({
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
  // incarnation survives evolution unchanged. It does not set the display-label override
  // either, and for the same reason — a rename belongs to the capability the user has on
  // their desk, not to the version an evolution is replacing, so it survives one.
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
 * Move one capability's display-label override, and nothing else.
 *
 * Its own function rather than a column on the write shape, for the reason the logo
 * lifecycle has one: an evolution's CAS is built from a row read seconds earlier, so a
 * write that could carry this value is a write that could quietly undo a rename made in
 * between. Here the only column in the `SET` is the override.
 *
 * Bound to the exact incarnation *and* version the menu opened on. A capability deleted
 * and recreated under the same id is a different lifetime and must not inherit a name
 * chosen for the previous one; a capability that has evolved since the menu opened is
 * being renamed under a spec the person never saw. Both come back `null`, which the
 * caller answers as a refusal rather than as a write that did nothing.
 *
 * @returns the row as it now stands, or `null` when no active row matched.
 */
export function renameCapability(
  expectation: {
    readonly capabilityId: string;
    readonly incarnationId: string;
    readonly version: number;
  },
  override: string | null,
  database: Database = db,
): CapabilityRow | null {
  const stored = database
    .query(
      `UPDATE ${REGISTRY_TABLE}
       SET display_label_override = ?
       WHERE id = ? AND incarnation_id = ? AND version = ?
         AND lifecycle_state = 'active'
       RETURNING ${ROW_COLUMNS}`,
    )
    .get(
      override,
      expectation.capabilityId,
      expectation.incarnationId,
      expectation.version,
    ) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
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
/**
 * The identities of every active capability incarnation, and nothing else.
 *
 * This is what a read gate is acquired against: it validates that a requested incarnation
 * is in the active catalog and that no capability id names two of them, neither of which
 * needs a spec. {@link listCapabilities} re-parses every row and
 * `readActiveRegistryCatalog` then hashes all of them, which is the resolver's contract
 * and real work — but a caller that only has to name incarnations was paying for it on
 * every request, and a cold desk paint issues one per tile.
 */
export function listActiveIncarnations(
  database: Database = dbReadonly,
): { readonly id: string; readonly incarnation_id: string }[] {
  return database
    .query(
      `SELECT id, incarnation_id FROM ${REGISTRY_TABLE}
       WHERE lifecycle_state = 'active'
       ORDER BY id`,
    )
    .all() as { id: string; incarnation_id: string }[];
}

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
 * The claim is a single conditional UPDATE: only a row that is still `absent` and still
 * under {@link LOGO_MAX_CLAIMED_ATTEMPTS} moves to `generating`, and the attempt counter
 * rises in the same statement. Two desk loads sweeping the same faceless capability
 * therefore cannot both proceed — the loser's `changes` is zero and it gets `null` — and
 * the count rises when the claim is *won*, before any provider is called, so a process
 * that dies mid-request has still paid for what it ordered (ADR-0007 L11).
 *
 * **The cap is part of the same statement for the same reason the increment is.** Read
 * the count, decide, then write, and two loads arriving together both read two and both
 * write three. Here the third claim is the last one any concurrency can win, whatever
 * settles the row afterwards — which is what makes the fourth provider call unreachable
 * rather than merely unlikely (PLAN decision 38).
 *
 * Binding the incarnation as well as the id is what keeps a claim from surviving a
 * delete-and-recreate: the new incarnation is a different capability's lifetime and
 * owes its own artwork.
 *
 * Returns `null` whenever the claim is not won — already claimed, already settled,
 * a tombstoned or missing row, a different incarnation, or a count already at the cap.
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
 * Hand a won claim back without settling it: `generating` returns to `absent` and the
 * attempt it spent stays spent. This is what a failed-but-not-final attempt does, and
 * what recovery does for a claim whose process died — without it a claim strands, since
 * only `absent` is ever claimable (ADR-0007 L11).
 *
 * How many times a capability may be re-claimed is not decided here: this is only the
 * transition back, and a row released with every attempt spent is `absent` by shape and
 * refused by {@link claimLogoGeneration}'s own `WHERE`, which is the only place a cap can
 * be enforced without a race.
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
 * Close a won claim: `generating → present` when accepted artwork is installed, and
 * `generating → abandoned` when the attempt just spent was the last one allowed.
 *
 * **Only from `generating`.** Every other starting state changes nothing and returns
 * `null`, so a late reply from an attempt some other state has already superseded cannot
 * resurrect it — and, in particular, an exhausted attempt cannot demote a row that has
 * since become `present` to the permanent placeholder. Reconciling accepted artwork that
 * has gone is a different transition with a different guard
 * ({@link abandonMissingCapabilityLogo}); one permissive `WHERE` shared by two callers
 * with opposite intents is how the drawing gets thrown away.
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
 * Reconcile a `present` row whose accepted artwork has gone: it wears the permanent
 * placeholder from here on and is never redrawn (ADR-0007 L7 — the once-accepted rule
 * still applies after loss).
 *
 * Bound to `present` alone, so this is the only way a row that already has artwork can
 * reach `abandoned`, and it is reachable only from desk-load recovery, which has just
 * proven the file is not there.
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
