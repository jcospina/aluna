# Saved documents

Word documents as a word processor saves them, kept so the suite admits real bytes rather than a
hand-built stand-in. Each holds the same three lines of Spanish text, saved on 2026-09-30 by
macOS 26.6.2's `textutil`, which writes through the same Cocoa writers TextEdit uses.

| File | Command | Container |
| --- | --- | --- |
| `textutil.docx` | `textutil -convert docx` | A zip of 8 parts: the main document, a theme, and document properties |
| `textutil.doc` | `textutil -convert doc` | An OLE2 compound file holding `WordDocument` and `1Table` |

A password-protected DOCX is missing: nothing on this machine writes one. The suite locks one
with `compoundFileOf(LOCKED_WORD_STREAMS)` in `../office-samples.test-support.ts`, which lays
out the streams Office writes around an encrypted package.
