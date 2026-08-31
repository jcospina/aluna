// The normative change-fact matrix, one case per row: the candidate that produces the row's
// fact, and the four columns it must project — platform/schema work, regenerated units,
// DDL, and the Action suites the tier-on column selects. The battery that runs each case
// end to end through the engine is `evolution-matrix.test.ts`.

import { notesSpec } from "../../builder/gate/gate.test-support.ts";
import type { GeneratedUnitName, PlatformWorkKind } from "../../builder/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  type CapabilityTool,
} from "../../registry/index.ts";
import { committedSpec } from "./evolution-run.test-support.ts";

function withUiIntent(overrides: Partial<CapabilitySpec["ui_intent"]>): CapabilitySpec {
  return notesSpec({ ui_intent: { ...committedSpec().ui_intent, ...overrides } });
}

function withFields(fields: CapabilitySpec["schema"]["fields"]): CapabilitySpec {
  return notesSpec({ schema: { fields } });
}

export interface MatrixCase {
  /** The matrix row this case is the end-to-end proof of. */
  readonly row: string;
  readonly intent: string;
  readonly candidate: () => CapabilitySpec;
  readonly facts: readonly string[];
  readonly platformWork: readonly PlatformWorkKind[];
  readonly regenerated: readonly GeneratedUnitName[];
  readonly ddl: readonly string[];
  /** The Action suites the tier-on column selects; omitted means none. */
  readonly tests?: readonly CapabilityTool[];
  readonly fullSuite?: boolean;
}

export const MATRIX: readonly MatrixCase[] = [
  {
    row: "capability label → registry + logo/View copy, no units",
    intent: "call these my jottings",
    candidate: () => notesSpec({ label: "Jottings" }),
    facts: ["capability_label"],
    platformWork: ["registry_and_view_copy"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "empty-state noun → platform copy, no units",
    intent: "call each one an entry",
    candidate: () => notesSpec({ noun: "entry" }),
    facts: ["empty_state_noun"],
    platformWork: ["platform_empty_state_copy"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "prompt_context → resolver catalog, no units",
    intent: "describe these better",
    candidate: () => notesSpec({ prompt_context: "Stores the user's short written notes." }),
    facts: ["prompt_context"],
    platformWork: ["resolver_catalog"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "field order only → platform form order, no units",
    intent: "show pinned before the text",
    candidate: () => withFields([...committedSpec().schema.fields].reverse()),
    facts: ["field_order"],
    platformWork: ["platform_field_order"],
    regenerated: [],
    ddl: [],
  },
  {
    row: "new active text field → ADD COLUMN, create/update, plus search for text",
    intent: "add a mood I can search",
    candidate: () =>
      withFields([
        ...committedSpec().schema.fields,
        { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
      ]),
    facts: ["new_active_field"],
    platformWork: ["add_column", "platform_form_detail"],
    regenerated: ["create", "update", "search"],
    ddl: ['ALTER TABLE "cap_notes" ADD COLUMN "mood" TEXT;'],
    tests: ["create", "update", "search"],
  },
  {
    // Requiredness and its error contract are coupled by candidate validation: the
    // `missing_required_fields` cases must name exactly the active required fields. So a
    // requiredness change is always at least a two-fact evolution, and its unioned effect
    // is what the matrix's two rows add up to.
    row: "new active choice field → ADD COLUMN, create/update, plus search like any text",
    intent: "let me mark each note with a stage",
    candidate: () => {
      const base = committedSpec();
      return notesSpec({
        schema: {
          fields: [
            ...base.schema.fields,
            {
              name: "stage",
              label: "Stage",
              type: "choice",
              required: false,
              lifecycle: "active",
              values: [
                { value: "draft", label: "Draft" },
                { value: "sent", label: "Sent" },
              ],
              groups: [],
            },
          ],
        },
        ui_intent: {
          ...base.ui_intent,
          form: {
            ...base.ui_intent.form,
            choice_inputs: [{ field: "stage", presentation: "picker" }],
            long_text: [],
            guidance: [],
          },
        },
      });
    },
    facts: ["new_active_field"],
    platformWork: ["add_column", "platform_form_detail"],
    regenerated: ["create", "update", "search"],
    ddl: ['ALTER TABLE "cap_notes" ADD COLUMN "stage" TEXT;'],
    tests: ["create", "update", "search"],
  },
  {
    row: "required change → resulting-record validation + error contract, create/update",
    intent: "let me start a note before I've written anything in it",
    candidate: () =>
      notesSpec({
        schema: {
          fields: committedSpec().schema.fields.map((field) =>
            field.name === "text" ? { ...field, required: false } : field,
          ),
        },
        // No active required field left, so the missing_required_fields contract is empty.
        behavioral_errors: [],
      }),
    facts: ["required_change", "behavioral_errors"],
    platformWork: ["resulting_record_validation", "behavioral_error_contract"],
    regenerated: ["create", "update"],
    ddl: [],
    tests: ["create", "update"],
  },
  {
    row: "field label → platform form/detail; item only when the field is shown",
    intent: "call the text the body",
    candidate: () =>
      withFields(
        committedSpec().schema.fields.map((field) =>
          field.name === "text" ? { ...field, label: "Body" } : field,
        ),
      ),
    facts: ["field_label"],
    platformWork: ["platform_form_detail"],
    // `text` is in item.shows, so the renderer — and only the renderer — follows.
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "hide a field → no destructive DDL, create/update",
    intent: "stop tracking whether a note is pinned",
    candidate: () =>
      withFields(
        committedSpec().schema.fields.map((field) =>
          field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
        ),
      ),
    facts: ["field_lifecycle"],
    platformWork: ["platform_form_detail", "list_input_intent", "form_subset_intent"],
    regenerated: ["create", "update"],
    // Soft-hide never drops a column, so there is no DDL at all.
    ddl: [],
    tests: ["create", "update"],
  },
  {
    row: "item direction / item.shows → the item renderer alone",
    intent: "make each note quieter in the list",
    candidate: () =>
      withUiIntent({
        item: { direction: "A quiet card that leads with the note text.", shows: ["text"] },
      }),
    facts: ["item_presentation"],
    platformWork: [],
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "collection feed|grid → platform list container + the item renderer",
    intent: "lay my notes out as a grid",
    candidate: () => withUiIntent({ collection: { layout: "grid" } }),
    facts: ["collection_layout"],
    platformWork: ["platform_list_container"],
    regenerated: ["item"],
    ddl: [],
  },
  {
    row: "free-text behavior → all five Handlers and the complete suite (decision 22)",
    intent: "keep the newest notes at the top and trim the text",
    candidate: () =>
      notesSpec({ behavior: "Text is required and trimmed. Newest notes appear first." }),
    facts: ["behavior"],
    platformWork: [],
    regenerated: ["create", "read", "update", "delete", "search"],
    ddl: [],
    fullSuite: true,
  },
  {
    row: "behavioral_errors → the named Actions only",
    intent: "tell me when I write the same note twice",
    candidate: () =>
      notesSpec({
        behavioral_errors: [
          ...committedSpec().behavioral_errors,
          {
            action: "create",
            trigger: "duplicate_text",
            code: "duplicate_text",
            fields: ["text"],
            expected_markers: BEHAVIORAL_ERROR_MARKERS,
          },
        ],
      }),
    facts: ["behavioral_errors"],
    platformWork: ["behavioral_error_contract"],
    regenerated: ["create"],
    ddl: [],
    tests: ["create"],
  },
];
