// Deflection and duplicate detection — what the pipeline does with a prompt it
// recognizes but will not build.
//
// Two related concerns: the warm, product-voice line shown when an intent is
// understood but not yet actionable (extend, ui_change, data_query, reject), and the
// lightweight token-overlap heuristic that catches a `new_capability` prompt that
// really restates one the user already has — deflecting it as an `extend_capability`
// rather than building a colliding duplicate.

import type { IntentClassification } from "../intent-resolver/index.ts";
import type { TokenUsage } from "../provider/index.ts";
import type { CapabilityRow } from "../registry/index.ts";

/**
 * The product-voice narration for a deflected intent — understood, not yet
 * actionable. A `new_capability` "deflection" reuses its own `user_facing_label`
 * (it is being built, not deflected); the others explain, gently, what Aluna can't
 * do yet (ARCH §9.7).
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
  "for",
  "keep",
  "let",
  "make",
  "me",
  "my",
  "of",
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

function duplicateCapabilityIdentityTokens(capability: CapabilityRow): Set<string> {
  return duplicateMatchTokens([capability.id, capability.label].join(" "), false);
}

function duplicateCapabilityContextTokens(capability: CapabilityRow): Set<string> {
  return duplicateMatchTokens(capability.prompt_context, true);
}

function duplicateScore(promptTokens: Set<string>, capabilityTokens: Set<string>): number {
  let score = 0;
  for (const token of promptTokens) {
    if (capabilityTokens.has(token)) score += 1;
  }
  return score;
}

function findPromptOverlapCapability(
  prompt: string,
  capabilities: readonly CapabilityRow[],
): CapabilityRow | undefined {
  const promptTokens = duplicateMatchTokens(prompt, true);
  if (promptTokens.size === 0) return undefined;

  let best: { readonly capability: CapabilityRow; readonly score: number } | undefined;
  for (const capability of capabilities) {
    const identityScore = duplicateScore(
      promptTokens,
      duplicateCapabilityIdentityTokens(capability),
    );
    const contextScore = duplicateScore(promptTokens, duplicateCapabilityContextTokens(capability));
    const score = identityScore > 0 || contextScore >= 2 ? identityScore + contextScore : 0;
    if (score > 0 && (!best || score > best.score)) {
      best = { capability, score };
    }
  }

  return best?.capability;
}

function duplicateIntentForCapability(capability: CapabilityRow): IntentClassification {
  return {
    type: "extend_capability",
    confidence: 1,
    target_capability: capability.id,
    proposed_action: "Add this to an existing place.",
    user_facing_label: "This belongs with something you've already started.",
    requires_confirmation: false,
  };
}

/**
 * The `extend_capability` intent for a prompt that overlaps an existing capability,
 * or `undefined` when nothing overlaps strongly enough. The overlap heuristic scores
 * identity tokens (id + label) and context tokens separately; a single identity hit,
 * or two context hits, is enough to treat the prompt as a restatement.
 */
export function duplicateIntentForPrompt(
  prompt: string,
  capabilities: readonly CapabilityRow[],
): IntentClassification | undefined {
  const overlap = findPromptOverlapCapability(prompt, capabilities);
  return overlap ? duplicateIntentForCapability(overlap) : undefined;
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
