// Shared fixtures for the choice-evolution suites: one committed capability carrying an
// active choice field, and the three ways a candidate is put to the platform — validated,
// refused, or reduced to the facts the Diff reads out of it.

import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../registry/index.ts";
import type { CapabilityDiff } from "../index.ts";
import { diffCapabilitySpec } from "../index.ts";
import {
  type CandidateDraft,
  candidateFrom,
  journalCapabilityRow,
} from "./candidate.test-support.ts";
import {
  CandidateValidationError,
  type CandidateValidationIssue,
  validateCandidateSpec,
} from "./candidate-validation.ts";
import { buildDependencyGenerationCatalog } from "./dependency-catalog.ts";

export type { CandidateDraft };
export { journalCapabilityRow };

export const COMMITTED_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

/** The journal, plus one committed active choice field and its form intent. */
export function journalWithChoice(lifecycle: "active" | "inactive" = "active"): CapabilityRow {
  const base = journalCapabilityRow();
  return journalCapabilityRow({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle,
          values: [...COMMITTED_OPTIONS],
          groups: [],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: lifecycle === "active" ? [{ field: "stage", presentation: "picker" }] : [],
      },
    },
  });
}

export function stageOf(draft: CandidateDraft) {
  const field = draft.schema.fields.find((candidate) => candidate.name === "stage");
  if (!field) throw new Error("the committed choice field is missing from the draft");
  return field;
}

export function validate(
  row: CapabilityRow,
  mutate: (draft: CandidateDraft) => void,
): CapabilitySpec {
  const draft = candidateFrom(row);
  mutate(draft);
  return validateCandidateSpec({
    committed: row,
    candidate: draft,
    dependencyCatalog: buildDependencyGenerationCatalog([row], row.id),
  });
}

export function rejection(
  row: CapabilityRow,
  mutate: (draft: CandidateDraft) => void,
): readonly CandidateValidationIssue[] {
  try {
    validate(row, mutate);
  } catch (error) {
    if (error instanceof CandidateValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected the candidate to be rejected");
}

export function factsFor(
  row: CapabilityRow,
  mutate: (draft: CandidateDraft) => void,
): readonly string[] {
  const candidate = validate(row, mutate);
  return diffCapabilitySpec(capabilitySpecFromRow(row), candidate).facts.map((fact) => fact.kind);
}

/** The same row, with the choice field among the fields the item renderer receives. */
export function shownOnTheCard(row: CapabilityRow): CapabilityRow {
  return journalCapabilityRow({
    schema: row.schema,
    ui_intent: { ...row.ui_intent, item: { ...row.ui_intent.item, shows: ["title", "stage"] } },
  });
}

/** The whole work plan one candidate buys, for the rows that assert more than the facts. */
export function workFor(
  row: CapabilityRow,
  mutate: (draft: CandidateDraft) => void,
): CapabilityDiff {
  return diffCapabilitySpec(capabilitySpecFromRow(row), validate(row, mutate));
}

/** The journal's choice field with its options already standing under two headings. */
export function groupedJournal(): CapabilityRow {
  const row = journalWithChoice();
  const fields = row.schema.fields.map((field) =>
    field.name === "stage"
      ? {
          ...field,
          values: [
            { value: "draft", label: "Draft", group: "open" },
            { value: "published", label: "Published", group: "closed" },
          ],
          groups: [
            { id: "open", heading: "Open" },
            { id: "closed", heading: "Closed" },
          ],
        }
      : field,
  );
  return journalCapabilityRow({ schema: { fields }, ui_intent: row.ui_intent });
}

/** The same field with both options under one heading, which a split can then divide. */
export function oneGroupJournal(): CapabilityRow {
  const row = journalWithChoice();
  const fields = row.schema.fields.map((field) =>
    field.name === "stage"
      ? {
          ...field,
          values: [
            { value: "draft", label: "Draft", group: "stages" },
            { value: "published", label: "Published", group: "stages" },
          ],
          groups: [{ id: "stages", heading: "Stages" }],
        }
      : field,
  );
  return journalCapabilityRow({ schema: { fields }, ui_intent: row.ui_intent });
}
