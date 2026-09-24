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
  type RenderableCapability,
  renderableFromRow,
} from "../../../presentation/index.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../../registry/index.ts";
import {
  CapabilityDataValidationError,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  deriveCapabilityTableDdl,
  type FileClaimScope,
  resolveSubmittedFiles,
  type SubmittedFiles,
  submittedFileProjection,
} from "../../data/index.ts";
import type {
  CapabilityCreateHandler,
  CapabilityDeleteHandler,
  CapabilityInput,
  CapabilityReadHandler,
  CapabilitySaveInput,
  CapabilitySaveInputValue,
  CapabilityUpdateHandler,
} from "../contract.ts";
import { assertReadOwnership } from "../wire/failure-responses.ts";
import {
  type ParsedCapabilityRequest,
  type WireProtocolAction,
  WireProtocolError,
} from "../wire/wire-protocol.ts";
import type { HandlerLoader, ItemRendererLoader } from "./generated-code.ts";

export async function invokeCapabilityHandler(
  databases: PlatformDatabase,
  loadHandler: HandlerLoader,
  loadItemRenderer: ItemRendererLoader,
  row: CapabilityRow,
  spec: CapabilitySpec,
  dependencies: readonly CapabilityRow[],
  action: WireProtocolAction,
  parsedRequest: ParsedCapabilityRequest,
  signal: AbortSignal,
): Promise<string> {
  const { input } = parsedRequest;
  const query = createCapabilityQueryPort(databases.readonly, {
    target: spec,
    dependencies: dependencies.map(capabilitySpecFromRow),
    signal,
  });
  const writes = writeWindow();
  // The router's first check ran before the save's transaction opened; this one runs inside it,
  // holding the write lock, so a sweep or another save that committed in between is refused.
  const checkFiles = (save: "create" | "update") =>
    resolveSubmittedFiles(
      activeSpecFields(spec.schema.fields),
      input.values,
      save,
      fileClaimScope(databases.readwrite, row, spec, parsedRequest.recordTarget),
    );

  if (action === "create") {
    assertReadOwnership(signal);
    const files = checkFiles(action);
    const mutation = writes.guard(
      createCapabilityMutationPort(spec, databases.readwrite, signal, {
        incarnationId: row.incarnation_id,
        submitted: files,
      }),
    );
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    assertReadOwnership(signal);
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await writes.answered(
      (handler as CapabilityCreateHandler)({
        input: withFileProjections(input, files),
        mutation,
        query,
        present,
      }),
    );
    assertReadOwnership(signal);
    return fragment;
  }
  if (action === "update") {
    assertReadOwnership(signal);
    const target = requireRecordTarget(parsedRequest.recordTarget, action);
    const files = checkFiles(action);
    const mutation = writes.guard(
      createCapabilityUpdateMutationPort(
        spec,
        target,
        new Set(input.submittedFields),
        databases.readwrite,
        signal,
        { incarnationId: row.incarnation_id, submitted: files },
      ),
    );
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    assertReadOwnership(signal);
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await writes.answered(
      (handler as CapabilityUpdateHandler)({
        input: withFileProjections(input, files),
        mutation,
        query,
        present,
      }),
    );
    assertReadOwnership(signal);
    return fragment;
  }
  if (action === "delete") {
    assertReadOwnership(signal);
    const mutation = writes.guard(
      createCapabilityDeleteMutationPort(
        spec,
        requireRecordTarget(parsedRequest.recordTarget, action),
        databases.readwrite,
        signal,
        { incarnationId: row.incarnation_id },
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
  const present = await buildPresentationAdapter(row, loadItemRenderer);
  assertReadOwnership(signal);
  const handler = await loadHandler(row.artifacts_path, action);
  assertReadOwnership(signal);
  const fragment = await (handler as CapabilityReadHandler)({ input, query, present });
  assertReadOwnership(signal);
  return fragment;
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
            return [
              name,
              Object.defineProperties(guarded, {
                name: { value: write.name },
                length: { value: write.length },
              }),
            ];
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

/**
 * Where a save's file references are checked. An update's record is where its files are kept, so a
 * submission that keeps one is checked against what the record holds now.
 */
export function fileClaimScope(
  database: Database,
  row: CapabilityRow,
  spec: CapabilitySpec,
  recordTarget: string | undefined,
): FileClaimScope {
  return {
    database,
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    ...(recordTarget === undefined
      ? {}
      : { record: { table: deriveCapabilityTableDdl(spec).tableName, id: recordTarget } }),
  };
}

/** The Handler's input, with each submitted file field's wire value replaced by its projection. */
function withFileProjections(input: CapabilityInput, files: SubmittedFiles): CapabilitySaveInput {
  const values: Record<string, CapabilitySaveInputValue> = { ...input.values };
  for (const [field, file] of files) values[field] = submittedFileProjection(file);
  return { values: Object.freeze(values), submittedFields: input.submittedFields };
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
async function buildPresentationAdapter(
  row: CapabilityRow,
  loadItemRenderer: ItemRendererLoader,
): Promise<PresentationAdapter> {
  const renderItem = await loadItemRenderer(row.artifacts_path);
  return createPresentationAdapter({ capability: renderableForHandler(row), renderItem });
}

// The slice of a row the adapter needs: the id, the effective label — what the user renamed this
// to — and the fields. The same canonical reading serves `src/server/http/cached-view.ts`.
function renderableForHandler(row: CapabilityRow): RenderableCapability {
  return { ...renderableFromRow(row), item: row.ui_intent.item };
}
