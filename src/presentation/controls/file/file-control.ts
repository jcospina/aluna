// The file field's place in the form: the host `design/scripts/files/file-field.js` draws the file
// control into, and `public/controls/file-field.js` mounts on (Module 7 PLAN decisions 8, 16 and 19).
//
// The server draws everything the browser cannot know: the families the field takes, where its
// upload goes, the types its picker offers, the cap and the sentence a file over it earns, the file
// an edit opens holding and its verified type, and the value that clears it.
// The field posts its presence marker and one value, kept in step by the browser: the key it was
// drawn holding, a pending key it took since, `""` for nothing, or the clear. A `file[]` posts one
// key per file in order and a marked key for each file it was drawn holding and holds no longer,
// and also carries how many files it takes.

import { FILE_FIELD_HOOKS as HOOKS } from "#design/files/file-field.js";
import { FILE_FIELD_ATTRIBUTES as WIRE } from "#shell/core/shell-dom.js";
import { offeredTypes } from "../../../platform/files/admission/admission.ts";
import { oversizeSentence } from "../../../platform/files/admission/refusal-copy.ts";
import { resolveMaxFileBytes, resolveMaxListFiles } from "../../../platform/files/file-cap.ts";
import { fileUploadPath } from "../../../platform/files/upload-path.ts";
import type { SpecField, UiFormIntent } from "../../../registry/index.ts";
import {
  FILE_CLEAR_VALUE,
  FILE_REMOVE_PREFIX,
  fileKeyFromProjection,
} from "../../../runtime/data/index.ts";
import {
  ALUNA_DRAWN_MARKER,
  ALUNA_PRESENT_MARKER,
  drawnFileValue,
} from "../../../runtime/router/wire/wire-protocol.ts";
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
 * The hidden marker an edit posts naming the keys `name` held when its form was drawn. A create,
 * whose `value` is `undefined`, posts none.
 */
function drawnMarker(name: string, keys: readonly string[], value: unknown): string {
  if (value === undefined) return "";
  const drawn = escapeHtml(drawnFileValue(name, keys));
  return `<input type="hidden" name="${ALUNA_DRAWN_MARKER}" value="${drawn}" ${WIRE.drawn}>`;
}

/**
 * @param value what an edit's record holds in the field, as generated code sees it, and never
 * `undefined` there, which is a create's and posts no drawn marker
 */
export function renderFileField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  target: FileFieldTarget,
  value: unknown,
): string {
  if (field.type === "file[]") return renderManyFiles(inputId, field, form, target, value);
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
    drawnMarker(field.name, held.key === "" ? [] : [held.key], value) +
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

/**
 * The files a list opens holding, in order, each as the list reads it off its host: the verified
 * type as `type`, which is where `design/scripts/files/file-list.js` reads one. A value that is not
 * a list of whole projections draws the list empty, as a single field does.
 */
function heldEntries(value: unknown): { key: string; holds: Record<string, unknown> }[] {
  if (!Array.isArray(value)) return [];
  const entries = value.map((file) => {
    const key = fileKeyFromProjection(file);
    const { name, size, url, kind, mime } = (file ?? {}) as Record<string, unknown>;
    // As `heldFrom` in `file-list.js` reads one: a file the list can't hold, it would not post.
    const whole =
      key !== undefined &&
      typeof name === "string" &&
      name !== "" &&
      typeof url === "string" &&
      Number.isSafeInteger(size) &&
      (size as number) >= 0;
    return whole ? { key, holds: { name, size, url, kind, type: mime } } : undefined;
  });
  return entries.every((entry) => entry !== undefined) ? entries : [];
}

function renderManyFiles(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  target: FileFieldTarget,
  value: unknown,
): string {
  const chrome = fieldChrome(inputId, field, form, { emptyable: true });
  const name = escapeHtml(field.name);
  const families = field.accepts ?? ["image"];
  const held = heldEntries(value);
  const keys = held.map((entry) => entry.key);
  const holds = escapeHtml(JSON.stringify(held.map((entry) => entry.holds)));
  const posted = keys.map(
    (key) => `<input type="hidden" name="${name}" value="${escapeHtml(key)}">`,
  );
  return (
    `<div class="field file" id="${inputId}" ${HOOKS.list}` +
    ` ${HOOKS.kind}="${escapeHtml(families.join(" "))}" ${HOOKS.holds}="${holds}"` +
    ` ${HOOKS.count}="${resolveMaxListFiles()}"${uploadAttributes(target, field, families)}>` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${name}">` +
    drawnMarker(field.name, keys, value) +
    `<span hidden ${WIRE.keys} ${WIRE.fieldName}="${name}"` +
    ` ${WIRE.removePrefix}="${escapeHtml(FILE_REMOVE_PREFIX)}"${field.required ? ` ${WIRE.required}` : ""}>` +
    `${posted.join("")}</span>` +
    `<span class="field__label caps" id="${inputId}-label">` +
    `${escapeHtml(field.label)}${chrome.labelSuffix}</span>` +
    `<div ${HOOKS.body}></div>` +
    chrome.trailing +
    `</div>`
  );
}
