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

// Build the capability's presentation adapter for the injected toolbox:
// load its item renderer, then bind it with the capability so `present` turns one record
// into safe wrapped item HTML. `present` stays synchronous (record → string) because the
// renderer is resolved here, once, before the handler runs.
//
// The M3 artifact shape is mandatory: every committed capability has one item renderer
// beside its handlers. A missing or malformed renderer fails the request through the
// router's normal product-voice error boundary; there is no M2 compatibility adapter or
// dual-serving path.
async function buildPresentationAdapter(
  row: CapabilityRow,
  loadItemRenderer: ItemRendererLoader,
): Promise<PresentationAdapter> {
  const renderItem = await loadItemRenderer(row.artifacts_path);
  return createPresentationAdapter({ capability: renderableFromRow(row), renderItem });
}

// The slice of a row the presentation adapter needs: the id (namespaces the record-view
// templates), the user-facing label (what back goes back to), and the fields (the form).
//
// The label is the effective one — what the user renamed this to, or what the model
// authored. The place a person goes back to should be called what it is called on the
// desk, and the same canonical reading serves the collection (`src/web/cached-view.ts`).
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
