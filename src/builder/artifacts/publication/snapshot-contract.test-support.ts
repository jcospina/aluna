// What a published version holds on disk. Four suites asserted the same nine names, and the
// tier-on list differed from the tier-off one by one entry.
//
// Written out rather than derived from `SPEC_FILE` and `DERIVED_UNIT_FILES`. Those are the same
// constants `assertManifestShape` builds its expectation from, so a helper reading them would
// compare the inventory to itself and let a renamed artifact through every suite. This list is
// the pin: renaming one is meant to redden it.

const PUBLISHED_FILES = [
  "create.ts",
  "delete.ts",
  "item.ts",
  "read.ts",
  "search.ts",
  "snapshot.json",
  "spec.json",
  "update.ts",
] as const;

/** The frozen suite, published only when the behavioral tier is on. */
const FROZEN_BEHAVIORAL_TESTS = "tests/behavioral.json";

/** Every file a verified snapshot carries, in the sorted order a disk listing comes back in. */
export function publishedSnapshotFiles(behavioralTier: "on" | "off"): string[] {
  const files: string[] = [...PUBLISHED_FILES];
  if (behavioralTier === "on") files.push(FROZEN_BEHAVIORAL_TESTS);
  return files.sort();
}
