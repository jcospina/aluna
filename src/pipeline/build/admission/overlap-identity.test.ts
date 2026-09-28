import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { CapabilityRow, CapabilitySpec } from "../../../registry/index.ts";
import { notesCapabilityRow } from "../../../server/app.test-support.ts";
import {
  OverlapIdentityValidationError,
  validateBuiltOverlapIdentity,
  validateProposedOverlapIdentity,
} from "./overlap-identity.ts";

const contacts = notesCapabilityRow({
  id: "contacts",
  label: "Contacts",
  prompt_context: "Stores personal contacts.",
});

function identity(id: string, label: string): Pick<CapabilitySpec, "id" | "label"> {
  return { id, label };
}

function capability(
  id: string,
  label: string,
  display_label_override: string | null = null,
): CapabilityRow {
  return notesCapabilityRow({ id, label, display_label_override });
}

/** Propose `id`/`label` as a separate capability overlapping the first capability listed. */
function proposing(
  id: string,
  label: string,
  capabilities: readonly CapabilityRow[] = [contacts],
): () => void {
  return () =>
    validateProposedOverlapIdentity({
      proposed: identity(id, label),
      targetCapabilityId: capabilities[0]?.id ?? "",
      capabilities,
    });
}

function refusal(propose: () => void): Error {
  try {
    propose();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the proposal to be refused");
}

const word = (pattern: RegExp) => fc.stringMatching(pattern);

describe("separate semantic-overlap identity guard", () => {
  test("accepts resolver-owned semantic synonyms without platform domain logic", () => {
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).not.toThrow();
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("professional_address_book", "Professional address book"),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).not.toThrow();
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("copy_editors", "Copy editors"),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).not.toThrow();
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("version_notes", "Version notes"),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).not.toThrow();
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("studio_54", "Studio 54"),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).not.toThrow();
  });

  test("does not treat empty ASCII token projections of Unicode labels as collisions", () => {
    const japaneseContacts = notesCapabilityRow({
      id: "personal_contacts",
      label: "連絡先",
      prompt_context: "Stores personal contacts.",
    });
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("work_contacts", "仕事の連絡先"),
        targetCapabilityId: "contacts",
        capabilities: [contacts, japaneseContacts],
      }),
    ).not.toThrow();
  });

  test.each([
    ["contacts_2", "Contacts 2"],
    ["contacts2", "Contacts"],
    ["contacts_v2", "Contacts"],
    ["work_contacts_2", "Work contacts 2"],
    ["work_contacts", "Contacts"],
    ["contacts", "Work contacts"],
  ])("rejects mechanical or one-sided catalog collisions %s / %s", (id, label) => {
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity(id, label),
        targetCapabilityId: "contacts",
        capabilities: [contacts],
      }),
    ).toThrow(OverlapIdentityValidationError);
  });

  test("rejects an identity already owned by another capability", () => {
    const workContacts = notesCapabilityRow({
      id: "work_contacts",
      label: "Work contacts",
      prompt_context: "Stores work contacts.",
    });
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        targetCapabilityId: "contacts",
        capabilities: [contacts, workContacts],
      }),
    ).toThrow(/cannot reuse/i);
  });

  test("rejects a namespace whose overlap source is absent from the catalog", () => {
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        targetCapabilityId: "missing",
        capabilities: [contacts],
      }),
    ).toThrow(/not in the resolver catalog/i);
    expect(() =>
      validateProposedOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        targetCapabilityId: "contacts",
        capabilities: [],
      }),
    ).toThrow(/not in the resolver catalog/i);
  });
});

describe("built separate-capability identity binding", () => {
  test("binds the Builder result to the resolver-owned identity", () => {
    expect(() =>
      validateBuiltOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        spec: identity("work_contacts", "Work contacts"),
      }),
    ).not.toThrow();
    expect(() =>
      validateBuiltOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        spec: identity("contacts2", "Contacts"),
      }),
    ).toThrow(/exactly match/i);
    expect(() =>
      validateBuiltOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        spec: identity("work_contacts", "WORK CONTACTS"),
      }),
    ).toThrow(/exactly match/i);
    expect(() =>
      validateBuiltOverlapIdentity({
        proposed: identity("work_contacts", "Work contacts"),
        spec: identity("work_contacts", " Work contacts "),
      }),
    ).toThrow(/exactly match/i);
  });
});

