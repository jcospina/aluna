# A voice note records in the field

Status: ready-for-agent

Type: HITL — microphone permission, recording formats and playback differ by browser, and
only a real browser with a real microphone shows them. A human records, reviews and plays
a voice note in Chrome, Safari and Firefox, and recovers from a denied permission.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 2, 3, 5 and 29; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

This issue extends the epic past PLAN.md at the owner's request (2026-09-28): an audio
field records a voice note as well as taking an uploaded file. It lands straight after
7.2/03 so audio is finished before the document issues start.

## Why this is its own issue

The scope analysis for 7.2/03 found that a recorder is a whole control, not a row in 03:

- `design/` holds no recorder, and `design/` is the product spec, so the control is drawn
  there first (`design/controls.html` and a new `design/scripts/` module) before
  `public/` wires to it.
- The app's CSP (`src/server/app.ts`, `APP_SECURITY_HEADERS`) has `media-src 'self' data:`,
  which blocks the `blob:` URL a recording plays from before it is uploaded.
- `design/styles/components/form-controls.css` is at its 500-line ceiling
  (`layout-kit.policy.ts`), so the recorder's styles need a stylesheet of their own.
- 7.2/03's admission rows are what admit a recording, so this issue cannot start before 03.

The upload path needs no change. `uploadTransfer` in `public/file-field.js` sends any
`Blob` with a name and a type, so a finished recording enters it as a picked file does.

## What to build

**Every audio field can record.** No spec flag and no generation change: wherever
`accepts` holds `audio`, the control offers recording. A field accepting several families
offers it too, and the recording counts as audio.

**The switch from upload to record.** The owner flagged this as the critical UX problem.
Research (below) compared six options. The recommendation, to be drawn in `design/` and
confirmed at the design sign-off gate before any `public/` work:

- The empty drop zone keeps "choose a file" and gains a peer button in the same frame: a
  microphone glyph with a visible "Record" label.
- Record turns the field into the recorder in place, with no modal, and focus moves to
  the recorder's main control.
- Cancel returns to the empty drop zone. It asks before discarding only when audio has
  been captured.
- The filled state is the same whether the sound was uploaded or recorded. Replace offers
  both "choose a file" and "record again", and the held file stays until a new one
  commits.
- Where recording can't work (no `navigator.mediaDevices` outside a secure context, no
  `MediaRecorder`), the Record button is not drawn.

| Option | Why not chosen |
|---|---|
| Upload / Record tabs above the field | Switching tabs mid-recording has no clear meaning, and a tab switch is not intent to record, so the permission prompt arrives unasked |
| Recorder first, with an "or upload a file" link (Typeform, VideoAsk) | Right for a voice-only field; hides upload for a general audio field |
| Split button ("Add audio ▾") | Hides both choices behind a menu |
| `<input accept="audio/*" capture>` | Desktop ignores it, it is not Baseline, and it gives no review before saving |

Slack keeps record and attach as side-by-side peer actions. NN/g and web.dev both put a
permission request after an action that explains it; Chrome's data has 12% of prompts
accepted without user intent against 30% after an interaction.

**The recorder.** States: `ready` → `recording` ⇄ `paused` → `review` → committed, with a
`priming` step before the first browser prompt and error states `denied`, `no-device`,
`device-busy` and `device-lost`.

- *Priming.* Record queries `navigator.permissions.query({ name: "microphone" })`, inside
  a try/catch. On `prompt`, one line explains that the browser will ask for the microphone
  and a Continue button calls `getUserMedia`. On `granted` the recorder goes straight to
  `ready`. On `denied` it shows the recovery state.
- *Denied and failures.* `NotAllowedError` shows per-browser recovery steps (Chrome site
  settings, Firefox's permissions icon or a reload, Safari's Websites settings, iOS
  Website Settings). `NotFoundError` is no microphone, `NotReadableError` and
  `AbortError` are a microphone another app holds. Every error state offers
  "upload a file instead".
- *Microphone selector.* Filled from `enumerateDevices` after permission, because labels
  are blank before it, and refreshed on `devicechange`. A chosen microphone that
  disappears (`OverconstrainedError`, or a track `ended` mid-recording) falls back to the
  default and says so.
- *Waveforms.* A live level from an `AnalyserNode` while recording proves the microphone
  hears something. The review state and the filled state draw the recorded waveform from
  its peaks. Neither is the only signal: the state text and the timer carry the meaning,
  and `prefers-reduced-motion` stills the live one.
