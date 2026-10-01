// What a file named `.docx` holds, read after the write (Module 7 PLAN decision 3). A DOCX is a
// zip whose package relationships name its main part, and whose `[Content_Types].xml` declares
// that part the WordprocessingML main document, which a DOCM's, DOTX's or XLSX's is not. Office
// locks a DOCX with a password by wrapping it, encrypted, in an OLE2 compound file, so an OLE2
// file holding an `EncryptedPackage` stream is a locked Word document.

import { compoundFileNames, isCompoundFile, type ReadAt } from "./compound-file.ts";
import { readZipEntry } from "./zip-entry.ts";

export const WORD_DOCUMENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAIN_DOCUMENT_TYPE = `${WORD_DOCUMENT_TYPE}.main+xml`;

/** Far more than any Word document's content types or relationships, a few kilobytes each. */
export const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

export type WordPackage = "word" | "locked" | "other";

/** The relationship a package's main part is the target of, in transitional and strict OOXML. */
const OFFICE_DOCUMENT: ReadonlySet<string> = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
]);

/** OPC compares names and types in ASCII case alone. */
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

interface XmlText {
  readonly text: string;
  readonly utf16: boolean;
}

/**
 * A package part's XML as text, its one byte-order mark dropped: UTF-8, or UTF-16 by that mark,
 * as OPC allows. Undefined for bytes that are neither whole.
 */
