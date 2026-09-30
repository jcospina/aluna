// Whether a card draws each file it holds as the kind of file it is (Module 7 PLAN decisions
// 28 and 29): a video in a player, a photo in a picture, and a sound or a document in words. The enforcer
// keeps every one of those elements, so a renderer that draws a video with `<img>` passes it, and
// every such card is a broken picture.

import { decodeAttributeValue } from "../../../../presentation/index.ts";
import type { FileFamily } from "../../../../registry/index.ts";

/** What an element draws a file it names as: a picture, or the player it is or sits in. */
type Drawn = "image" | "video" | "audio";

/** Each file's address in `record`, and its kind; an address two kinds share is left out. */
function kindsByUrl(record: Readonly<Record<string, unknown>>): Map<string, string> {
  const kinds = new Map<string, string>();
  const shared = new Set<string>();
  for (const value of Object.values(record)) {
    const { url, kind } = (value ?? {}) as Record<string, unknown>;
    if (typeof url !== "string" || typeof kind !== "string" || url === "") continue;
    if (kinds.has(url) && kinds.get(url) !== kind) shared.add(url);
    kinds.set(url, kind);
  }
  for (const url of shared) kinds.delete(url);
  return kinds;
}

function drawnAs(tag: string, frame: string | undefined): Drawn | undefined {
  if (tag === "img") return "image";
  if (tag === "video" || tag === "audio") return tag;
  if (tag !== "source") return undefined;
  return frame === "video" || frame === "audio" ? frame : "image";
}

/**
 * The path an address loads as a browser reads it: tabs and newlines dropped, a backslash as a
 * slash, each escape decoded, dot segments resolved, and a key's hex in either case.
 */
function pathOf(address: string): string {
  const cleaned = address
    .replace(/[\t\n\r]/g, "")
    .replaceAll("\\", "/")
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return (URL.parse(cleaned, "http://origin.invalid/")?.pathname ?? cleaned).toLowerCase();
}

/** Every address `element`'s `src` and `srcset` name, as paths. */
function namedPaths(element: HTMLRewriterTypes.Element): string[] {
  const src = decodeAttributeValue(element.getAttribute("src") ?? "");
  const srcset = decodeAttributeValue(element.getAttribute("srcset") ?? "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "");
  return [src, ...srcset].filter((address) => address !== "").map(pathOf);
}

/** The kind of the first file `element` draws as something else, or of a sound it draws at all. */
function misdrawnKind(
  element: HTMLRewriterTypes.Element,
  drawn: Drawn,
  kinds: ReadonlyMap<string, string>,
): string | undefined {
  const named = namedPaths(element);
  for (const [url, kind] of kinds) {
    const misdrawn = kind !== drawn || kind === "audio";
    if (misdrawn && named.includes(pathOf(url))) return kind;
  }
  return undefined;
}

/**
 * The first file `markup` draws as another kind than it is, said for the model to fix, or
 * undefined when every file it draws is drawn as itself.
 */
export function fileKindViolation(
  record: Readonly<Record<string, unknown>>,
  markup: string,
): string | undefined {
  const kinds = kindsByUrl(record);
  if (kinds.size === 0) return undefined;
  const frames: string[] = [];
  let violation: string | undefined;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        const drawn = drawnAs(tag, frames.at(-1));
        const kind = drawn && misdrawnKind(element, drawn, kinds);
        if (kind && drawn) violation ??= misdrawnSentence(kind, drawn, tag);
        if (FRAMES.has(tag) && element.canHaveContent) {
          frames.push(tag);
          element.onEndTag(() => void frames.pop());
        }
      },
    })
    .transform(markup);
  return violation;
}

function misdrawnSentence(kind: string, drawn: Drawn, tag: string): string {
  const rule =
    'Draw a file by its `kind`: "image" in an <img>, "video" in a <video>, and "audio" and "document" in words alone.';
  if (kind === "audio") {
    return `it draws a sound with <${tag}>, and a card holds no player. ${rule}`;
  }
  return `it draws ${NOUNS[kind] ?? kind} with <${tag}>, as if it were ${NOUNS[drawn]}. ${rule}`;
}

const FRAMES: ReadonlySet<string> = new Set(["picture", "video", "audio"]);

const NOUNS: Readonly<Record<string, string>> = {
  image: "a photo",
  video: "a video",
  audio: "a sound",
  document: "a document",
} satisfies Record<FileFamily, string>;

/** How the Gate names a file of `kind` to the model. */
export function fileNoun(kind: string): string {
  return NOUNS[kind] ?? kind;
}

const PICTURES: ReadonlySet<string> = new Set(["img", "picture", "video"]);

/** Whether `markup` draws a media frame with no picture or video in it. */
export function drawsEmptyMediaFrame(markup: string): boolean {
  const open: { filled: boolean }[] = [];
  let empty = false;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (PICTURES.has(tag)) for (const frame of open) frame.filled = true;
        const classes = (element.getAttribute("class") ?? "").split(/\s+/);
        if (!classes.some((name) => name === "media-frame" || name.startsWith("media-frame--")))
          return;
        if (!element.canHaveContent) {
          empty ||= !PICTURES.has(tag);
          return;
        }
        const frame = { filled: false };
        open.push(frame);
        element.onEndTag(() => {
          open.splice(open.indexOf(frame), 1);
          empty ||= !frame.filled;
        });
      },
    })
    .transform(markup);
  return empty || open.some((frame) => !frame.filled);
}
