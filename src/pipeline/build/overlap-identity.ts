import type { CapabilityRow, CapabilitySpec } from "../../registry/index.ts";

interface SeparateCapabilityIdentity {
  readonly id: string;
  readonly label: string;
}

export class OverlapIdentityValidationError extends Error {
  override readonly name = "OverlapIdentityValidationError";
}

function normalizeToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function identityTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .match(/[a-z]+|[0-9]+/g)
    ?.map(normalizeToken)
    .filter((token) => token.length >= 2);
  return new Set(tokens ?? []);
}

function sameTokens(left: Set<string>, right: Set<string>): boolean {
  return left.size > 0 && left.size === right.size && [...left].every((token) => right.has(token));
}

function containsIdentityTokens(container: Set<string>, identity: Set<string>): boolean {
  return identity.size > 0 && [...identity].every((token) => container.has(token));
}

function identitiesFor(capability: Pick<CapabilityRow, "id" | "label">): readonly Set<string>[] {
  return [identityTokens(capability.id), identityTokens(capability.label)];
}

/**
 * A trailing number/version is mechanical only when the text before it still names an
 * existing capability. This catches Contacts 2 / contacts_v2 / Work contacts 2 while
 * leaving semantic numbers such as Studio 54 to the resolver instead of growing a domain
 * blacklist inside deterministic platform code.
 */
function hasMechanicalIdentity(
  value: string,
  capabilities: readonly Pick<CapabilityRow, "id" | "label">[],
): boolean {
  const match = /^(.*?)(?:[_\s-]*(?:v(?:ersion)?[_\s-]*)?\d+)$/i.exec(value.trim());
  const base = match?.[1];
  if (!base) return false;
  const baseTokens = identityTokens(base);
  return capabilities.some((capability) =>
    identitiesFor(capability).some((identity) => containsIdentityTokens(baseTokens, identity)),
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
  const collision = input.capabilities.find((capability) =>
    proposed.some((identity) =>
      identitiesFor(capability).some((existing) => sameTokens(identity, existing)),
    ),
  );
  if (collision) {
    throw new OverlapIdentityValidationError(
      `A separate overlapping capability cannot reuse the identity "${collision.label}".`,
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
