# Media

Sample files the file field on `controls.html` holds and picks. None of them is product
content, and nothing loads them outside the design pages.

| File | What it is | Source and licence |
| --- | --- | --- |
| `repotting.mp4` | 18 s, 960×540, H.264, no sound | [Pexels video 9466222](https://www.pexels.com/video/a-person-transferring-a-plant-to-another-pot-9466222/), the 960×540 rendition, unchanged; Pexels licence (free to use, no attribution required) |
| `coffee-beans.jpg` | 800×800 JPEG | Rendered from `../logos/coffee-tasting-log.svg` |
| `morning-chimes.m4a` | 6 s, AAC | Made for this page: eight sine tones, encoded with `afconvert` |
| `voice-note.webm` | 7 s, Opus in WebM | Recorded by Chrome 152's `MediaRecorder` from a filtered tone and noise shaped into syllables and pauses, then finished by `../../scripts/lib/webm.js` with its length and an index |
| `repotting-guide.pdf` | One-page PDF | Written by hand for this page |
| `presupuesto.docx` | One-paragraph Word document, held as `Presupuesto año.docx` | Written by hand for this page |
| `potting-mix.txt` | Two lines of plain text | Written by hand for this page |
| `greenhouse-walk.mov` | A QuickTime header over bytes no decoder reads | Made for this page. Every browser refuses to play it, as it would a codec it lacks, so the page can show the download link that stands where the player would be |
| `creek-at-dusk.m4a` | An MPEG-4 audio header over bytes no decoder reads | Made for this page, for the same reason |
