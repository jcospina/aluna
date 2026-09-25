// The names the Gate's scratch files carry (Module 7 PLAN decision 38). Its one import is a leaf,
// so the behavioral rung's row comparison can name a token's file without pulling the runtime into
// its import graph.

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

/**
 * The name of every file a behavioral token stands for (PLAN decision 39). A test cannot know the
 * key a run mints, so a row compares a file by its family and this name.
 */
export function tokenFileName(family: string): string {
  return scratchFileName(`a synthetic ${family}`);
}
