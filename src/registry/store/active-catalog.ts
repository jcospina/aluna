// One immutable resolver view of the active registry.
//
// Prompt resolution must classify against one catalog and bind any resulting build
// request to that exact view. The fingerprint is therefore over the complete validated
// active rows, in the registry's canonical id order, using recursively sorted object keys.
//
// One exclusion, and it is load-bearing: the logo lifecycle is not part of the view.
// It moves out of band — a desk load claims an attempt for any faceless capability —
// so hashing it would let one capability's artwork arriving refuse an unrelated
// in-flight build as classified-against-stale-state. What the resolver reads, and
// what a build must be revalidated against, is semantic registry content; whether a
// picture has landed yet is neither.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { dbReadonly } from "../../platform/persistence/db.ts";
import type { CapabilityRow } from "../spec/spec.ts";
import { listCapabilities } from "./store.ts";

export interface ActiveRegistryCatalog {
  readonly capabilities: readonly CapabilityRow[];
  readonly fingerprint: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function fingerprintActiveRegistryCatalog(capabilities: readonly CapabilityRow[]): string {
  const canonical = JSON.stringify(canonicalize(capabilities.map(fingerprintedView)));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function fingerprintedView(row: CapabilityRow): Omit<CapabilityRow, "logo"> {
  const { logo: _logo, ...view } = row;
  return view;
}

export function readActiveRegistryCatalog(database: Database = dbReadonly): ActiveRegistryCatalog {
  const capabilities = listCapabilities(database);
  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    fingerprint: fingerprintActiveRegistryCatalog(capabilities),
  });
}
