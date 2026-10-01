// What a person reads when a file is refused: the upload's sentences in the words
// `design/controls.html` settles, and the save's as the router says it. A leaf at runtime: the one
// import is a type.

import type { FileFamily } from "../../../registry/fields/file.ts";

/** A key a save may not claim, or an upload whose bytes were taken before it answered. */
export const ADD_FILE_AGAIN_SENTENCE =
  "I can’t save that file in this field. Mind adding it here again?";

/**
 * A save whose list holds more files than its field takes, in the words `design/controls.html`
 * settles for the save. One over asks for one removal, more ask for a few.
 */
export function tooManyFilesSentence(count: number, cap: number): string {
  const ask = count - cap === 1 ? "one" : "a few";
  const files = cap === 1 ? "file" : "files";
  return `This field takes up to ${cap} ${files}, and it has ${count}. Mind removing ${ask}?`;
}

/** What a field of one family says of a file admission refused. */
export const NOT_ADMITTED_SENTENCES = {
  image: "That isn’t a photo I can show here. Mind picking a different one?",
  video: "That isn’t a video I can play here. Mind picking a different one?",
  audio: "That isn’t an audio file I can play here. Mind picking a different one?",
  document: "That isn’t a document I can keep here. Mind picking a different one?",
} as const satisfies Record<FileFamily, string>;

/** How a refusal names each family, as `design/controls.html` does. */
export const FAMILY_NOUNS = {
  image: "a photo",
  video: "a video",
  audio: "an audio file",
  document: "a document",
} as const satisfies Record<FileFamily, string>;

/**
 * What a field says of a file admission refused. A field that takes several families names them
 * all, and keeps rather than shows or plays, as `design/controls.html` settles.
 */
export function notAdmittedSentence(accepts: readonly [FileFamily, ...FileFamily[]]): string {
  if (accepts.length === 1) return NOT_ADMITTED_SENTENCES[accepts[0]];
  const nouns = accepts.map((family) => FAMILY_NOUNS[family]);
  const last = nouns.pop();
  return `That isn’t ${nouns.join(", ")} or ${last} I can keep here. Mind picking a different one?`;
}

/** What a document's name says it is, for the sentence that says it isn't, as design/ names it. */
export const DOCUMENTS_NAMED_AS: ReadonlyMap<string, string> = new Map([
  ["pdf", "PDF"],
  ["doc", "Word document"],
  ["docx", "Word document"],
  ["md", "Markdown file"],
  ["txt", "text file"],
]);

/** A Word document Office locked with a password, which only its owner can open. */
export const LOCKED_SENTENCE =
  "That Word document has a password on it, so I can’t keep it. Mind saving a copy without one?";

/** A document whose contents aren't what its name says, such as a spreadsheet named `.docx`. */
export function misnamedSentence(namedAs: string): string {
  return `That isn’t the ${namedAs} its name says it is. Mind picking a different one?`;
}

/**
 * What a field says of an upload admission refused at `reason`. A locked Word document, and a
 * document whose bytes aren't what its name says, each get a sentence of their own.
 */
export function refusalSentence(
  reason: string,
  name: string,
  accepts: readonly [FileFamily, ...FileFamily[]],
): string {
  if (reason === "locked") return LOCKED_SENTENCE;
  const dot = name.lastIndexOf(".");
  const namedAs = dot < 0 ? undefined : DOCUMENTS_NAMED_AS.get(name.slice(dot + 1).toLowerCase());
  if (reason === "signature" && namedAs) return misnamedSentence(namedAs);
  return notAdmittedSentence(accepts);
}

/** The cap as a person reads it: whole megabytes, as the drawn "500 MB" is, never rounded up. */
function sizeInWords(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** A file over the cap, whatever its kind. */
export function oversizeSentence(maxFileBytes: number): string {
  return `That’s over ${sizeInWords(maxFileBytes)}, more than I can keep in one file. Mind picking a smaller one?`;
}
