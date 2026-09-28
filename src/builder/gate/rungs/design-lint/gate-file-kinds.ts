// Whether a card draws each file it holds as the kind of file it is (Module 7 PLAN decisions 28
// and 29): a video in a player and a photo in a picture. The enforcer keeps both elements, so a
// renderer that draws a video with `<img>` passes it, and every such card is a broken picture.

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

/** The kind of the first file `element` names that it draws as something else. */
function misdrawnKind(
  element: HTMLRewriterTypes.Element,
  drawn: Drawn,
  kinds: ReadonlyMap<string, string>,
): string | undefined {
  const named = ["src", "srcset"].map((attribute) => element.getAttribute(attribute) ?? "");
  for (const [url, kind] of kinds) {
    if (kind !== drawn && named.some((value) => value.includes(url))) return kind;
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
        if (kind && drawn) {
          violation ??= `it draws ${NOUNS[kind] ?? kind} with <${tag}>, as if it were ${NOUNS[drawn]}. Draw a file by its \`kind\`: "image" in an <img>, "video" in a <video>.`;
        }
        if (FRAMES.has(tag) && element.canHaveContent) {
          frames.push(tag);
          element.onEndTag(() => void frames.pop());
        }
      },
    })
    .transform(markup);
  return violation;
}

const FRAMES: ReadonlySet<string> = new Set(["picture", "video", "audio"]);

const NOUNS: Readonly<Record<string, string>> = {
  image: "a photo",
  video: "a video",
  audio: "a sound",
};
