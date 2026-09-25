import { describe, expect, test } from "bun:test";

import { isDangerousUrl, isOffOriginUrl } from "./attribute-urls.ts";

describe("a srcset read as a browser reads it", () => {
  test("splits a candidate at ASCII whitespace, where a browser splits it", () => {
    expect(isDangerousUrl("java\tscript:alert(1)")).toBe(true);
    expect(isDangerousUrl("java\tscript:alert(1) 1x", "srcset")).toBe(false);
    expect(isOffOriginUrl("/a.png 1x,\u{2003}https://evil.example/x.png 2x", "srcset")).toBe(false);
    expect(isOffOriginUrl("/a.png 1x, https://evil.example/x.png 2x", "srcset")).toBe(true);
  });
});

describe("isDangerousUrl", () => {
  test("flags script schemes, including whitespace-obfuscated ones", () => {
    expect(isDangerousUrl("javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("  JavaScript:alert(1)")).toBe(true);
    expect(isDangerousUrl("java\tscript:alert(1)")).toBe(true);
    expect(isDangerousUrl("vbscript:msgbox")).toBe(true);
  });

  test("allows inline data:image but flags other data payloads", () => {
    expect(isDangerousUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isDangerousUrl("data:text/html,<script>")).toBe(true);
  });

  test("allows ordinary http(s) and relative URLs", () => {
    expect(isDangerousUrl("https://example.com/p.jpg")).toBe(false);
    expect(isDangerousUrl("/media/p.jpg")).toBe(false);
    expect(isDangerousUrl("p.jpg")).toBe(false);
  });
});
