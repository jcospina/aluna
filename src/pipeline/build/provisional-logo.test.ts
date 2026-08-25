import { describe, expect, test } from "bun:test";

import type { IntentClassification } from "../../intent-resolver/index.ts";
import {
  provisionalLogoLabel,
  renderProvisionalLogoSwap,
  UNNAMED_PROVISIONAL_LOGO_LABEL,
} from "./provisional-logo.ts";

function intent(overrides: Partial<IntentClassification> = {}): IntentClassification {
  return {
    type: "new_capability",
    confidence: 0.9,
    target_capability: null,
    resolution: "new",
    proposed_identity: null,
    proposed_action: "Create a recipes capability.",
    user_facing_label: "Got it. I'm putting that together now.",
    requires_confirmation: false,
    ...overrides,
  } as IntentClassification;
}

describe("what is written under the tile while a build runs", () => {
  test("a separate capability wears the name its identity was bound to", () => {
    // The one case resolution really does name: `namespace` binds the meaningful
    // distinction before any Builder work, so the tile can say "Work contacts" rather
    // than a placeholder.
    expect(
      provisionalLogoLabel(
        intent({
          resolution: "namespace",
          target_capability: "contacts",
          proposed_identity: { id: "work_contacts", label: "Work contacts" },
        }),
      ),
    ).toBe("Work contacts");
  });

  test("the resolver's line is used only when it came back as a name", () => {
    expect(provisionalLogoLabel(intent({ user_facing_label: "Recipes" }))).toBe("Recipes");
  });

  test("a warm sentence never ends up written on the desk", () => {
    // `user_facing_label` is one warm product-voice sentence, and the tile's name is a
    // name. Writing the sentence there would put "Got it. I'm putting that together now."
    // under a 64px tile, which is neither true nor readable.
    expect(provisionalLogoLabel(intent())).toBe(UNNAMED_PROVISIONAL_LOGO_LABEL);
    expect(provisionalLogoLabel(intent({ user_facing_label: "I'll keep those separate." }))).toBe(
      UNNAMED_PROVISIONAL_LOGO_LABEL,
    );
    // Pinned as a literal, like the blank-prompt line: it is copy a user reads on the
    // desk, so it does not get to change by being compared only against itself.
    expect(UNNAMED_PROVISIONAL_LOGO_LABEL).toBe("Something new");
  });

  test("a sentence-shaped proposed identity falls through rather than being trusted", () => {
    expect(
      provisionalLogoLabel(
        intent({
          resolution: "namespace",
          target_capability: "contacts",
          proposed_identity: {
            id: "work_contacts",
            label: "We'll keep your work contacts separate from the rest.",
          },
          user_facing_label: "Work contacts",
        }),
      ),
    ).toBe("Work contacts");
  });

  test("the swap writes the derived name, not the resolver's line", () => {
    // The one thing this wrapper decides. What the sidecar itself looks like is pinned
    // where it is rendered (`src/web/fragments.test.ts`).
    expect(renderProvisionalLogoSwap("build-42", intent())).toContain(
      `<span class="logo-label">${UNNAMED_PROVISIONAL_LOGO_LABEL}</span>`,
    );
  });
});
