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
  return left.size === right.size && [...left].every((token) => right.has(token));
}

function hasMechanicalIdentity(value: string): boolean {
  return /(?:[_\s-]*(?:v(?:ersion)?[_\s-]*)?\d+)$/i.test(value.trim());
}

function identitiesFor(capability: Pick<CapabilityRow, "id" | "label">): readonly Set<string>[] {
  return [identityTokens(capability.id), identityTokens(capability.label)];
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
  if (hasMechanicalIdentity(input.proposed.id) || hasMechanicalIdentity(input.proposed.label)) {
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
  if (
    input.spec.id !== input.proposed.id ||
    input.spec.label.trim().toLocaleLowerCase() !== input.proposed.label.trim().toLocaleLowerCase()
  ) {
    throw new OverlapIdentityValidationError(
      "The built overlap identity must exactly match the resolver's semantic id and label.",
    );
  }
}
