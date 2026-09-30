# Recordings

What each browser's `MediaRecorder` writes, kept so the suite admits and finishes real bytes
rather than a hand-built stand-in. Each is about two seconds of the browser's own test tone,
recorded on 2026-09-29 by a page that asked for one type at a time.

| File | Browser | Asked for | Reported |
| --- | --- | --- | --- |
| `chrome-152.webm` | Chrome 152, macOS | `audio/webm;codecs=opus` | `audio/webm;codecs=opus` |
| `chrome-152.m4a` | Chrome 152, macOS | `audio/mp4;codecs=mp4a.40.2` | `audio/mp4;codecs=mp4a.40.2` |
| `firefox-156.webm` | Firefox 156, macOS | `audio/webm;codecs=opus` | `audio/webm;codecs=opus` |
| `firefox-156.ogg` | Firefox 156, macOS | `audio/ogg;codecs=opus` | `audio/ogg;codecs=opus` |

Safari is missing: its recorder writes nothing without a person's click to start its audio.
Safari 26 reports `audio/mp4; codecs=mp4a.40.2` when asked for no type, and its MP4 is a
fragmented one under the `iso5` brand, which `SAMPLE_HEADS.iso5` in
`../admission/sample-files.test-support.ts` stands in for until a recording from Safari replaces it.
