// Aluna's suggestion: no model, never enforced, and it only orders the chooser's list.

import { normalizeSearchText } from "../../platform/persistence/sqlite-functions.ts";
import type { SpecField } from "../../registry/index.ts";
import { type LinkEnd, linkableField } from "./rules.ts";

/**
 * The target to offer first, or none. A record noun matching the clicked field's name or label
 * outweighs a field name or label matching it, so `author` suggests Authors and its first
 * single-line text field ahead of another capability's field that is only called author.
 */
export function suggestedTarget<Target extends LinkEnd>(
  clicked: Pick<SpecField, "name" | "label">,
  targets: readonly Target[],
): Target | undefined {
  const asked = [clicked.name, clicked.label].map(words);
  let suggested: Target | undefined;
  let best = 0;
  for (const target of targets) {
    const score = suggestionScore(asked, target);
    if (score > best) [suggested, best] = [target, score];
  }
  return suggested;
}

function suggestionScore(asked: readonly (readonly string[])[], target: LinkEnd): number {
  const field = linkableField(target);
  const nouns = [target.row.noun, target.row.plural_noun].map(words);
  const names = field ? [field.name, field.label].map(words) : [];
  const namesNoun = asked.some((clicked) => nouns.some((noun) => covers(clicked, noun)));
  const namesField = asked.some((clicked) => names.some((name) => sameWords(clicked, name)));
  return (namesNoun ? 2 : 0) + (namesField ? 1 : 0);
}

/** Case and accents folded as search folds them, and split wherever a name or label breaks. */
function words(text: string): readonly string[] {
  return normalizeSearchText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** The clicked field names the noun when it holds every word of it: `author_name` names author. */
function covers(clicked: readonly string[], noun: readonly string[]): boolean {
  return noun.length > 0 && noun.every((word) => clicked.includes(word));
}

/** A field is called the same only in full: `name` alone does not call `Plant name` a name. */
function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length > 0 && left.length === right.length && left.every((word, at) => word === right[at])
  );
}