function xmlText(bytes: Uint8Array): XmlText | undefined {
  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (utf16) {
    const text = decodeUtf16(bytes.subarray(2), bytes[0] === 0xff);
    return text === undefined ? undefined : { text, utf16 };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), utf16 };
  } catch {
    return undefined;
  }
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string | undefined {
  if (bytes.byteLength % 2 !== 0) return undefined;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = Array.from({ length: bytes.byteLength >> 1 }, (_, at) =>
    data.getUint16(at * 2, littleEndian),
  );
  return units.map((unit) => String.fromCharCode(unit)).join("");
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** The characters XML allows, which leaves out every control but tab, newline and return. */
const XML_TEXT = /^[\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;

/** What one reference between `&` and `;` stands for, if it is one XML defines. */
function referenced(reference: string): string | undefined {
  if (Object.hasOwn(XML_ENTITIES, reference)) return XML_ENTITIES[reference];
  const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(reference)?.[1];
  const decimal = /^#([0-9]{1,7})$/.exec(reference)?.[1];
  const code = hex ? Number.parseInt(hex, 16) : decimal ? Number(decimal) : -1;
  const surrogate = code >= 0xd800 && code <= 0xdfff;
  if (code <= 0 || code > 0x10ffff || surrogate) return undefined;
  const character = String.fromCodePoint(code);
  return XML_TEXT.test(character) ? character : undefined;
}

/** An attribute value with its references decoded, or undefined for one XML would not read. */
function decodeXmlValue(value: string): string | undefined {
  let decoded = "";
  let at = 0;
  for (let amp = value.indexOf("&"); amp >= 0; amp = value.indexOf("&", at)) {
    const end = value.indexOf(";", amp);
    const character = end < 0 ? undefined : referenced(value.slice(amp + 1, end));
    if (character === undefined) return undefined;
    decoded += value.slice(at, amp) + character;
    at = end + 1;
  }
  decoded += value.slice(at);
  return XML_TEXT.test(decoded) ? decoded : undefined;
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly empty: boolean;
  readonly attributes: ReadonlyMap<string, string>;
}

/** A name with no prefix: this reader refuses every namespace but a part's own default one. */
const PLAIN_NAME = /^[A-Za-z_][\w.-]*$/;
const SPACE = /[ \t\r\n]/;

/** The XML declaration's pseudo-attributes, in the one order XML allows them. */
const DECLARATION = ["version", "encoding", "standalone"];

/**
 * A part's tags, read in one pass, or undefined for anything an XML parser might read otherwise:
 * a comment, processing instruction, CDATA or DOCTYPE, a prefixed or repeated name, or text
 * between tags. Office writes none of these in a package's content types or relationships.
 */
class TagReader {
  #at = 0;
  readonly xml: string;
  readonly #utf16: boolean;

  constructor({ text, utf16 }: XmlText) {
    this.xml = text;
    this.#utf16 = utf16;
  }

  tags(): Tag[] | undefined {
    const { xml } = this;
    if (!this.#declaration()) return undefined;
    const tags: Tag[] = [];
    for (this.#space(); this.#at < xml.length; this.#space()) {
      const tag = xml[this.#at] === "<" ? this.#tag() : undefined;
      if (!tag) return undefined;
      tags.push(tag);
    }
    return tags;
  }

  /** Whether the part has no XML declaration, or one naming no encoding but the part's own. */
  #declaration(): boolean {
    if (!this.xml.startsWith("<?xml", this.#at) || !SPACE.test(this.xml[this.#at + 5] ?? ""))
      return true;
    this.#at += 5;
    const declared = this.#declared();
    const names = [...(declared?.keys() ?? [])];
    const ordered = DECLARATION.filter((name) => names.includes(name));
    if (names[0] !== "version" || names.join() !== ordered.join()) return false;
    const encoding = asciiLower(declared?.get("encoding") ?? "");
    return encoding === "" || encoding === (this.#utf16 ? "utf-16" : "utf-8");
  }

  /** The declaration's attributes, read to its `?>`, or undefined for a malformed one. */
  #declared(): Map<string, string> | undefined {
    const attributes = new Map<string, string>();
    for (;;) {
      const spaced = this.#space();
      if (this.xml.startsWith("?>", this.#at)) break;
      if (!spaced || !this.#attribute(attributes)) return undefined;
    }
    this.#at += 2;
    return attributes;
  }

  #space(): boolean {
    const from = this.#at;
    while (SPACE.test(this.xml[this.#at] ?? "")) this.#at++;
    return this.#at > from;
  }

  #name(): string {
    const from = this.#at;
    while (this.#at < this.xml.length && !/[\s=/>"'<]/.test(this.xml[this.#at] ?? "")) this.#at++;
    return this.xml.slice(from, this.#at);
  }

  #tag(): Tag | undefined {
    this.#at++;
    const closing = this.xml[this.#at] === "/";
    if (closing) this.#at++;
    const name = this.#name();
    if (!PLAIN_NAME.test(name)) return undefined;
    const attributes = new Map<string, string>();
    for (;;) {
      const spaced = this.#space();
      const end = this.#end();
      if (end !== undefined) return { name, closing, empty: end, attributes };
      if (closing || !spaced || !this.#attribute(attributes)) return undefined;
    }
  }

  /** Whether the tag ends here, and whether it ends empty; undefined when it doesn't end yet. */
  #end(): boolean | undefined {
    if (this.xml.startsWith("/>", this.#at)) {
      this.#at += 2;
      return true;
    }
    if (this.xml[this.#at] !== ">") return undefined;
    this.#at++;
    return false;
  }

  #attribute(attributes: Map<string, string>): boolean {
    const name = this.#name();
    if (!PLAIN_NAME.test(name) || attributes.has(name)) return false;
    this.#space();
    if (this.xml[this.#at] !== "=") return false;
    this.#at++;
    this.#space();
    const quote = this.xml[this.#at];
    const end = quote === '"' || quote === "'" ? this.xml.indexOf(quote, this.#at + 1) : -1;
    const value = end < 0 ? "<" : this.xml.slice(this.#at + 1, end);
    const decoded = value.includes("<") ? undefined : decodeXmlValue(value);
    if (decoded === undefined) return false;
    attributes.set(name, decoded);
    this.#at = end + 1;
    return true;
  }
}

/**
 * Whether `tag` nests one level under the root that `open` holds, which it then updates. A child
 * that declares a namespace of its own is not the root's, whatever its name.
 */
function nests(tag: Tag, open: string[], children: readonly string[]): boolean {
  if (tag.closing) return open.pop() === tag.name;
  if (open.length !== 1 || !children.includes(tag.name) || tag.attributes.has("xmlns"))
    return false;
  if (!tag.empty) open.push(tag.name);
  return true;
}

/** The children of an open `root`, one level deep, when every tag nests as XML's must. */
function nested(tags: readonly Tag[], root: Tag, children: readonly string[]) {
  const open: string[] = root.empty ? [] : [root.name];
  if (!tags.every((tag) => nests(tag, open, children)) || open.length > 0) return undefined;
  return tags.filter((tag) => !tag.closing);
}

/**
 * The children of a part whose root is `root` in `namespace`, when every child is one of
 * `children` with exactly the attributes it may hold, and the tags nest as XML's must.
 */
function childrenOf(
  xml: XmlText | undefined,
  root: string,
  namespace: string,
  children: Readonly<Record<string, ChildAttributes>>,
): Tag[] | undefined {
  const [first, ...rest] = (xml && new TagReader(xml).tags()) ?? [];
  const isRoot =
    first?.name === root && !first.closing && first.attributes.get("xmlns") === namespace;
  const found = first && isRoot ? nested(rest, first, Object.keys(children)) : undefined;
  const fits = (tag: Tag) => {
    const { required, optional = [] } = children[tag.name] ?? { required: [] };
    const names = [...tag.attributes.keys()];
    const known = names.every((name) => required.includes(name) || optional.includes(name));
    return known && required.every((name) => tag.attributes.has(name));
  };
  return found?.every(fits) ? found : undefined;
}

interface ChildAttributes {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

const RELATIONSHIP = {
  Relationship: { required: ["Id", "Type", "Target"], optional: ["TargetMode"] },
};
const CONTENT_TYPES = {
  Default: { required: ["Extension", "ContentType"] },
  Override: { required: ["PartName", "ContentType"] },
};

/** An `Id` is an XML name with no prefix, so no two that a parser would normalize alike differ. */
const ID = /^[A-Za-z_][\w.-]*$/;

export const TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types";
export const RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";

/**
 * A part-name segment of OPC's characters alone, which never ends in a dot (ISO/IEC 29500-2). A
 * target names no scheme, so it holds no colon either.
 */
const TARGET_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=@-]*[A-Za-z0-9_~!$&'()*+,;=@-]$/;

/** An override's segment, which may escape a non-ASCII byte as OPC asks of such a name. */
const PART_SEGMENT =
  /^(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[89A-F][0-9A-F])*(?:[A-Za-z0-9_~!$&'()*+,;=:@-]|%[89A-F][0-9A-F])$/;

/**
 * `target` as a part name from the package root, in ASCII lowercase as OPC compares them, or
 * undefined for any form readers might resolve differently: a character OPC leaves out, an
 * escape, an empty segment, or a dot segment past a leading `./`.
 */
function partName(target: string): string | undefined {
  const segments = target.replace(/^\.?\//, "").split("/");
  if (!segments.every((segment) => TARGET_SEGMENT.test(segment))) return undefined;
  return asciiLower(`/${segments.join("/")}`);
}

/** Whether an override names a part as OPC would write its name. */
const isPartName = (name: string) =>
  name.startsWith("/") &&
  name
    .slice(1)
    .split("/")
    .every((segment) => PART_SEGMENT.test(segment));

/** The part the package's one office-document relationship targets, each relationship named once. */
function mainPart(relationships: XmlText | undefined): string | undefined {
  const all = childrenOf(
    relationships,
    "Relationships",
    RELATIONSHIPS_NAMESPACE,
    RELATIONSHIP,
  )?.map((tag) => tag.attributes);
  const ids = all?.map((relationship) => relationship.get("Id") ?? "") ?? [];
  if (!ids.every((id) => ID.test(id)) || new Set(ids).size !== ids.length) return undefined;
  const main = all?.filter((relationship) => OFFICE_DOCUMENT.has(relationship.get("Type") ?? ""));
  const [only] = main ?? [];
  if (main?.length !== 1 || !only) return undefined;
  if ((only.get("TargetMode") ?? "Internal") !== "Internal") return undefined;
  return partName(only.get("Target") ?? "");
}

/** A default's extension: OPC's characters, or an escaped non-ASCII byte, and no dot first. */
const EXTENSION =
  /^(?:[A-Za-z0-9_~!$&'()*+,;=:@-]|%[89A-F][0-9A-F])(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[89A-F][0-9A-F])*$/;

/** The extension of a part name's last segment, or undefined when it has none. */
function extensionOf(part: string): string | undefined {
  const last = part.slice(part.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot < 0 ? undefined : last.slice(dot + 1);
}

/** The content type `types` gives `part`: its one override, or its extension's one default. */
function typeOf(types: XmlText | undefined, part: string): string | undefined {
  const declared = childrenOf(types, "Types", TYPES_NAMESPACE, CONTENT_TYPES);
  if (!declared) return undefined;
  const of = (name: string) =>
    declared.filter((tag) => tag.name === name).map((tag) => tag.attributes);
  const overrides = of("Override");
  if (!overrides.every((element) => isPartName(element.get("PartName") ?? ""))) return undefined;
  const own = overrides.filter((element) => asciiLower(element.get("PartName") ?? "") === part);
  if (own.length > 1) return undefined;
  if (own[0]) return own[0].get("ContentType");
  const extensions = of("Default").map((element) => element.get("Extension") ?? "");
  if (!extensions.every((extension) => EXTENSION.test(extension))) return undefined;
  const extension = extensionOf(part);
  const defaults = of("Default").filter(
    (element) =>
      extension !== undefined &&
      asciiLower(element.get("Extension") ?? "") === asciiLower(extension),
  );
  return defaults.length === 1 ? defaults[0]?.get("ContentType") : undefined;
}

async function isLocked(read: ReadAt, size: number): Promise<boolean> {
  const names = await compoundFileNames(read, size);
  return names?.some((name) => name.toLowerCase() === "encryptedpackage") ?? false;
}

export async function wordPackageOf(read: ReadAt, size: number): Promise<WordPackage> {
  if (isCompoundFile(await read(0, 8))) return (await isLocked(read, size)) ? "locked" : "other";
  const types = await readZipEntry(read, size, "[Content_Types].xml", MAX_CONTENT_TYPES_BYTES);
  const relationships = await readZipEntry(read, size, "_rels/.rels", MAX_CONTENT_TYPES_BYTES);
  if (!types || !relationships) return "other";
  const part = mainPart(xmlText(relationships));
  const type = part && typeOf(xmlText(types), part);
  return type !== undefined && asciiLower(type) === MAIN_DOCUMENT_TYPE ? "word" : "other";
}
