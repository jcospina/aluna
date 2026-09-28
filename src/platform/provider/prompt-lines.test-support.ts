// Reading a model prompt in a test without holding a second copy of its wording. A prompt's copy
// is a person's to change; what a test can own is how one build differs from another, and which
// inputs a prompt carries. So these compare prompts line by line and look for inputs, never text.

function linesOf(prompt: string): string[] {
  return prompt.split("\n");
}

/** The lines of `after` that `before` does not carry, in `after`'s order. */
export function addedLines(before: string, after: string): string[] {
  const known = new Set(linesOf(before));
  return linesOf(after).filter((line) => !known.has(line));
}

/** The non-blank lines every prompt in `included` carries and no prompt in `excluded` does. */
export function linesOnlyIn(included: readonly string[], excluded: readonly string[]): string[] {
  const [first, ...rest] = included;
  if (first === undefined) return [];
  const others = rest.map((prompt) => new Set(linesOf(prompt)));
  const shut = new Set(excluded.flatMap(linesOf));
  return linesOf(first).filter(
    (line) => line.trim() !== "" && !shut.has(line) && others.every((set) => set.has(line)),
  );
}

/** Every line that names all of `words`. */
export function linesNaming(prompt: string, words: readonly (string | number)[]): string[] {
  return linesOf(prompt).filter((line) => words.every((word) => line.includes(String(word))));
}

/** How many times `needle` occurs in `text`, counting non-overlapping matches. */
export function occurrences(text: string, needle: string): number {
  return needle === "" ? 0 : text.split(needle).length - 1;
}
