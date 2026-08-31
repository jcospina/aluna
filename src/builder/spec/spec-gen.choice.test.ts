// What the spec-generation prompt says about a choice — the shape of an option, the shape
// of a group, and which of the three controls to reach for.
//
// The control clauses are the part worth pinning: the design has a control for a long list,
// one for a short set read all at once, and one for two or three states switched between,
// and they are chosen for what the set is *like* rather than for how many options it has.
// A model told only the enum picks the first member every time.

import { describe, expect, test } from "bun:test";
import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
} from "./spec-gen.test-support.ts";
import { buildSpecPrompt } from "./spec-gen.ts";

function choicePrompt(): string {
  const { send } = recordingSend();
  return buildSpecPrompt({
    provider: makeSpecProvider(notesSpec()),
    prompt: "track my notes",
    intent: notesIntent(),
    send,
  });
}

describe("spec generation stage — the choice contract in the prompt", () => {
  test("states what a choice declares, and that no other field declares it", async () => {
    const prompt = choicePrompt();

    expect(prompt).toContain("a field declares values and groups only when its type is choice");
    expect(prompt).toContain("An option is { value, label, group, note, disabled }");
    expect(prompt).toContain("send null for group, note and disabled when the option has none");
    expect(prompt).toContain("an ordered array of { id, heading }");
    expect(prompt).toContain("Every declared group must be named by at least one option");
    expect(prompt).toContain(
      "ui_intent.form.choice_inputs contains exactly one { field, presentation } entry",
    );
    expect(prompt).toContain("choice presentation is exactly picker | radio | segmented");
  });

  test("teaches what each of the three controls is for, and what segmented cannot show", () => {
    const prompt = choicePrompt();

    // A control is chosen for what the set is like, never for how long it is.
    expect(prompt).toContain("never inferred from how many options there happen to be");
    // Each control says what it is for, with an example a model can recognize.
    expect(prompt).toContain("picker is a drawn dropdown that stays one row tall");
    expect(prompt).toContain("radio stands every option in a column");
    expect(prompt).toContain("segmented is one joined row of buttons");
    expect(prompt).toContain("feed and grid, draft and published, day and week and month");
    // And the one combination the spec gate refuses is stated where it is authored.
    expect(prompt).toContain(
      "a field drawn as segmented must declare no groups and no option notes; declaring either is refused",
    );
  });

  test("names every platform-owned refusal a capability must never author", () => {
    const prompt = choicePrompt();
    expect(prompt).toContain(
      "record_not_found, invalid_choice, choice_disabled and max_length_exceeded are platform-owned",
    );
  });
});
