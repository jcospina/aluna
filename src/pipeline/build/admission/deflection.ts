// What the pipeline says to a prompt it will not build.
//
// A refusal gets one warm, product-voice line. A prompt whose words name a capability the person
// already has is caught before the resolver runs: an exact match of its words against each
// capability's names turns it into an `extend_capability` deflection, and nothing is built.

import { type CapabilityRow, canonicalCapabilityLabel } from "../../../registry/index.ts";
import type { IntentClassification } from "../../intent/index.ts";

/** What she says to a sentence she could not make anything of. 6.6/03 is where this is used. */
export const REJECT_DEFLECTION =
  "I'm not quite sure what to make from that yet. Try telling me one thing you'd like to keep track of.";

/** Thrown when an intent that is acted on rather than deflected reaches the deflection line. */
export class NotDeflectableError extends Error {
  override readonly name = "NotDeflectableError";
}

/**
 * The product-voice narration for a deflected intent. Only a refusal reaches here without a line of
 * its own: a question is answered in the answer window (6.5/03) and every other intent builds.
 */
export function deflectionNarration(intent: IntentClassification): string {
  if (intent.type === "reject") return REJECT_DEFLECTION;
  throw new NotDeflectableError(`A ${intent.type} intent is acted on, never deflected.`);
}

const DUPLICATE_PROMPT_STOP_WORDS = new Set([
  "add",
  "and",
  "build",
  "create",
  "for",
  "keep",
  "let",
  "make",
  "me",
  "my",
  "of",
  "please",
  "save",
  "set",
  "store",
  "the",
  "to",
  "track",
  "want",
  "with",
]);

function normalizeDuplicateToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function duplicateMatchTokens(value: string, applyStopWords: boolean): Set<string> {
  const tokens = value
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map(normalizeDuplicateToken)
    .filter(
      (token) => token.length >= 3 && (!applyStopWords || !DUPLICATE_PROMPT_STOP_WORDS.has(token)),
    );

  return new Set(tokens ?? []);
}

function sameTokens(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((token) => right.has(token));
}

/**
 * Every name this capability answers to. A rename adds the name the person will actually type,
 * and matching the authored name alone is how "journal" misses the tile the desk calls Journal.
 */
function duplicateCapabilityIdentityTokens(capability: CapabilityRow): readonly Set<string>[] {
  return [
    duplicateMatchTokens(capability.id, false),
    duplicateMatchTokens(capability.label, false),
    duplicateMatchTokens(canonicalCapabilityLabel(capability), false),
  ];
}

function findPromptOverlapCapability(
  prompt: string,
  capabilities: readonly CapabilityRow[],
): CapabilityRow | undefined {
  const promptTokens = duplicateMatchTokens(prompt, true);
  if (promptTokens.size === 0) return undefined;

  const matches = capabilities.filter((capability) =>
    duplicateCapabilityIdentityTokens(capability).some((identity) =>
      sameTokens(promptTokens, identity),
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function duplicateIntentForCapability(capability: CapabilityRow): IntentClassification {
  return {
    type: "extend_capability",
    confidence: 1,
    target_capability: capability.id,
    resolution: "extend",
    proposed_identity: null,
    proposed_action: "Add this to an existing place.",
    user_facing_label: "This belongs with something you've already started.",
    requires_confirmation: false,
  };
}

/**
 * The `extend_capability` intent for a prompt overlapping an existing capability. Exact-only on
 * purpose: only the resolver, holding the whole registry, can place "work contacts separately".
 */
export function duplicateIntentForPrompt(
  prompt: string,
  capabilities: readonly CapabilityRow[],
): IntentClassification | undefined {
  const overlap = findPromptOverlapCapability(prompt, capabilities);
  return overlap ? duplicateIntentForCapability(overlap) : undefined;
}

/** Explain a deterministic duplicate in the language of the place already on screen. */
export function existingCapabilityNarration(
  intent: IntentClassification,
  capabilities: readonly CapabilityRow[],
): string {
  const target = capabilities.find((capability) => capability.id === intent.target_capability);
  const label = target ? canonicalCapabilityLabel(target) : "this place";
  return `You already have ${label}, so I didn't create another one.`;
}
