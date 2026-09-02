import type { PlatformDatabase } from "../platform/persistence/db.ts";
import type { CapabilityIncarnation } from "../read-gates/index.ts";
import type { ActiveRegistryCatalog, CapabilityRow } from "../registry/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

export type ActiveCatalogReader = (database: PlatformDatabase["readonly"]) => ActiveRegistryCatalog;

export type CapabilityCatalogLookup = (
  id: string,
  database: PlatformDatabase["readonly"],
) => CapabilityRow | null;

export interface CapturedCapabilityRead {
  readonly catalog: readonly CapabilityRow[];
  readonly dependencies: readonly CapabilityRow[];
  readonly incarnations: readonly CapabilityIncarnation[];
  readonly row: CapabilityRow | undefined;
}

export function captureCapabilityRead(
  id: string,
  action: WireProtocolAction | undefined,
  database: PlatformDatabase["readonly"],
  readActiveCatalog: ActiveCatalogReader,
  lookupCapability?: CapabilityCatalogLookup,
): CapturedCapabilityRead {
  const catalog = readActiveCatalog(database).capabilities;
  const row = lookupCapability
    ? (lookupCapability(id, database) ?? undefined)
    : catalog.find((candidate) => candidate.id === id);
  if (!row) return { catalog, dependencies: [], incarnations: [], row: undefined };

  const dependencies = action ? resolveDependencies(row, action, catalog) : [];
  return {
    catalog,
    dependencies,
    incarnations: [row, ...dependencies].map(capabilityIncarnation),
    row,
  };
}

export function capabilityIncarnation(
  row: Pick<CapabilityRow, "id" | "incarnation_id">,
): CapabilityIncarnation {
  return { capabilityId: row.id, incarnationId: row.incarnation_id };
}

function resolveDependencies(
  row: CapabilityRow,
  action: WireProtocolAction,
  catalog: readonly CapabilityRow[],
): readonly CapabilityRow[] {
  return row.read_dependencies[action].map((dependency) => {
    const resolved = catalog.find(
      (candidate) =>
        candidate.id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    if (!resolved) {
      throw new Error(
        `Read dependency ${dependency.capability_id}/${dependency.incarnation_id} is absent from the captured active catalog.`,
      );
    }
    return resolved;
  });
}