describe("one name, however it is inflected or cased", () => {
  test("a word and its plural name the same capability", () => {
    fc.assert(
      fc.property(
        word(/^[a-z]{3,10}$/).filter((w) => !w.endsWith("s")),
        (singular) => {
          const plural = capability(`${singular}s`, `${singular}s`);
          expect(proposing(singular, singular, [plural])).toThrow(OverlapIdentityValidationError);
        },
      ),
      { seed: 1, numRuns: 200 },
    );
  });

  test("a consonant-y word and its -ies plural name the same capability", () => {
    fc.assert(
      fc.property(word(/^[a-z]{1,8}[b-df-hj-np-tv-xz]$/), (stem) => {
        const plural = capability(`${stem}ies`, `${stem}ies`);
        expect(proposing(`${stem}y`, `${stem}y`, [plural])).toThrow(OverlapIdentityValidationError);
      }),
      { seed: 1, numRuns: 200 },
    );
    expect(
      proposing("recipe_category", "Recipe category", [
        capability("recipe_categories", "Recipe categories"),
      ]),
    ).toThrow(OverlapIdentityValidationError);
  });

  test("a name ending in -ie and one ending in -y are two names", () => {
    for (const [existing, proposed] of [
      ["July Expenses", "Julie Expenses"],
      ["Mary Recipes", "Marie Recipes"],
      ["Katy Notes", "Katie Notes"],
      ["Carry On", "Carrie On"],
      ["Birdy", "Birdie"],
    ] as const) {
      const catalog = [capability(existing.toLowerCase().replace(" ", "_"), existing)];
      expect(proposing(proposed.toLowerCase().replace(" ", "_"), proposed, catalog)).not.toThrow();
    }
  });

  test("a word ending in -ie and its plural name the same capability", () => {
    for (const [singular, plural] of [
      ["Movie", "Movies"],
      ["Cookie", "Cookies"],
      ["Selfie", "Selfies"],
    ] as const) {
      const existing = capability(plural.toLowerCase(), plural);
      expect(proposing(singular.toLowerCase(), singular, [existing])).toThrow(
        OverlapIdentityValidationError,
      );
      expect(proposing("new_list", `${singular} 2`, [existing])).toThrow(/meaningful identity/);
    }
  });

  test("a four-letter plural in -ies drops only its s", () => {
    expect(proposing("pie", "Pie", [capability("pies", "Pies")])).toThrow(
      OverlapIdentityValidationError,
    );
  });

  test("a three-letter word ending in s is not read as a plural", () => {
    expect(proposing("ga", "GA", [capability("gas", "Gas")])).not.toThrow();
  });

  test("words that differ only in their last letter stay distinct", () => {
    expect(proposing("word_log", "Word log", [capability("work_log", "Work log")])).not.toThrow();
  });

  test("letter case never makes a new name", () => {
    expect(proposing("address_book", "CONTACTS")).toThrow(OverlapIdentityValidationError);
  });

  test("a one-letter word adds nothing to a name, a two-letter word does", () => {
    const readingList = capability("reading_list", "Reading list");
    expect(proposing("a_reading_list", "A reading list", [readingList])).toThrow(
      OverlapIdentityValidationError,
    );
    expect(proposing("tv_shows", "TV shows", [capability("shows", "Shows")])).not.toThrow();
  });

  test("a narrower existing name does not claim a broader one", () => {
    const workContacts = capability("work_contacts", "Work contacts");
    expect(proposing("contacts", "Contacts", [workContacts])).not.toThrow();
  });
});

