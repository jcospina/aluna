import { describe, expect, test } from "bun:test";
import { responseText } from "./app.test-support.ts";
import { createApp } from "./app.ts";

describe("High Meadow delivery through the shell", () => {
  test("loads High Meadow before the temporary shell integration and removes the styled lockup", async () => {
    const app = createApp();
    const html = await responseText(await app.request("/"));

    const highMeadow = 'href="/design/styles/index.css"';
    const shell = 'href="/static/app.css"';
    expect(html).toContain(highMeadow);
    expect(html.indexOf(highMeadow)).toBeLessThan(html.indexOf(shell));
    expect(html).not.toContain('class="content-topbar__brand"');
  });

  test("serves High Meadow tokens, both fonts, and the wallpaper from design/", async () => {
    const app = createApp();
    const tokenResponse = await app.request("/design/styles/tokens.css");
    const frauncesResponse = await app.request("/design/assets/fonts/fraunces-variable.woff2");
    const outfitResponse = await app.request("/design/assets/fonts/outfit-variable.woff2");
    const wallpaperResponse = await app.request("/design/assets/wallpaper/high-meadow.webp");

    expect(tokenResponse.status).toBe(200);
    expect(await tokenResponse.text()).toContain("--ground: #dcf0ce");
    expect(frauncesResponse.status).toBe(200);
    expect(outfitResponse.status).toBe(200);
    expect(wallpaperResponse.status).toBe(200);
  });
});
