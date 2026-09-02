// Deflection and duplicate detection — what the pipeline does with a prompt it
// recognizes but will not build.
//
// Two related concerns: the warm, product-voice line shown when an intent is
// understood but not yet actionable (extend, ui_change, data_query, reject), and the
// lightweight token-overlap heuristic that catches a `new_capability` prompt that
// really restates one the user already has — deflecting it as an `extend_capability`
// rather than building a colliding duplicate.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { TokenUsage } from "../../platform/provider/index.ts";
import { type CapabilityRow, canonicalCapabilityLabel } from "../../registry/index.ts";

/**
 * The product-voice narration for a deflected intent — understood, not yet
 * actionable. A `new_capability` "deflection" reuses its own `user_facing_label`
 * (it is being built, not deflected); the others explain, gently, what Aluna can't
 * do yet.
 */
export function deflectionNarration(intent: IntentClassification): string {
  switch (intent.type) {
    case "extend_capability":
      return "I can tell this belongs with something you've already started here. I can't change that place yet, but I'll be able to soon.";
    case "ui_change":
      return "I hear how you'd like this to feel. I can't reshape the space yet, but I'll be able to soon.";
    case "data_query":
      return "I can see you're asking about what you've saved. I can't answer across your things yet, but I'll be able to soon.";
    case "reject":
      return "I'm not quite sure what to make from that yet. Try telling me one thing you'd like to keep track of.";
    case "new_capability":
      return intent.user_facing_label;
  }
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

/** The empty token usage recorded for a heuristic deflection — no provider call. */
export const NO_TOKEN_USAGE: TokenUsage = {
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
};

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
 * Every name this capability answers to. A rename gives it a second one, and it is the one
 * the person will type — while the sentence this deflection ends in is already written
 * with it (`canonicalCapabilityLabel`, below). Matching on the authored name alone is how
 * "journal" fails to find the capability the desk plainly calls Journal.
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
 * The `extend_capability` intent for a prompt that overlaps an existing capability,
 * or `undefined` when the prompt adds any meaningful qualifier. This guard is
 * intentionally exact-only: semantic overlap such as "work contacts separately"
 * must reach the resolver with the complete registry so the model can distinguish
 * extension from a separately named capability.
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

/**
 * Re-route a model-classified `new_capability` to an `extend_capability` deflection
 * when the prompt overlaps an existing capability — the safety net for the resolver
 * proposing a brand-new build that would collide with one the user already has.
 * Non-`new_capability` intents pass through untouched.
 */
export function deflectDuplicateNewCapability(
  intent: IntentClassification,
  prompt: string,
  capabilities: readonly CapabilityRow[],
): IntentClassification {
  if (intent.type !== "new_capability") return intent;

  const duplicate = duplicateIntentForPrompt(prompt, capabilities);
  return duplicate ? { ...duplicate, confidence: Math.max(intent.confidence, 0.99) } : intent;
}
