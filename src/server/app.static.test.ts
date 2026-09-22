// The two static surfaces the app serves beside the product: High Meadow under /design,
// and the architecture tour under /architecture. Both ship from their source directories
// so the page a reader opens is the file in the tree.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.ts";

describe("the architecture tour", () => {
  // It ships from its own top-level folder for the reason High Meadow does: the page a
  // reader opens is the file in the tree, so neither can drift from the other.
  test("serves the page and its scripts, and sends /architecture to the folder", async () => {
    const app = createApp();

    const page = await app.request("/architecture/");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(
      readFileSync(resolve(import.meta.dir, "../../architecture/index.html"), "utf8"),
    );

    // The scripts are files rather than inline blocks, which is what keeps them inside the
    // app's `script-src 'self'` — an inline module here would be refused by the browser.
    const script = await app.request("/architecture/scripts/main.js");
    expect(script.status).toBe(200);

    const bare = await app.request("/architecture");
    expect(bare.status).toBe(301);
    expect(bare.headers.get("location")).toBe("/architecture/");
  });
});
