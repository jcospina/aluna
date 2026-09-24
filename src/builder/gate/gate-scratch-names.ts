// The names the Gate's scratch files carry (Module 7 PLAN decision 38). A leaf that imports
// nothing, so the behavioral rung's row comparison can name a token's file without pulling the
// runtime into its import graph.

/** The longest name admission keeps (PLAN decision 6), which every scratch name reaches exactly. */
export const SCRATCH_FILE_NAME_BYTES = 255;

/**
 * A name a template must escape and isolate: markup, a right-to-left override and an emoji, padded
 * to exactly {@link SCRATCH_FILE_NAME_BYTES} UTF-8 bytes. `label` tells two names apart.
 */
export function scratchFileName(label: string): string {
  const head = `<img src=x onerror="alert(1)">${label} \u{202E}gpj.exe \u{1F305}`;
  const tail = ".jpg";
  const room = SCRATCH_FILE_NAME_BYTES - Buffer.byteLength(head + tail, "utf8");
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
