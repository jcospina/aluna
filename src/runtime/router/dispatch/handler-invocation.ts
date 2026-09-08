// Running one generated Handler: the per-Action toolbox the router hands it, and the
// presentation adapter bound to the capability it belongs to.
//
// Split out of `router.ts` so that file stays the routing sheet. Everything here runs
// *inside* the route's read-token scope, which is why `assertReadOwnership` sits between
// every await: a capability being deleted asks its readers to stop, and every step here is
// a place a Handler could otherwise carry on working for a lifetime that has ended.

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createPresentationAdapter,
  type PresentationAdapter,
  type RenderableCapability,
} from "../../../presentation/index.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  canonicalCapabilityLabel,
  capabilitySpecFromRow,
} from "../../../registry/index.ts";
import {
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
} from "../../data/index.ts";
import type {
  CapabilityCreateHandler,
  CapabilityDeleteHandler,
  CapabilityReadHandler,
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

  if (action === "create") {
    assertReadOwnership(signal);
    const mutation = createCapabilityMutationPort(spec, databases.readwrite, signal);
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    assertReadOwnership(signal);
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await (handler as CapabilityCreateHandler)({
      input,
      mutation,
      query,
      present,
    });
    assertReadOwnership(signal);
    return fragment;
  }
  if (action === "update") {
    assertReadOwnership(signal);
    const mutation = createCapabilityUpdateMutationPort(
      spec,
      requireRecordTarget(parsedRequest.recordTarget, action),
      new Set(input.submittedFields),
      databases.readwrite,
      signal,
    );
    const present = await buildPresentationAdapter(row, loadItemRenderer);
    assertReadOwnership(signal);
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await (handler as CapabilityUpdateHandler)({
      input,
      mutation,
      query,
      present,
    });
    assertReadOwnership(signal);
    return fragment;
  }
  if (action === "delete") {
    assertReadOwnership(signal);
    const mutation = createCapabilityDeleteMutationPort(
      spec,
      requireRecordTarget(parsedRequest.recordTarget, action),
      databases.readwrite,
      signal,
    );
    const handler = await loadHandler(row.artifacts_path, action);
    assertReadOwnership(signal);
    const fragment = await (handler as CapabilityDeleteHandler)({ input, mutation, query });
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
  return createPresentationAdapter({ capability: renderableFromRow(row), renderItem });
}

// The slice of a row the adapter needs: the id, the effective label — what the user renamed this
// to — and the fields. The same canonical reading serves `src/server/http/cached-view.ts`.
function renderableFromRow(row: CapabilityRow): RenderableCapability {
  return {
    id: row.id,
    label: canonicalCapabilityLabel(row),
    noun: row.noun,
    schema: row.schema,
    form: row.ui_intent.form,
    actions: row.tools,
    item: row.ui_intent.item,
  };
}
