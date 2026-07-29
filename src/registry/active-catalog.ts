// One immutable resolver view of the active registry.
//
// Prompt resolution must classify against one catalog and bind any resulting build
// request to that exact view. The fingerprint is therefore over the complete validated
// active rows, in the registry's canonical id order, using recursively sorted object keys.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { dbReadonly } from "../persistence/db.ts";
import type { CapabilityRow } from "./spec.ts";
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
  const canonical = JSON.stringify(canonicalize(capabilities));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function readActiveRegistryCatalog(database: Database = dbReadonly): ActiveRegistryCatalog {
  const capabilities = listCapabilities(database);
  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    fingerprint: fingerprintActiveRegistryCatalog(capabilities),
  });
}
