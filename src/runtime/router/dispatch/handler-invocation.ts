// Running one generated Handler: the per-Action toolbox the router hands it, and the
// presentation adapter bound to the capability it belongs to.
//
// Split out of `router.ts` so that file stays the routing sheet. Everything here runs
// *inside* the route's read-token scope, which is why `assertReadOwnership` sits between
// every await: a capability being deleted asks its readers to stop, and every step here is
// a place a Handler could otherwise carry on working for a lifetime that has ended.

import type { Database } from "bun:sqlite";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createPresentationAdapter,
  type PresentationAdapter,
  renderableFromRow,
} from "../../../presentation/index.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  getCapability,
  holdingRelations,
  listCapabilities,
  sameRelation,
} from "../../../registry/index.ts";
import {
  CapabilityDataValidationError,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  type FileSubmissionBinding,
  fieldsDrawnUnlinked,
  fileClaimScope,
  heldPicks,
  type LinkBinding,
  type PickScope,
  type RefreshReach,
  releaseUnclaimedFiles,
  resolveSubmittedFiles,
  resolveSubmittedPicks,
  type SaveRelations,
} from "../../data/index.ts";
import type {
  CapabilityContext,
  CapabilityCreateHandler,
  CapabilityDeleteHandler,
  CapabilityHandler,
  CapabilityReadHandler,
  CapabilitySaveInput,
  CapabilityUpdateHandler,
} from "../contract.ts";
import { withFileProjections } from "../save-input.ts";
import { assertReadOwnership } from "../wire/failure-responses.ts";
import {
  FormChangedError,
  type ParsedCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "../wire/wire-protocol.ts";
import type { HandlerLoader, ItemRendererLoader } from "./generated-code.ts";

/**
 * What a Handler's request read: its declared dependencies, the active desk around it, and the
 * capability's relations, those that hold against that desk and those asleep.
 */
export interface HandlerRead extends SaveRelations {
  readonly dependencies: readonly CapabilityRow[];
  readonly catalog: readonly CapabilityRow[];
  /** What an edit's refresh or a deletion's clearing reaches, on the desk its transaction finds. */
  readonly settleReach: (desk: () => readonly CapabilityRow[]) => RefreshReach;
}

/** Where a save's picks are checked, each target's records named by the noun its row stores. */
export function pickScope(
  database: Database,
  capabilityId: string,
  action: "create" | "update",
  catalog: readonly CapabilityRow[],
): PickScope {
  return { database, capabilityId, action, targetNoun: targetNounIn(catalog) };
}

/** The record noun of the capability a relation points at, as its row stores it. */
function targetNounIn(catalog: readonly CapabilityRow[]): (capabilityId: string) => string {
  return (id) => catalog.find((row) => row.id === id)?.noun ?? "record";
}

export async function invokeCapabilityHandler(
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  row: CapabilityRow,
  spec: CapabilitySpec,
  read: HandlerRead,
  action: WireProtocolAction,
  parsedRequest: ParsedCapabilityRequest,
  signal: AbortSignal,
): Promise<string> {
  const { input, recordTarget, drawnFiles } = parsedRequest;
  const query = createCapabilityQueryPort(databases.readonly, {
    target: spec,
    dependencies: read.dependencies.map(capabilitySpecFromRow),
    signal,
  });
  const writes = writeWindow(databases.readwrite);
  const fileScope = () =>
    fileClaimScope(databases.readwrite, spec, row.incarnation_id, recordTarget, drawnFiles);

  const runSave = async <Port extends object>(
    save: "create" | "update",
    bind: (files: FileSubmissionBinding, links: LinkBinding) => Port,
    call: (handler: CapabilityHandler, context: SaveContext<Port>) => Promise<string>,
  ): Promise<string> => {
    assertReadOwnership(signal);
    // The router's first check ran before the save's transaction opened; this one runs inside it,
    // holding the write lock, so a sweep or another save that committed in between is refused.
    const scope = fileScope();
    const fields = activeSpecFields(spec.schema.fields);
    const submitted = resolveSubmittedFiles(fields, input.values, save, scope);
    const desk = deskOnce(scope.database);
    const held = settledRelations(scope.database, row, desk, read.catalog);
    const picks = pickScope(scope.database, spec.id, save, held.catalog);
    const checked = resolveSubmittedPicks(picks, held, parsedRequest.picks);
    if (save === "update") refuseDrawnUnlinked(scope.database, row.id, held, parsedRequest);
    const links: LinkBinding = { ...checked, reach: read.settleReach(desk) };
    const mutation = writes.guard(bind({ scope, submitted }, links));
    // On the save's own connection: the link row it writes is not committed when `present` reads.
    const drawn = { ...read, ...held };
    const present = await buildPresentationAdapter(row, drawn, loadItemRenderer, scope.database);
    assertReadOwnership(signal);
    const handler = await loadHandler(row.artifacts_path, save);
    assertReadOwnership(signal);
    const fragment = await writes.answered(
      call(handler, { input: withFileProjections(input, submitted), mutation, query, present }),
    );
    assertReadOwnership(signal);
    assertSaveStands(scope.database);
    releaseUnclaimedFiles(scope.database, submitted);
    return fragment;
  };

  if (action === "create") {
    return runSave(
      action,
      (files, links) => createCapabilityMutationPort(spec, files, signal, links),
      (handler, context) => (handler as CapabilityCreateHandler)(context),
    );
  }
  if (action === "update") {
    const target = requireRecordTarget(recordTarget, action);
    const submittedFields = new Set(input.submittedFields);
    return runSave(
      action,
      (files, links) =>
        createCapabilityUpdateMutationPort(spec, target, submittedFields, files, signal, links),
      (handler, context) => (handler as CapabilityUpdateHandler)(context),
    );
  }
  if (action === "delete") {
    assertReadOwnership(signal);
    const target = requireRecordTarget(recordTarget, action);
    const scope = fileScope();
    // Settled inside the deletion's transaction, as an edit's refresh is, on the desk it finds.
    const reach = read.settleReach(() => listCapabilities(scope.database));
    const mutation = writes.guard(
      createCapabilityDeleteMutationPort(spec, target, scope, signal, reach),
    );
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await writes.answered(
      (handler as CapabilityDeleteHandler)({ input, mutation, query }),
    );
    assertReadOwnership(signal);
    assertSaveStands(databases.readwrite);
    return fragment;
  }

  assertReadOwnership(signal);
  const present = await buildPresentationAdapter(row, read, loadItemRenderer, databases.readonly);
  assertReadOwnership(signal);
  const handler = await loadHandler(row.artifacts_path, action);
  assertReadOwnership(signal);
  const fragment = await (handler as CapabilityReadHandler)({ input, query, present });
  assertReadOwnership(signal);
  return fragment;
}

/**
 * A save whose transaction SQLite ended under it, as a full disk can, saved nothing, whatever its
 * Handler answered: it fails before anything else writes, since a write now would commit alone.
 */
function assertSaveStands(database: Database): void {
  if (!database.inTransaction) {
    throw new Error("The save's transaction ended before its Handler answered.");
  }
}

/** The desk as the save's transaction finds it, read once, and only if the save asks for it. */
function deskOnce(database: Database): () => readonly CapabilityRow[] {
  let desk: readonly CapabilityRow[] | undefined;
  return () => {
    desk ??= listCapabilities(database);
    return desk;
  };
}

/** A save's relations as its transaction settles them, and the desk they were settled on. */
interface SettledRelations extends SaveRelations {
  readonly catalog: readonly CapabilityRow[];
}

/**
 * The relations as the save's transaction finds the desk: those that hold now, and every other one
 * the row has, asleep. A link, an Unlink or an activation that committed since admission is read
 * here, so a relation woken since refuses a form drawn while it slept, and one put to sleep drops
 * its pick. A relation removed since admission is in neither, so the save writes no row for it.
 */
function settledRelations(
  database: Database,
  row: CapabilityRow,
  desk: () => readonly CapabilityRow[],
  admitted: readonly CapabilityRow[],
): SettledRelations {
  const now = getCapability(row.id, database) ?? row;
  if (now.relations.length === 0) return { relations: [], dormant: [], catalog: admitted };
  const catalog = desk();
  const relations = holdingRelations(now, catalog);
  const dormant = now.relations.filter(
    (each) => !relations.some((held) => sameRelation(held, each)),
  );
  return { relations, dormant, catalog };
}

/**
 * Refuse an edit from a form drawn before one of its fields was linked, as a form drawn before an
 * evolution is: its text for that field would write an old name over the link.
 */
function refuseDrawnUnlinked(
  database: Database,
  capabilityId: string,
  held: SaveRelations,
  parsed: ParsedCapabilityRequest,
): void {
  const recordId = requireRecordTarget(parsed.recordTarget, "update");
  const form = { ...parsed.input, drawnLinked: parsed.drawnLinked };
  const stale = fieldsDrawnUnlinked(database, { capabilityId, recordId }, held.relations, form);
  if (stale.length > 0) throw new FormChangedError("update", stale);
}

/** A save's context over the mutation port it binds; each save checks it against its own Handler. */
interface SaveContext<Port> extends Omit<CapabilityContext, "input"> {
  readonly input: CapabilitySaveInput;
  readonly mutation: Port;
}

/**
 * The span a writing Handler may write in: from its call until its answer settles, and while the
 * save's transaction stands, since a write after SQLite ended it (a full disk does) would commit on
 * its own. Each write asks `Bun.peek`, so a queued write is refused once the answer has settled.
 * Returning a value settles it at the `return`; a returned promise, only once it is adopted.
 */
function writeWindow(database: Database) {
  let answer: Promise<string> | undefined;
  const assertOpen = () => {
    if (answer !== undefined && Bun.peek.status(answer) !== "pending") {
      throw new CapabilityDataValidationError(
        "The mutation port closed when its Handler answered.",
      );
    }
    if (!database.inTransaction) {
      throw new CapabilityDataValidationError("The mutation port closed with its transaction.");
    }
  };
  return {
    guard<Port extends object>(port: Port): Port {
      return Object.fromEntries(
        Object.entries(port).map(
          ([name, write]: [string, (...parameters: unknown[]) => unknown]) => {
            const guarded = (...args: unknown[]) => {
              assertOpen();
              return write(...args);
            };
            return [name, guarded];
          },
        ),
      ) as Port;
    },
    answered(pending: Promise<string>): Promise<string> {
      answer = pending;
      return pending;
    },
  };
}

function requireRecordTarget(
  recordTarget: string | undefined,
  action: "update" | "delete",
): string {
  if (recordTarget === undefined) {
    throw new WireProtocolError(`${action} requires a validated record target.`);
  }
  return recordTarget;
}

/** The relations a capability's cards are drawn under, and the desk they hold against. */
export type DrawnRelations = Pick<HandlerRead, "relations" | "dormant" | "catalog">;

// Build the capability's presentation adapter. `present` stays synchronous (record → string)
// because the renderer resolves here, once, before the handler runs; a missing one fails the read.
// Each card's broken-link mark reads what its linked fields picked, on `database`. The record
// address builds one for each capability linking to its record, whose cards are `listed`.
export async function buildPresentationAdapter(
  row: CapabilityRow,
  read: DrawnRelations,
  loadItemRenderer: ItemRendererLoader,
  database: Database,
  { listed }: { readonly listed?: boolean } = {},
): Promise<PresentationAdapter> {
  const renderItem = await loadItemRenderer(row.artifacts_path);
  // A save draws the relations its transaction settled on, which may differ from the admitted row's.
  const relations = [...read.relations, ...read.dormant];
  const linkedFields = read.relations.map(({ field }) => field);
  const drawn = { ...renderableFromRow({ ...row, relations }, read.catalog), linkedFields };
  const capability = { ...drawn, item: row.ui_intent.item };
  const links = (recordId: string) => heldPicks(database, row.id, recordId, read.relations);
  const nounOf = targetNounIn(read.catalog);
  const linkNouns = new Map(read.relations.map(({ field, to }) => [field, nounOf(to.capability)]));
  return createPresentationAdapter({ capability, renderItem, links, linkNouns, listed });
}