- *Record, pause, resume, stop.* An elapsed timer (`role="timer"`). The recorder stops
  itself before the field's byte cap, measured from the chunks it has gathered, and says
  why. Stop calls `track.stop()` on every track so the browser's microphone indicator goes
  out; so does Cancel, and so does closing the record form (the region release 7.1 built).
- *Review.* A preview player with the recorded waveform and duration, and three actions:
  use the recording, record again (confirmed), discard. Use the recording hands a `File`
  to the existing upload path, and the field then shows 03's filled audio state.
- *Leaving mid-recording.* A `beforeunload` guard holds while audio is captured and
  uncommitted, and lifts on commit or discard.
- *Accessibility.* Visible text on every button; a polite live region announces
  recording started, paused at a time, stopped with its length, and the byte-cap stop;
  focus moves to each state's main control and back to Record after Cancel; no
  single-key global shortcuts.

**Formats and admission.** The recorder tries types with `MediaRecorder.isTypeSupported`
and trusts `recorder.mimeType` once started. Chrome and Firefox record
`audio/webm;codecs=opus`; Safari 14.1 to 18.3 records only `audio/mp4`, and 18.4 added
WebM/Opus. Firefox cannot record MP4. The file is named for its container, `.webm`, `.m4a`
or `.ogg`, with a name a person can read in the record (the date and time it was
recorded). Admission already strips `;codecs=` before its contradiction check
(`declaredType` in `admission.ts`). This issue proves each browser's recording is
admitted by 03's rows, and checks the `ftyp` brand Safari writes against 03's `.m4a` row,
widening the row if Safari writes a brand 03 does not list.

**The page policy.** `media-src` gains `blob:` in the app's CSP so the review player can
play the unsaved recording. `/files/:key`'s own player policy is unchanged. The app sends
no `Permissions-Policy` today, so the microphone is allowed for the page itself; if one is
added it must allow `microphone=(self)`.

**Open decision: a Chrome recording's duration.** Chrome's WebM carries no Duration
element and no Cues, so `audio.duration` is `Infinity`: 03's filled state shows no time
and the render view can't seek. Three ways out, to be put to the owner before building:
patch the Duration element on the client before upload (fixes the time, not seeking);
remux on the server (fixes both, adds a media tool to the server); or prefer MP4 where
Chrome 126+ can record it and keep WebM for Firefox (narrows the problem to Firefox, whose
WebM needs checking). WebM/Opus also failed to play on iOS roughly 15.4 to 17.3; the
render view's download fallback from 03 covers that case.

**Browser facts left unverified by the research,** to check live: Safari 18.4's default
type when none is given, `decodeAudioData` on WebM in Safari (the recorded waveform needs
it), and whether iOS mutes the microphone when the tab goes to the background (handled
by `device-lost`).

## Acceptance criteria

- [ ] **Design sign-off gate:** `design/controls.html` draws the empty field with Record,
      the recorder in every state (priming, ready, recording, paused, review, each error)
      and the filled field after a recording; the human confirms the switch before
      `public/` wiring starts
- [ ] Every field whose `accepts` holds `audio` offers Record; a browser without
      `mediaDevices` or `MediaRecorder` shows no Record button
- [ ] Permission is primed before the browser prompt, and denied, no-device and busy each
      show their own state with recovery steps and "upload a file instead"
- [ ] The microphone selector lists devices after permission, follows `devicechange`, and
      falls back to the default when the chosen one goes away
- [ ] Record, pause, resume and stop work, the timer runs, the live level moves, and the
      microphone indicator goes out on stop, cancel and form close
- [ ] The recorder stops itself before the field's byte cap and says why
- [ ] Review plays the recording with its waveform; record again and discard work; use the
      recording uploads it and the field shows 03's filled audio state
- [ ] A recording from Chrome, Firefox and Safari is admitted to an audio field, and the
      test suite pins the admitted container for each
- [ ] The open decision on Chrome's WebM duration is taken with the owner, and a recorded
      voice note shows its length and seeks in the record
- [ ] `media-src` allows `blob:` in the app CSP and nowhere else
- [ ] State changes are announced in a live region and focus follows the state
- [ ] **Sign-off gate:** the human has recorded, paused, resumed, reviewed and saved a
      voice note, then played and seeked it in the record, in Chrome, Safari and Firefox,
      and has denied the permission once and recovered
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open the voice memos capability from 7.2/03 ("keep my
voice memos"). Add a record, press Record in the audio field, allow the microphone,
record a few seconds, pause, resume, stop, play it back in review and use it. Save the
record, open it, play and seek. Repeat in Chrome, Safari and Firefox, and once more after
blocking the microphone in the browser's site settings.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/03-an-audio-file-uploads-and-plays.md
