// The read token both file routes take on one incarnation (ARCH §8, ADR-0006): against the
// active registry as it stands, so a deleted or closing incarnation yields none.

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import { readActiveIncarnationCatalog } from "../../registry/index.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
  ReadTokenSet,
} from "../../runtime/concurrency/read-gates.ts";

export function tryReadToken(
  readGates: ReadGateCoordinator,
  readonly: PlatformDatabase["readonly"],
  incarnation: CapabilityIncarnation,
): ReadTokenSet | undefined {
  return readGates.tryAcquire({
    catalog: readActiveIncarnationCatalog(readonly),
    incarnations: [incarnation],
  });
}
