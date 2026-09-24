import { describe, expect, test } from "bun:test";
import { capFileName, decodeFileName, inlineContentDisposition } from "./file-name.ts";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const char = (codePoint: number) => String.fromCodePoint(codePoint);
const decoded = (name: string) => decodeFileName(encodeURIComponent(name));
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(char).join("");

describe("a filename from the upload header", () => {
  test("is percent-decoded, so a name beyond Latin-1 round-trips", () => {
    expect(decoded("日本.jpg")).toBe("日本.jpg");
    expect(decodeFileName("harbour%20at%20dawn.jpg")).toBe("harbour at dawn.jpg");
  });

  test("is normalized to NFC, as macOS sends NFD", () => {
    expect(decoded(`cafe${char(0x301)}.jpg`)).toBe(`caf${char(0xe9)}.jpg`);
  });

  test("loses its control, bidirectional, line-breaking and zero-width characters", () => {
    const controls = [0x0, 0x9, 0xa, 0xd, 0x1b, 0x7f, 0x85, 0x9f];
    const bidi = [0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
    const isolates = [0x2066, 0x2067, 0x2068, 0x2069];
    const invisible = [0x200b, 0x2028, 0x2029, 0x2060, 0xfeff];
    const noisy = [...controls, ...bidi, ...isolates, ...invisible].map(char).join("");
    expect(decoded(`gpj${noisy}.jpg`)).toBe("gpj.jpg");
  });

  test("keeps the joiners an emoji or a script needs", () => {
    const flag = [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f].map(char).join("");
    const persian = `${char(0x645)}${char(0x200c)}${char(0x6cc)}.png`;
    for (const name of [`${FAMILY}.png`, `${flag}.png`, persian]) expect(decoded(name)).toBe(name);
  });

  test("keeps only what follows its last slash, forward or back", () => {
    expect(decoded("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(decoded("C:\\Users\\ana\\harbour.png")).toBe("harbour.png");
    expect(decoded("photos/")).toBe("");
  });

  test("joins across a stripped character instead of stopping at it", () => {
    expect(decodeFileName("notes.txt%00.jpg")).toBe("notes.txt.jpg");
  });

  test("is refused when it is not printable ASCII, or its escapes are not UTF-8", () => {
    expect(decodeFileName("100%.jpg")).toBeUndefined();
    expect(decodeFileName("%E6%97.jpg")).toBeUndefined();
    const latin1 = [0xe6, 0x97, 0xa5].map(char).join("");
    expect(decodeFileName(`${latin1}.jpg`)).toBeUndefined();
    expect(decodeFileName(`tab${char(0x9)}.jpg`)).toBeUndefined();
  });
});

describe("the cap on a filename", () => {
  test("is 255 bytes, keeping the extension and cutting between characters", () => {
    for (const stem of ["a".repeat(300), "日".repeat(120), `${"e".repeat(250)}${char(0x301)}x`]) {
      const name = capFileName(`${stem}.jpeg`);
      expect(bytes(name)).toBeLessThanOrEqual(255);
      expect(name.endsWith(".jpeg")).toBe(true);
      expect(stem.startsWith(name.slice(0, -".jpeg".length))).toBe(true);
    }
    const capped = capFileName(`${FAMILY.repeat(20)}.gif`);
    expect(
      capped
        .replace(".gif", "")
        .split(FAMILY)
        .every((part) => part === ""),
    ).toBe(true);
  });

  test("keeps a name of exactly 255 bytes, and cuts a long tail that is no extension", () => {
    const exact = `${"b".repeat(251)}.png`;
    expect(capFileName(exact)).toBe(exact);
    expect(bytes(capFileName(`photo.${"x".repeat(300)}`))).toBe(255);
  });
});

describe("the disposition a served file carries", () => {
  test("names the file in ASCII and, whole, in RFC 8187's encoding", () => {
    expect(inlineContentDisposition("日本.jpg")).toBe(
      `inline; filename="__.jpg"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.jpg`,
    );
  });

  test("keeps quotes, backslashes and percent signs out of the fallback", () => {
    expect(inlineContentDisposition(`a"b\\c%d's (1)*.png`)).toBe(
      `inline; filename="a_b_c_d's (1)*.png"; filename*=UTF-8''a%22b%5Cc%25d%27s%20%281%29%2A.png`,
    );
  });

  test("is a header value Bun will send, whatever the name holds", () => {
    const loneSurrogate = String.fromCharCode(0xd800);
    for (const name of ["日本.jpg", `tab${char(0x9)}.png`, `${loneSurrogate}.gif`, "a\r\nb", ""]) {
      const response = new Response(null, {
        headers: { "content-disposition": inlineContentDisposition(name) },
      });
      expect(response.headers.get("content-disposition")).toStartWith("inline; filename=");
    }
  });
});
