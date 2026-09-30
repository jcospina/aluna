// The file field's place in the form: the host `design/scripts/files/file-field.js` draws the file
// control into, and `public/controls/file-field.js` mounts on (Module 7 PLAN decisions 8, 16 and 19).
//
// The server draws everything the browser cannot know: the families the field takes, where its
// upload goes, the types its picker offers, the cap and the sentence a file over it earns, the file
// an edit opens holding and its verified type, and the value that clears it.
// The field posts its presence marker and one value, kept in step by the browser: the key it was
// drawn holding, a pending key it took since, `""` for nothing, or the clear.

import { FILE_FIELD_HOOKS as HOOKS } from "#design/files/file-field.js";
import { FILE_FIELD_ATTRIBUTES as WIRE } from "#shell/core/shell-dom.js";
import { offeredTypes } from "../../../platform/files/admission/admission.ts";
import { oversizeSentence } from "../../../platform/files/admission/refusal-copy.ts";
import { resolveMaxFileBytes } from "../../../platform/files/file-cap.ts";
import { fileUploadPath } from "../../../platform/files/upload-path.ts";
import type { SpecField, UiFormIntent } from "../../../registry/index.ts";
import { FILE_CLEAR_VALUE, fileKeyFromProjection } from "../../../runtime/data/index.ts";
import { ALUNA_PRESENT_MARKER } from "../../../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import { fieldChrome } from "../../fields/chrome/field-chrome.ts";

/** The capability a form's file fields upload to; no incarnation where it is only inspected. */
interface FileFieldTarget {
  readonly id: string;
  readonly incarnationId?: string | undefined;
}

/**
 * The file an edit opens holding, as the control reads it off its host. A value that is not a
 * whole projection draws the field empty: the record a Handler presents is its own to shape.
 */
function heldAttributes(value: unknown): { attributes: string; key: string } {
  const key = fileKeyFromProjection(value);
  const { name, size, url, mime } = (value ?? {}) as Record<string, unknown>;
  if (key === undefined || typeof name !== "string" || name === "" || !Number.isSafeInteger(size)) {
    return { attributes: "", key: "" };
  }
  const type = typeof mime === "string" ? ` ${HOOKS.holdsType}="${escapeHtml(mime)}"` : "";
  return {
    attributes:
      ` ${HOOKS.holdsName}="${escapeHtml(name)}" ${HOOKS.holdsSize}="${escapeHtml(String(size))}"` +
      ` ${HOOKS.holdsSrc}="${escapeHtml(String(url))}"${type}`,
    key,
  };
}

/**
 * The cap is the environment's, the one Bun holds every request body to (`serve-options.ts`); an
 * app's own `maxFileBytes` exists for the upload route's suites and never reaches a page.
 */
function uploadAttributes(
  target: FileFieldTarget,
  field: SpecField,
  families: readonly string[],
): string {
  const cap = resolveMaxFileBytes();
  const address =
    target.incarnationId === undefined
      ? ""
      : ` ${WIRE.upload}="${escapeHtml(fileUploadPath(target.id, target.incarnationId, field.name))}"`;
  const types = offeredTypes(families);
  const accept = types.length === 0 ? "" : ` ${HOOKS.accept}="${escapeHtml(types.join(","))}"`;
  return (
    `${address}${accept}` +
    ` ${WIRE.cap}="${cap}" ${WIRE.oversize}="${escapeHtml(oversizeSentence(cap))}"`
  );
}

/**
 * @param value what an edit's record holds in the field, as generated code sees it; `undefined`
 * on a create
 */
export function renderFileField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  target: FileFieldTarget,
  value: unknown,
): string {
  const chrome = fieldChrome(inputId, field, form, { emptyable: true });
  const name = escapeHtml(field.name);
  const families = field.accepts ?? ["image"];
  const held = heldAttributes(value);
  const key = escapeHtml(held.key);
  return (
    `<div class="field file" id="${inputId}" ${HOOKS.field}` +
    ` ${HOOKS.kind}="${escapeHtml(families.join(" "))}"` +
    `${held.attributes}${uploadAttributes(target, field, families)}>` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${name}">` +
    `<input type="hidden" name="${name}" value="${key}" ${WIRE.value}` +
    ` ${WIRE.heldKey}="${key}" ${WIRE.clearValue}="${escapeHtml(FILE_CLEAR_VALUE)}"` +
    `${field.required ? ` ${WIRE.required}` : ""}>` +
    `<span class="field__label caps" id="${inputId}-label">` +
    `${escapeHtml(field.label)}${chrome.labelSuffix}</span>` +
    `<div ${HOOKS.body}></div>` +
    chrome.trailing +
    `</div>`
  );
}
