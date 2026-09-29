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

const FAMILY_EXTENSIONS: Readonly<Record<string, string>> = {
  image: ".jpg",
  video: ".mp4",
  audio: ".mp3",
};

/** `name` ending as a file of `family` does, so a template that reads the name reads it right. */
export function scratchNameFor(name: string, family: string): string {
  const extension = FAMILY_EXTENSIONS[family] ?? ".jpg";
  return name.endsWith(".jpg") ? `${name.slice(0, -".jpg".length)}${extension}` : name;
}

/**
 * The name of every file a behavioral token stands for (PLAN decision 39). A test cannot know the
 * key a run mints, so a row compares a file by its family and this name.
 */
export function tokenFileName(family: string): string {
  return scratchNameFor(scratchFileName(`a synthetic ${family}`), family);
}
