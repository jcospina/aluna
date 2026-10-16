import type { Database } from "bun:sqlite";
import type { MatchCounts } from "../../presentation/controls/link/link-copy.ts";
import {
  addCapabilityRelation,
  type CapabilityRow,
  getCapability,
  listCapabilities,
} from "../../registry/index.ts";
import {
  MutationAdmissionError,
  type MutationCoordinator,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import { singleFormValue, versionIn } from "../form-values.ts";
import { matchTypedNames } from "./matching/matching-scan.ts";
import { type LinkEnd, type LinkRefusalCode, linkRefusal } from "./rules.ts";

/** One end of a press, as the chooser read it: the write is conditional on exactly this. */
export interface PressedEnd {
  readonly capabilityId: string;
  readonly field: string;
  readonly incarnationId: string;
  readonly version: number;
}

/** Both ends of a press, each as it was read: Link's chooser posts one, and so does Unlink's chain. */
export interface LinkPress {
  readonly source: PressedEnd;
  readonly target: PressedEnd;
}

/** What a press on `target`'s field posts, `source` and `target` as they were read. */
export function pressFields(
  source: CapabilityRow,
  target: CapabilityRow,
  targetField: string,
): Record<string, string> {
  return {
    incarnation_id: source.incarnation_id,
    version: String(source.version),
    target: target.id,
    target_field: targetField,
    target_incarnation_id: target.incarnation_id,
    target_version: String(target.version),
  };
}

/** The press a form carries, or null when one of its values is missing or repeated: forged. */
export function pressFrom(
  capabilityId: string,
  field: string,
  form: Parameters<typeof singleFormValue>[0],
): LinkPress | null {
  const value = (name: string) => singleFormValue(form, name);
  const version = versionIn(value("version"));
  const targetVersion = versionIn(value("target_version"));
  const named = ["incarnation_id", "target", "target_field", "target_incarnation_id"].map(value);
  if (version === null || targetVersion === null || named.includes("")) return null;
  const [incarnationId = "", target = "", targetField = "", targetIncarnationId = ""] = named;
  return {
    source: { capabilityId, field, incarnationId, version },
    target: {
      capabilityId: target,
      field: targetField,
      incarnationId: targetIncarnationId,
      version: targetVersion,
    },
  };
}

/** A press whose caller went away while it queued leaves the queue; nobody reads the answer. */
export async function staleIfDropped<Outcome>(
  write: () => Promise<Outcome>,
): Promise<Outcome | { readonly status: "stale"; readonly moved: null }> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof MutationAdmissionError) return { status: "stale", moved: null };
    throw error;
  }
}

export interface CapabilityLinkDeps {
  readonly database: Database;
  readonly mutationCoordinator: MutationCoordinator;
  /** The readonly connection the pre-queue look is taken on. */
  readonly readonlyDatabase?: Database;
  /** Dropped if the caller goes away before this write reaches the head of the queue. */
  readonly signal?: AbortSignal;
  /**
   * Told once the rules admit the pair under the lease, before the relation and its link rows are
   * written; the write waits for what it returns, so the person can be told it is under way.
   */
  readonly onAdmitted?: (ends: AdmittedEnds) => Promise<void> | void;
}

/** Both ends of a pair the rules admitted, as the lease read them. */
export interface AdmittedEnds {
  readonly source: CapabilityRow;
  readonly target: CapabilityRow;
}

export type CapabilityLinkOutcome =
  /** Written with the names the field held matched. `source` holds the new relation. */
  | (AdmittedEnds & { readonly status: "linked"; readonly matched: MatchCounts })
  /** A rule refused the pair, read under the lease. Nothing was written. */
  | {
      readonly status: "refused";
      readonly code: LinkRefusalCode;
      readonly source: LinkEnd;
      readonly target: LinkEnd;
    }
  /** An end is not the row the press read: `moved` is it as it stands now, or null when gone. */
  | { readonly status: "stale"; readonly moved: CapabilityRow | null };

/**
 * A short platform write, not a build: no model, no version, and it queues FIFO behind a build, so
 * a press landing as one starts waits and then applies, or is stale.
 */
export async function linkCapabilityField(
  press: LinkPress,
  deps: CapabilityLinkDeps,
): Promise<CapabilityLinkOutcome> {
  // A cheap readonly look first, as Rename's: a queued press holds up every record save behind it.
  const looked = deps.readonlyDatabase && readEnds(press, listCapabilities(deps.readonlyDatabase));
  if (looked && "status" in looked) return looked;
  return deps.mutationCoordinator.withPlatformWrite(
    () => linkUnderLease(press, deps),
    deps.signal ? { signal: deps.signal } : {},
  );
}

/**
 * Both ends read again under the lease and the rules decided on what was read, then the relation
 * and the matching scan's link rows in one transaction: a scan that fails leaves
 * the field as it was, to be linked again.
 */
async function linkUnderLease(
  press: LinkPress,
  deps: CapabilityLinkDeps,
): Promise<CapabilityLinkOutcome> {
  // Admitted, but nobody is left to hear it: a press that outlived its connection writes nothing.
  if (deps.signal?.aborted) return { status: "stale", moved: null };
  const catalog = listCapabilities(deps.database);
  const ends = readEnds(press, catalog);
  if ("status" in ends) return ends;
  const source = { row: ends.source, field: press.source.field };
  const target = { row: ends.target, field: press.target.field };
  const code = linkRefusal(source, target, catalog);
  if (code) return { status: "refused", code, source, target };

  const relation = {
    field: source.field,
    to: { capability: target.row.id, incarnation: target.row.incarnation_id, field: target.field },
  };
  const expectation = {
    capabilityId: source.row.id,
    incarnationId: source.row.incarnation_id,
    version: source.row.version,
    relations: source.row.relations,
  };
  await deps.onAdmitted?.({ source: source.row, target: target.row });
  // Nothing that moves either end writes without the lease this holds, so the rules still stand.
  const written = deps.database.transaction(() => {
    const row = addCapabilityRelation(expectation, relation, deps.database);
    return row && { row, matched: matchTypedNames(deps.database, row, target.row, relation) };
  })();
  if (!written) return { status: "stale", moved: getCapability(source.row.id, deps.database) };
  return { status: "linked", source: written.row, target: target.row, matched: written.matched };
}

type StaleOutcome = Extract<CapabilityLinkOutcome, { status: "stale" }>;

/** Both ends' rows when each is still the row the press read, or the first end that moved. */
function readEnds(
  press: LinkPress,
  catalog: readonly CapabilityRow[],
): { readonly source: CapabilityRow; readonly target: CapabilityRow } | StaleOutcome {
  const source = catalog.find((row) => row.id === press.source.capabilityId);
  if (!isAsRead(source, press.source)) return { status: "stale", moved: source ?? null };
  const target = catalog.find((row) => row.id === press.target.capabilityId);
  if (!isAsRead(target, press.target)) return { status: "stale", moved: target ?? null };
  return { source, target };
}

export function isAsRead(row: CapabilityRow | undefined, end: PressedEnd): row is CapabilityRow {
  return row?.incarnation_id === end.incarnationId && row.version === end.version;
}
