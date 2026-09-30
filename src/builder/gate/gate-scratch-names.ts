// The names and types the Gate's scratch files carry (Module 7 PLAN decision 38). It imports only
// admission's table and the name cap, so the behavioral rung's row comparison can name a token's
// file without pulling the runtime into its import graph.

import { admittedTypes, usualExtension } from "../../platform/files/admission/admission.ts";
import { MAX_NAME_BYTES } from "../../platform/files/file-name.ts";

/**
 * A name a template must escape and isolate: markup and an emoji, padded to exactly the
 * {@link MAX_NAME_BYTES} UTF-8 bytes admission keeps. `label` tells two names apart.
 */
export function scratchFileName(label: string): string {
  const head = `<img src=x onerror="alert(1)">${label} \u{1F305}`;
  const tail = ".jpg";
  const room = MAX_NAME_BYTES - Buffer.byteLength(head + tail, "utf8");
  if (room < 0) throw new Error(`Scratch file label "${label}" leaves no room in the name.`);
  return `${head}${"_".repeat(room)}${tail}`;
}

/** The type a scratch file of `family` is recorded as: the first admission verifies for it. */
export function scratchFileType(family: string): string {
  const mime = admittedTypes(family)[0];
  if (mime === undefined) throw new Error(`Admission records no type for the "${family}" family.`);
  return mime;
}

/**
 * `name` ending as a file admission records as `mime` is named, so a template that reads the name
 * reads it right. The padding gives way to a longer extension, keeping the name within the cap.
 */
export function scratchNameFor(name: string, mime: string): string {
  const extension = usualExtension(mime);
  if (!extension || !name.endsWith(".jpg")) return name;
  const base = name.slice(0, -".jpg".length);
  const excess = Math.max(0, extension.length - "jpg".length);
  const kept = base.endsWith("_".repeat(excess)) ? base.slice(0, base.length - excess) : base;
  return `${kept}.${extension}`;
}

/**
 * The name of every file a behavioral token stands for (PLAN decision 39). A test cannot know the
 * key a run mints, so a row compares a file by its family and this name.
 */
export function tokenFileName(family: string): string {
  return scratchNameFor(scratchFileName(`a synthetic ${family}`), scratchFileType(family));
}
