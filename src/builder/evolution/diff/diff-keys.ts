// Canonical keys the Diff Engine compares two specs by: a list input's mode per field, a read
// dependency's pair, and a behavioral error case. A leaf beside `diff-engine.ts`.

import { compareStrings } from "../../../platform/canonical-json.ts";
import {
  type CapabilitySpec,
  type CapabilityTool,
  isListFieldType,
} from "../../../registry/index.ts";

export function listInputModesByField(spec: CapabilitySpec): Map<string, string> {
  const active = new Set(
    spec.schema.fields
      .filter((field) => field.lifecycle === "active" && isListFieldType(field.type))
      .map((field) => field.name),
  );
  const modes = new Map<string, string>();
  for (const entry of spec.ui_intent.form.list_inputs) {
    if (active.has(entry.field)) modes.set(entry.field, entry.mode);
  }
  return modes;
}

export function canonicalDependencyKeys(
  dependencies: CapabilitySpec["read_dependencies"][CapabilityTool],
): readonly string[] {
  return dependencies
    .map((dependency) => `${dependency.capability_id}\u0000${dependency.incarnation_id}`)
    .sort(compareStrings);
}

export function behavioralErrorCasesByKey(spec: CapabilitySpec): Map<string, CapabilityTool> {
  const byKey = new Map<string, CapabilityTool>();
  for (const errorCase of spec.behavioral_errors) {
    const key = JSON.stringify({
      action: errorCase.action,
      trigger: errorCase.trigger,
      code: errorCase.code,
      fields: [...errorCase.fields].sort(compareStrings),
    });
    byKey.set(key, errorCase.action);
  }
  return byKey;
}
