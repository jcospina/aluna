import { describe, expect, test } from "bun:test";
import { notesCapabilityRow } from "../../../app/app.test-support.ts";
import { duplicateIntentForPrompt } from "./deflection.ts";

const contacts = notesCapabilityRow({
  id: "contacts",
  label: "Contacts",
  prompt_context: "Stores personal contacts, phone numbers, and addresses.",
});
const workContacts = notesCapabilityRow({
  id: "work_contacts",
  label: "Work contacts",
  prompt_context: "Stores work contacts separately from personal contacts.",
});

describe("deterministic exact-identity collision guard", () => {
  test("keeps exact capability restatements deterministic", () => {
    expect(duplicateIntentForPrompt("I want to keep track of my contacts", [contacts])).toEqual({
      type: "extend_capability",
      confidence: 1,
      target_capability: "contacts",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add this to an existing place.",
      user_facing_label: "This belongs with something you've already started.",
      requires_confirmation: false,
    });
    expect(duplicateIntentForPrompt("please create contacts", [contacts])).toMatchObject({
      target_capability: "contacts",
      type: "extend_capability",
    });
  });

  test("lets qualified semantic overlap reach the full-catalog resolver", () => {
    expect(
      duplicateIntentForPrompt("track my work contacts separately", [contacts]),
    ).toBeUndefined();
    expect(duplicateIntentForPrompt("save client phone numbers", [contacts])).toBeUndefined();
  });

  test("does not treat a subset of a longer identity as an exact collision", () => {
    expect(duplicateIntentForPrompt("track contacts", [workContacts])).toBeUndefined();
    expect(duplicateIntentForPrompt("track my contacts", [workContacts])).toBeUndefined();
  });

  test("fails open to the resolver when more than one capability has the exact identity", () => {
    const duplicateLabel = notesCapabilityRow({
      id: "personal_contacts",
      label: "Contacts",
      prompt_context: "Stores personal contacts.",
    });
    expect(duplicateIntentForPrompt("contacts", [contacts, duplicateLabel])).toBeUndefined();
  });
});
