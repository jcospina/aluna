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
  type Relation,
  sameRelation,
} from "../../../registry/index.ts";
import {
  CapabilityDataValidationError,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  type FileSubmissionBinding,
  fileClaimScope,
  heldPicks,
  type LinkBinding,
  type PickScope,
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
}

/** Where a save's picks are checked, each target's records named by the noun its row stores. */
export function pickScope(
  database: Database,
  capabilityId: string,
  action: "create" | "update",
  catalog: readonly CapabilityRow[],
): PickScope {
  const targetNoun = (id: string) => catalog.find((row) => row.id === id)?.noun ?? "record";
  return { database, capabilityId, action, targetNoun };
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
  const writes = writeWindow();
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
    const held = settledRelations(scope.database, row, read);
    const picks = pickScope(scope.database, spec.id, save, read.catalog);
    const links = resolveSubmittedPicks(picks, held, parsedRequest.picks);
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
    const mutation = writes.guard(
      createCapabilityDeleteMutationPort(
        spec,
        requireRecordTarget(recordTarget, action),
        fileScope(),
        signal,
      ),
    );
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await writes.answered(
      (handler as CapabilityDeleteHandler)({ input, mutation, query }),
    );
    assertReadOwnership(signal);
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
 * The relations as the save's transaction finds the row: those that held when the request was
 * admitted and still stand, and every other one the row has, asleep. A relation removed since
 * admission is in neither, so the save writes no row for it.
 */
function settledRelations(
  database: Database,
  row: CapabilityRow,
  read: SaveRelations,
): SaveRelations {
  const now = getCapability(row.id, database)?.relations ?? row.relations;
  const standing = (relation: Relation) => now.some((each) => sameRelation(each, relation));
  const relations = read.relations.filter(standing);
  const dormant = now.filter((each) => !relations.some((held) => sameRelation(held, each)));
  return { relations, dormant };
}

/** A save's context over the mutation port it binds; each save checks it against its own Handler. */
interface SaveContext<Port> extends Omit<CapabilityContext, "input"> {
  readonly input: CapabilitySaveInput;
  readonly mutation: Port;
}

/**
 * The span a writing Handler may write in: from its call until its answer settles. Each write asks
 * `Bun.peek`, which reads a settled promise synchronously, so once the answer has settled a queued
 * write is refused even before the route sees it. Returning a value settles it at the `return`;
 * returning a promise settles it only once that promise is adopted, and writes in between land.
 */
function writeWindow() {
  let answer: Promise<string> | undefined;
  const assertOpen = () => {
    if (answer !== undefined && Bun.peek.status(answer) !== "pending") {
      throw new CapabilityDataValidationError(
        "The mutation port closed when its Handler answered.",
      );
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

// Build the capability's presentation adapter. `present` stays synchronous (record → string)
// because the renderer resolves here, once, before the handler runs; a missing one fails the read.
// Each record's Edit form carries what its linked fields picked, read on `database`.
async function buildPresentationAdapter(
  row: CapabilityRow,
  read: HandlerRead,
  loadItemRenderer: ItemRendererLoader,
  database: Database,
): Promise<PresentationAdapter> {
  const renderItem = await loadItemRenderer(row.artifacts_path);
  const capability = { ...renderableFromRow(row, read.catalog), item: row.ui_intent.item };
  const links = (recordId: string) => heldPicks(database, row.id, recordId, read.relations);
  return createPresentationAdapter({ capability, renderItem, links });
}
