// The blank-prompt reading, as a pin over two files rather than one.
//
// The server's `hasMeaningfulPromptContent` and the bar's `BLANK_PROMPT_CHARACTERS` must strip
// the same characters, or the desk refuses a prompt the server would have taken. Neither side
// exports the pattern, so it is written down here once and both sources are asked for it.

/** The character class both readings of a blank prompt strip, as it appears in each source. */
export const BLANK_PROMPT_PATTERN_SOURCE =
  "/[\\p{White_Space}\\p{Default_Ignorable_Code_Point}\\p{Cc}]/gu";
