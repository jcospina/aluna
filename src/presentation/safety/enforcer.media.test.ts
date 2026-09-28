import { describe, expect, test } from "bun:test";

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import { enforceItemMarkup, neutralizeItemMarkup } from "./enforcer.ts";

describe("enforcer — a served file's image", () => {
  const served = `${FILE_URL_PREFIX}${mintFileKey()}`;

  test("always loads lazily and decodes asynchronously", () => {
    expect(enforceItemMarkup(`<img src="${served}" alt="x">`)).toBe(
      `<img src="${served}" alt="x" loading="lazy" decoding="async">`,
    );
    expect(enforceItemMarkup(`<img src="${served}" LOADING="eager" decoding="sync">`)).toBe(
      `<img src="${served}" LOADING="lazy" decoding="async">`,
    );
  });

  test("is found through a relative path, a backslash, or a picture's source", () => {
    for (const src of [`.${served}`, served.slice(1), served.replaceAll("/", "\\")]) {
      expect(enforceItemMarkup(`<img src="${src}">`), src).toContain('loading="lazy"');
    }
    expect(
      enforceItemMarkup(`<picture><source srcset="${served}"><img src="/media/p.jpg"></picture>`),
    ).toContain('<img src="/media/p.jpg" loading="lazy" decoding="async">');
    expect(
      enforceItemMarkup(
        `<picture><source srcset="/media/p.jpg"><img src="/media/p.jpg"></picture>`,
      ),
    ).not.toContain("loading=");
    expect(enforceItemMarkup(`<img src="data:image/png,${served}">`)).not.toContain("loading=");
    expect(enforceItemMarkup(`<img src="/media/a.png,${served}">`)).not.toContain("loading=");
  });

  test("is found through a srcset or a character reference", () => {
    expect(enforceItemMarkup(`<img srcset="${served} 1x">`)).toBe(
      `<img srcset="${served} 1x" loading="lazy" decoding="async">`,
    );
    const encoded = `&#x2F;${served.slice(1)}`;
    expect(enforceItemMarkup(`<img src="${encoded}">`)).toBe(
      `<img src="${encoded}" loading="lazy" decoding="async">`,
    );
  });

  test("already carrying both passes through unchanged", () => {
    const complete = `<img src="${served}" alt="x" loading="lazy" decoding="async">`;
    expect(enforceItemMarkup(complete)).toBe(complete);
  });

  test("is the only image given them", () => {
    for (const markup of [
      '<img src="/media/p.jpg" alt="x">',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">',
      `<img src="https://evil.example${served}" alt="x">`,
      `<span title="${served}">x</span>`,
    ]) {
      expect(enforceItemMarkup(markup), markup).not.toContain("loading=");
    }
  });

  test("never throws on a picture that closes itself inside foreign content", () => {
    for (const markup of [
      "<svg><picture/></svg>",
      "<math><PICTURE/></math>",
      "x<svg><picture/></svg>",
    ]) {
      expect(() => enforceItemMarkup(markup), markup).not.toThrow();
    }
  });

  test("counts a source only inside an open picture, the innermost one", () => {
    const afterVideo = `<video><source src="${served}"></video><img src="/y.png">`;
    expect(enforceItemMarkup(afterVideo)).not.toContain("loading=");
    const videoInPicture = `<picture><video><source src="${served}"></video><img src="/y.png"></picture>`;
    expect(enforceItemMarkup(videoInPicture)).not.toContain("loading=");
    const nested = `<picture><source srcset="${served}"><picture></picture><img src="/y.png"></picture>`;
    expect(enforceItemMarkup(nested)).toContain(
      '<img src="/y.png" loading="lazy" decoding="async">',
    );
  });

  test("gains nothing from neutralizing alone, which is what design lint diffs against", () => {
    const bare = `<img src="${served}" alt="x">`;
    expect(neutralizeItemMarkup(bare)).toBe(bare);
  });
});

describe("enforcer — a player", () => {
  const served = `${FILE_URL_PREFIX}${mintFileKey()}`;

  test("reads only its metadata, whatever its template said, and never starts itself", () => {
    expect(enforceItemMarkup(`<video src="${served}" muted playsinline></video>`)).toBe(
      `<video src="${served}" muted playsinline preload="metadata"></video>`,
    );
    for (const preload of ["auto", "none", "", "AUTO"]) {
      expect(enforceItemMarkup(`<video src="${served}" preload="${preload}"></video>`)).toBe(
        `<video src="${served}" preload="metadata"></video>`,
      );
    }
    expect(enforceItemMarkup(`<audio src="${served}" autoplay loop></audio>`)).toBe(
      `<audio src="${served}" loop preload="metadata"></audio>`,
    );
    expect(enforceItemMarkup(`<VIDEO AUTOPLAY="autoplay" PRELOAD=auto muted></VIDEO>`)).toBe(
      `<VIDEO PRELOAD="metadata" muted></VIDEO>`,
    );
  });

  test("keeps no second copy of autoplay or preload a browser would read instead", () => {
    const repeated = enforceItemMarkup(
      `<video autoplay autoplay preload="metadata" preload="auto" src="${served}"></video>`,
    );
    expect(repeated).not.toContain("autoplay");
    expect(repeated.match(/preload/g)).toHaveLength(1);
    expect(repeated).toContain('preload="metadata"');
  });

  test("is given them whether or not it names a served file, a source inside it included", () => {
    expect(enforceItemMarkup(`<video autoplay><source src="${served}"></video>`)).toBe(
      `<video preload="metadata"><source src="${served}"></video>`,
    );
    expect(enforceItemMarkup(`<audio src="/media/a.mp3" autoplay></audio>`)).toBe(
      `<audio src="/media/a.mp3" preload="metadata"></audio>`,
    );
  });

  test("already settled passes through unchanged, and a second pass changes nothing", () => {
    const settled = `<video src="${served}" preload="metadata" muted playsinline></video>`;
    expect(enforceItemMarkup(settled)).toBe(settled);
    for (const markup of [
      `<video autoplay preload=auto src="${served}"></video>`,
      `<audio autoplay autoplay></audio><video preload></video>`,
      `<picture><video autoplay><source src="${served}"></video><img src="${served}"></picture>`,
      "<svg><video autoplay/></svg><video autoplay/>",
      `<video autoplay>${"<b>".repeat(40)}</video>`,
    ]) {
      const once = enforceItemMarkup(markup);
      expect(enforceItemMarkup(once), markup).toBe(once);
      expect(once, markup).not.toContain("autoplay");
    }
  });

  test("gains nothing from neutralizing alone, which is what design lint diffs against", () => {
    const bare = `<video src="${served}" muted playsinline></video>`;
    expect(neutralizeItemMarkup(bare)).toBe(bare);
  });

  test("loses a poster, autoplay and a caption track naming a served file to neutralizing", () => {
    expect(
      neutralizeItemMarkup(`<video src="${served}" poster="${served}" autoplay muted></video>`),
    ).toBe(`<video src="${served}" muted></video>`);
    expect(neutralizeItemMarkup(`<audio src="${served}" autoplay></audio>`)).toBe(
      `<audio src="${served}"></audio>`,
    );
    expect(neutralizeItemMarkup(`<track default kind="captions" src="${served}">`)).toBe(
      '<track default kind="captions">',
    );
    expect(neutralizeItemMarkup('<track kind="captions" src="/media/captions.vtt">')).toBe(
      '<track kind="captions" src="/media/captions.vtt">',
    );
  });
});
