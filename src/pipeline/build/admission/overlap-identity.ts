import {
  type CapabilityRow,
  type CapabilitySpec,
  canonicalCapabilityLabel,
} from "../../../registry/index.ts";
import { containsWords, sameWords } from "./word-forms.ts";

interface SeparateCapabilityIdentity {
  readonly id: string;
  readonly label: string;
}

export class OverlapIdentityValidationError extends Error {
  override readonly name = "OverlapIdentityValidationError";
}

function identityTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .match(/[a-z]+|[0-9]+/g)
    ?.filter((token) => token.length >= 2);
  return new Set(tokens ?? []);
}

interface Identity {
  readonly name: string;
  readonly tokens: Set<string>;
}

/**
 * Every name this capability answers to: a rename adds one without retiring the old, and the
 * resolver sees it too (`formatCapability`), so matching fewer admits a tile the desk already has.
 */
function identitiesFor(capability: RenameableIdentity): readonly Identity[] {
  return [capability.id, capability.label, canonicalCapabilityLabel(capability)].map((name) => ({
    name,
    tokens: identityTokens(name),
  }));
}

type RenameableIdentity = Pick<CapabilityRow, "id" | "label" | "display_label_override">;

/**
 * A trailing number is mechanical only when the text before it still names an existing
 * capability: Contacts 2 and contacts_v2 match, Studio 54 goes to the resolver, not a blacklist.
 */
function hasMechanicalIdentity(
  value: string,
  capabilities: readonly RenameableIdentity[],
): boolean {
  const match = /^(.*?)(?:[_\s-]*(?:v(?:ersion)?[_\s-]*)?\d+)$/i.exec(value.trim());
  const base = match?.[1];
  if (!base) return false;
  const baseTokens = identityTokens(base);
  return capabilities.some((capability) =>
    identitiesFor(capability).some((identity) => containsWords(baseTokens, identity.tokens)),
  );
}

/** Validate the resolver-owned semantic identity against the frozen catalog before Builder work. */
export function validateProposedOverlapIdentity(input: {
  readonly proposed: SeparateCapabilityIdentity;
  readonly targetCapabilityId: string;
  readonly capabilities: readonly CapabilityRow[];
}): void {
  if (!input.capabilities.some((capability) => capability.id === input.targetCapabilityId)) {
    throw new OverlapIdentityValidationError(
      `The overlap source "${input.targetCapabilityId}" is not in the resolver catalog.`,
    );
  }
  if (
    hasMechanicalIdentity(input.proposed.id, input.capabilities) ||
    hasMechanicalIdentity(input.proposed.label, input.capabilities)
  ) {
    throw new OverlapIdentityValidationError(
      "A separate overlapping capability must use a meaningful identity, not a mechanical copy or version.",
    );
  }

  const proposed = [identityTokens(input.proposed.id), identityTokens(input.proposed.label)];
  for (const capability of input.capabilities) {
    const reused = identitiesFor(capability).find((existing) =>
      proposed.some((identity) => sameWords(identity, existing.tokens)),
    );
    if (reused === undefined) continue;
    const shown = canonicalCapabilityLabel(capability);
    const naming = reused.name === shown ? `"${shown}"` : `"${reused.name}" (shown as "${shown}")`;
    throw new OverlapIdentityValidationError(
      `A separate overlapping capability cannot reuse the identity ${naming}.`,
    );
  }
}

/** Bind the Builder result to the resolver-owned identity before any migration or unit work. */
export function validateBuiltOverlapIdentity(input: {
  readonly proposed: SeparateCapabilityIdentity;
  readonly spec: Pick<CapabilitySpec, "id" | "label">;
}): void {
  if (input.spec.id !== input.proposed.id || input.spec.label !== input.proposed.label) {
    throw new OverlapIdentityValidationError(
      "The built overlap identity must exactly match the resolver's semantic id and label.",
    );
  }
}
