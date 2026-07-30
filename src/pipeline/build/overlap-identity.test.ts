import { describe, expect, test } from "bun:test";
import { notesCapabilityRow } from "../../app/app.test-support.ts";
import type { CapabilitySpec } from "../../registry/index.ts";
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
  });

  test.each([
    ["contacts_2", "Contacts 2"],
    ["contacts2", "Contacts"],
    ["contacts_v2", "Contacts"],
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
  });
});
