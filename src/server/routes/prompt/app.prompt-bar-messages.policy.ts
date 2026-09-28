import { describe, expect, test } from "bun:test";
import { PROMPT_REFUSAL_FLASH_MS, PROMPT_REFUSED_CLASS } from "#shell/prompt-bar.js";
import { PROMPT_FIELD_ID } from "#shell/shell-dom.js";
import { readSource } from "../../../presentation/safety/source.test-support.ts";

// The prompt bar's modules and sheet, held to the design they restate and the ids they import;
// `app.prompt-bar-messages.test.ts` runs where each message goes.

describe("the bar the page ships", () => {
  test("the bar's ids have one home, which its modules import rather than restate", () => {
    for (const path of ["public/prompt-bar.js", "public/capability-deletion.js"]) {
      const source = readSource(path);
      expect(source).toContain('from "./shell-dom.js"');
      expect(source).not.toContain(`const PROMPT_FIELD_ID = "${PROMPT_FIELD_ID}";`);
    }
  });

  test("the cue is the design's own state, for the design's own time", () => {
    const design = readSource("design/scripts/prompt-bar.js");
    const [, cue, ms] = /classList\.remove\("([\w-]+)"\), (\d+)\)/.exec(design) ?? [];
    const promptCss = readSource("public/css/prompt.css");

    const shipped: { cue: string; ms: number } = {
      cue: PROMPT_REFUSED_CLASS,
      ms: PROMPT_REFUSAL_FLASH_MS,
    };
    expect(shipped).toEqual({ cue: cue ?? "", ms: Number(ms) });
    // The design's placeholder rule verbatim, and the rail's own alert fill for the case the
    // design never drew: a refusal that keeps what the person typed, with no placeholder on screen.
    expect(promptCss).toContain(`.prompt.${PROMPT_REFUSED_CLASS} .prompt__field::placeholder`);
    expect(promptCss).toContain("color: var(--signal)");
    // Scoped so the fill only applies where the placeholder rule has nothing to say.
    expect(promptCss).toContain(
      `.prompt.${PROMPT_REFUSED_CLASS}:has(.prompt__field:not(:placeholder-shown)) .prompt__composer`,
    );
    expect(promptCss).toContain("background: var(--well-alert)");
  });
});