describe("every name an existing capability answers to", () => {
  const renamed = capability("contacts", "Contacts", "People");

  test("a renamed capability collides on its new name and on its old one", () => {
    expect(proposing("people", "People", [renamed])).toThrow(OverlapIdentityValidationError);
    expect(proposing("address_book", "Contacts", [renamed])).toThrow(
      OverlapIdentityValidationError,
    );
  });

  test("a collision names the identity it reused and the name the desk shows", () => {
    const error = refusal(proposing("address_book", "Contacts", [renamed]));
    expect(error.message).toContain(`"${renamed.id}" (shown as "People")`);
    const unrenamed = refusal(proposing("contacts", "Address book", [contacts]));
    expect(unrenamed.message).toContain(`"${contacts.id}" (shown as "${contacts.label}")`);
    const people = capability("people", "Contacts");
    const byLabel = refusal(proposing("address_book", "Contact", [people]));
    expect(byLabel.message).toContain(`"${people.label}"`);
    expect(byLabel.message).not.toContain("shown as");
  });

  test("a copy number on either the new or the old name is mechanical", () => {
    expect(proposing("address_book", "People 10", [renamed])).toThrow(
      OverlapIdentityValidationError,
    );
    expect(proposing("address_book", "Contacts 10", [renamed])).toThrow(
      OverlapIdentityValidationError,
    );
  });

  test("a label matching a capability whose id differs still collides", () => {
    const people = capability("people", "Contacts");
    expect(proposing("address_book", "Contacts", [people])).toThrow(OverlapIdentityValidationError);
  });

  test("a collision in a larger catalog names the capability it collides with", () => {
    const workContacts = capability("work_contacts", "Work contacts");
    const error = refusal(proposing("work_contacts", "Office staff", [contacts, workContacts]));
    expect(error).toBeInstanceOf(OverlapIdentityValidationError);
    expect(error.name).toBe(OverlapIdentityValidationError.name);
    expect(error.message).toContain(workContacts.label);
  });
});

describe("a copy or version number", () => {
  const catalog = [contacts, notesCapabilityRow()];

  test.each([
    ["contacts10", "Contacts10"],
    ["contacts_v10", "Contacts v10"],
    ["contacts_version_10", "Contacts version 10"],
    ["address_book", "ContactsV10"],
    ["address_book", "Contacts - 10"],
    ["address_book", "  Contacts 10  "],
    ["contacts_10", "Address book"],
  ])("is mechanical on an existing name however it is attached: %s / %s", (id, label) => {
    const error = refusal(proposing(id, label, catalog));
    expect(error).toBeInstanceOf(OverlapIdentityValidationError);
    expect(error.name).toBe(OverlapIdentityValidationError.name);
    expect(error.message).not.toBe("");
  });

  test("follows only a bare v or version, not a word that happens to continue with v", () => {
    const studio = capability("studio", "Studio");
    expect(proposing("studiovision2025", "Studio Vision", [studio])).not.toThrow();
  });

  test("inside a name is not a copy number", () => {
    const photos = capability("photos", "Photos");
    expect(proposing("photos_from_the_1990s", "Photos from the 1990s", [photos])).not.toThrow();
  });

  test("is a different name when it differs from an existing name's number", () => {
    const route66 = capability("route_66", "Route 66");
    expect(proposing("route_662", "Route 662", [route66])).not.toThrow();
  });

  test("is mechanical only when the base contains every word of an existing name", () => {
    const workContacts = capability("work_contacts", "Work contacts");
    expect(proposing("work_notes_2", "Work notes 2", [contacts, workContacts])).not.toThrow();
  });

  test("never becomes mechanical because a Unicode-only label has no ASCII words", () => {
    const japaneseContacts = capability("personal_contacts", "連絡先");
    expect(proposing("studio_54", "Studio 54", [contacts, japaneseContacts])).not.toThrow();
  });
});

test("the built identity must match the resolver's id even when the label matches", () => {
  expect(() =>
    validateBuiltOverlapIdentity({
      proposed: identity("work_contacts", "Work contacts"),
      spec: identity("contacts", "Work contacts"),
    }),
  ).toThrow(OverlapIdentityValidationError);
});
