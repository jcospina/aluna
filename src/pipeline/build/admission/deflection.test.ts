import { describe, expect, test } from "bun:test";
import { notesCapabilityRow, REJECT_INTENT } from "../../../server/app.test-support.ts";
import { INTENT_TYPES } from "../../intent/index.ts";
import {
  DUPLICATE_PROMPT_STOP_WORDS,
  deflectionNarration,
  duplicateIntentForPrompt,
  NotDeflectableError,
  REJECT_DEFLECTION,
} from "./deflection.ts";

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

  test("reads a plural and its singular as one name, whichever way the -ies came", () => {
    const movies = notesCapabilityRow({ id: "movies", label: "Movies" });
    const stories = notesCapabilityRow({ id: "stories", label: "Stories" });
    expect(duplicateIntentForPrompt("track my movie", [movies])).toMatchObject({
      target_capability: movies.id,
    });
    expect(duplicateIntentForPrompt("keep my story", [stories])).toMatchObject({
      target_capability: stories.id,
    });
  });

  test("hears past every word a request is phrased with, however it is inflected", () => {
    for (const word of DUPLICATE_PROMPT_STOP_WORDS) {
      for (const spoken of word.length >= 3 ? [word, `${word}s`] : [word]) {
        expect({
          spoken,
          intent: duplicateIntentForPrompt(`${spoken} contacts`, [contacts]),
        }).toMatchObject({
          spoken,
          intent: { target_capability: contacts.id },
        });
      }
    }
  });

  test("keeps a name ending in -ie apart from one ending in -y", () => {
    const july = notesCapabilityRow({ id: "july", label: "July" });
    expect(duplicateIntentForPrompt("track julie", [july])).toBeUndefined();
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

describe("the line a deflection speaks", () => {
  test("only a refusal has one; every intent that is acted on throws instead of speaking", () => {
    expect(deflectionNarration(REJECT_INTENT)).toBe(REJECT_DEFLECTION);
    for (const type of INTENT_TYPES.filter((type) => type !== "reject")) {
      expect(() => deflectionNarration({ ...REJECT_INTENT, type })).toThrow(NotDeflectableError);
    }
  });
});
