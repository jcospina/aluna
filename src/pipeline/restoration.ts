// Complete-View restoration for foreground explicit work (Module 4.5, decision 29).
// Jobs retain only registry identity, never records or a version-directory path.

import type { Database } from "bun:sqlite";

import { getCapability } from "../registry/index.ts";
import { renderCachedCapabilitySurface } from "../web/cached-view.ts";
import { escapeHtml } from "../web/html.ts";

export const RESTORATION_CAPABILITY_ID_FIELD = "__aluna_restore_capability_id";
export const RESTORATION_INCARNATION_ID_FIELD = "__aluna_restore_incarnation_id";

export type RestorationDescriptor =
  | { readonly kind: "neutral" }
  | {
      readonly kind: "capability";
      readonly capabilityId: string;
      readonly incarnationId: string;
    };

export interface RestorationIdentityInput {
  readonly capabilityId?: string;
  readonly incarnationId?: string;
}

export type RestorationBehavior = "replace" | "preserve";

/** Capture and validate the data-free identity before foreground generation lands. */
export function captureRestorationDescriptor(
  input: RestorationIdentityInput,
  database: Database,
): RestorationDescriptor {
  if (!input.capabilityId || !input.incarnationId) return { kind: "neutral" };
  const row = getCapability(input.capabilityId, database);
  if (!row || row.incarnation_id !== input.incarnationId) return { kind: "neutral" };
  return {
    kind: "capability",
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
  };
}

/**
 * Resolve against the then-current registry. The returned View is data-free and its
 * canonical load trigger fetches records through the committed `read` Handler.
 */
export function renderRestorationFragment(
  descriptor: RestorationDescriptor,
  database: Database,
  notice?: string,
  behavior: RestorationBehavior = "replace",
): string {
  const behaviorAttribute =
    behavior === "preserve" ? ' data-build-restoration-behavior="preserve"' : "";
  let restoration = `<div data-build-restoration="neutral"${behaviorAttribute}></div>`;
  if (descriptor.kind === "capability") {
    const row = getCapability(descriptor.capabilityId, database);
    if (row?.incarnation_id === descriptor.incarnationId) {
      restoration = [
        `<div data-build-restoration="capability"${behaviorAttribute}>`,
        renderCachedCapabilitySurface(row),
        "</div>",
      ].join("\n");
    }
  }
  if (notice === undefined) return restoration;
  return [
    restoration,
    `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`,
  ].join("\n");
}
