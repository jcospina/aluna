# A voice note records in the field

Status: done — signed off by the owner on 2026-09-29

Type: HITL — microphone permission, recording formats and playback differ by browser, and
only a real browser with a real microphone shows them. A human records, stops and plays a
voice note in Chrome, Safari and Firefox, and recovers from a denied permission.

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
- `design/styles/components/controls/form-controls.css` is at its 500-line ceiling
  (`layout-kit.policy.ts`), so the recorder's styles need a stylesheet of their own.
- 7.2/03's admission rows are what admit a recording, so this issue cannot start before 03.

The upload path needs no change. `uploadTransfer` in `public/controls/file-field.js` sends any
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

- [x] **Design sign-off gate:** `design/controls.html` draws the empty field with Record,
      the recorder in every state (asking, recording, finishing, each refusal, each stop it
      makes itself) and the filled field after a recording; the human confirms the switch
- [x] Every field whose `accepts` holds `audio` offers Record; a browser without
      `mediaDevices` or `MediaRecorder` shows no Record button
- [x] Record asks the browser and records at once; denied, no-device and busy each leave
      the field empty with the reason and this browser's steps under it, and the file picker
      beside it *(priming and the microphone selector dropped by the owner)*
- [x] Record, Stop and Cancel work in the row, the timer runs, the live wave moves, and the
      microphone indicator goes out on stop, cancel and form close *(pause dropped by the
      owner)*
- [x] The recorder stops itself before the field's byte cap and says why
- [x] Stop uploads the recording and the field shows 03's filled audio state, where it plays,
      is recorded over or cleared *(review dropped by the owner)*
- [x] A recording from Chrome, Firefox and Safari is admitted to an audio field, and the
      test suite pins the admitted container for each
- [x] The open decision on Chrome's WebM duration is taken with the owner, and a recorded
      voice note shows its length and seeks in the record
- [x] The app CSP is unchanged: with no review step nothing plays from `blob:`, so the
      `blob:` this criterion asked for was taken back out
- [x] State changes are announced in a live region and focus follows the state
- [x] **Sign-off gate:** the human has recorded, stopped and saved a voice note, then played
      and seeked it in the record, in Chrome, Safari and Firefox, and has denied the
      permission once and recovered
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open the voice memos capability from 7.2/03 ("keep my
voice memos"). Add a record, press Record in the audio field, allow the microphone, record a
few seconds in the row and press Stop; the recording uploads and the row fills. Save the
record, open it, play and seek. Repeat in Chrome, Safari and Firefox, and once more after
blocking the microphone in the browser's site settings.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/03-an-audio-file-uploads-and-plays.md

## What landed

**The decision on duration, taken 2026-09-29 without the owner** (the session was told not to
wait), for the owner to confirm at sign-off. None of the three options was taken as written:

- The recorder asks for WebM first and MP4 only where a browser records nothing else.
- The page finishes a WebM before it leaves (`design/scripts/lib/webm.js`), writing its Duration
  and a Cues index, so the file itself carries its length and seeks. No media tool runs on the
  server.

What decided it, measured on real recordings:

- Chrome 152's MP4 recording has its length in Chrome, but reads as 0.02 s long and can't seek in
  Firefox 156; an `mehd` box doesn't help.
- A finished WebM from Chrome or Firefox shows its length and seeks in both, from `/files/:key`
  over Range.
- Firefox marks no Opus block a keyframe, which is why Chrome couldn't seek its WebM; the finisher
  marks them.

PLAN decision 29a records it, and decision 32 and ADR-0009 now carve the recording out of "no
`beforeunload`".

**Built past the design gate.** `public/` was wired before the owner confirmed the switch,
under the same instruction. Both are for the owner at sign-off:

- The filled state is 03's row whether the sound was uploaded or recorded, so it draws no
  waveform; the issue asks for one in the filled state as well. A waveform in every held sound's
  row would mean decoding each file.
- Record-in-place is a microphone square beside Replace, in 03's square pattern, rather than
  Replace offering both.

**The recorder.**

- `design/scripts/files/file-recorder.js` holds three states, asking, recording and finishing; a
  refusal (denied, no-device, device-busy, device-lost, failed, empty) hands the field its
  sentence, and `design/scripts/files/file-recording.js` wires Record, and a recording whose upload
  failed or was stopped, into the field.
- It is driven through `design/scripts/files/recorder-env.js`: the browser's media, the page's shared
  leave question, and a watch that stops listening when the field is hidden, as the create
  form's Back does.
- Its words and markup are in `design/scripts/files/recorder-parts.js`, which also covers each
  platform's recovery steps, the type preference, the name ("Voice note 2026-09-29 14.05.23.webm")
  and the container read from the bytes.
- Its styles are in `design/styles/components/controls/file-recorder.css`.

**The field.**

- `design/scripts/files/file-field.js` draws Record beside an empty well and the microphone square
  beside a held sound's Replace.
- It holds the save while audio is held ("I’m waiting on the recording…"), refuses a drop
  mid-recording out loud, and hands a kept recording to `take()` as a pick.
- `public/controls/file-field.js` passes the region release, so closing the form turns the microphone
  off.

**Server and supporting changes.**

- `media-src 'self' data: blob:` in the app CSP only, taken back out at the owner's second look: with no review step, nothing plays from `blob:`.

**Design page.** `design/controls.html`, under Files, has:

- a field that records from your own microphone;
- a field filled by a recording;
- nineteen fields that `design/scripts/sections/recorder-bench.js` walks into every state, on a stand-in
  microphone whose recording is `design/assets/media/voice-note.webm`;
- every browser's recovery steps;
- decision C21.

`design/design-system.md` describes the recorder.

**The recorder moved into the row, at the owner's second look (2026-09-29).** The owner asked
for the same upload control to record, rather than a separate panel. They chose each of these
when asked:

- Record starts recording at once, in the field's own row. Its first press is what makes the
  browser ask, and there is no priming step.
- While recording, the well holds the time and a short live soundwave, and Record gives way to
  Stop and Cancel as icon squares.
- Stop uploads straight away, and the row becomes 03's filled audio row. There is no review
  step; listening back, recording again and clearing are that row's.
- There is no pause, and the microphone is always the system default, with no picker.
- A refused, missing or busy microphone leaves the field empty. The reason and this browser's
  fix go in the guidance line.
- A recording that stops by itself is kept, and the reason stays under the field.
- A recording whose upload fails or is stopped stays on the field, unsent, with Upload again
  and Throw away, and the page guards it until it lands (added after review: it exists nowhere
  else).

Cancel throws the recording away without asking, since an icon pair has no room for a question.
The What to build section above predates this: its priming, microphone selector, pause and
review bullets no longer hold, and the criteria above are read against this.

**Signed off (2026-09-29).** The owner kept Cancel throwing a recording away without asking,
and asked that it look destructive. Cancel while recording and an unsent recording's Throw away
are now danger squares, and Record and the square that records over a held sound are primary,
the green of the product's main action. Cancel while the browser asks stays outlined, since
nothing has been recorded to lose. The owner then marked the issue done.

**The soundwave, after the owner's first look (2026-09-29).**

- The level and the waveform were forty thin bars, then briefly a smoothed outline; neither looked
  like sound.
- Both are now a soundwave: one stroke per moment, as tall as the
  loudest the sound got in it, mirrored about the middle line and never smoothed.
- The live level measures each moment's peak, not a compressed average.
- The design page's stand-in voice and sample recording are shaped like speech, with syllables
  and pauses, so the page shows what a voice note looks like.

**Routed on.** A `file[]` that takes audio offers Record too. 7.2/07 builds `file[]` and now
carries that as a criterion.

## Findings from adversarial review, all fixed

**Round one, the recorder's lifecycle.**

- **HIGH.** Two recorders shared one leave question, so one turned it off for the other. The
  page now counts holders.
- **HIGH.** The region hold ended at Stop, so closing the form in review left the leave question
  on and the recording's address alive. It now lasts the recorder's life.
- **HIGH.** A recorder the browser stopped on its own left the field on "Finishing" for good. The
  recorder's own stop is now tracked, and a Resume on a dead recorder ends instead of throwing.
- Hiding the field during Cancel's question left the microphone on.
- Each redrawn microphone list leaked a page-wide listener.
- Notes outlived their state.
- Record again showed the last recording's time.
- A superseded microphone request could land.
- The visibility watch missed a field already scrolled away, and needed `checkVisibility`.
- Start put the keyboard on Stop, so a held Enter could end the recording.
- A drop mid-recording was silent, and Record looked dead while the permission query ran.

**Round one, spec, design and copy.**

- The design page lacked the failed, empty, capped and fallback states, and showed only one
  browser's recovery steps.
- The filled row lost its name at 320 px; narrow rows now wrap.
- The confirmations used the primary variant rather than danger.
- An empty recording said the microphone hadn't started.
- "Keep recording" didn't resume.
- The recovery steps missed Android and Chrome or Firefox on iOS.
- The timer's label hid its time; the review's toggle was both renamed and pressed; the group was
  named twice.
- The fallback wasn't announced, and a failed start was silent.
- PLAN and C21 claimed Safari.
- `design-system.md` said nothing of the recorder.
- List fields were routed to 7.2/07; the Safari bytes and the design gate were recorded above.
- The level bars' fill is covered by the audit's fill inventory, since the contrast audit doesn't
  classify backgrounds as sites.

**Round one, the finisher.**

- A block shorter than its header threw and would have stuck the recorder.
- A Timecode wider than 128 bytes hung with unbounded memory.
- Memory peaked at about 10× the recording. The writer now sizes every element first and copies
  each frame once: a 58 MB hour peaks at 217 MB, down from 646 MB.
- Children overrunning their parent were copied as they were.
- An unsized block or a stray element swallowed later frames.
- Times running backwards produced unsorted Cues.
- Any EBML file was named `.webm`.
- Over 100k blocks in one cluster overflowed a spread.
- A video track would have been mis-cut.

The reader now refuses anything it can't read exactly, and the file goes up as it was. 10,000
fuzzed variants of the real recordings neither throw, hang nor lose a frame.

**Round two, on the fixes.**

- A review note came back on the next recording.
- The fallback note came back on every Record again.
- A late chunk after the form closed could turn the leave question back on for a dead recorder.
- A recording let go while it was being made was still announced.
- A request or a device change after teardown could turn the microphone on.
- A MediaRecorder that threw on `start()` escaped.
- A stale recorder's events weren't tied to their own instance.
- A permission query that never answered left Record dead; it now gives up after 1.5 s.
- A two-byte DocType size read wrong.
- Info's CRC-32 survived a changed Duration.
- The stop announcement said the timer's length rather than the file's.

**Reviews of the recorder in the row, all fixed.**

- **HIGH.** At narrow widths a container rule hid the timer, and the recording row didn't wrap as
  the empty row did.
- **HIGH.** A failed or stopped upload lost the recording for good. It is now kept unsent, with
  Upload again and Throw away, and the save and the leave question hold until it lands.
- **HIGH.** Double-clicking the upload's Stop reached Throw away.
- Focus landed on Stop and Cancel, so a held Enter or a double click undid Record.
  - It now lands on the words and the time.
  - Presses are ignored just after a recording change.
  - A held Enter never repeats inside the field.
- The save wasn't held while the browser asked.
- Cancel while asking said it had thrown a recording away, and the asking line didn't say what
  to do.
- A blocked microphone turned the empty well red.
- Two kinds of note leaked: one outlived the form or Cancel, and a stop reason was said twice or
  lost on a retry.
- A drop onto an unsent recording replaced it silently.
- A recording refused by admission was offered for retry.
- Closing the form around an unsent recording left its row behind.
- The wave's density drifted with the field's width; it is now measured.
- Nothing finished the file if a browser never sent its last stop; a 5 s watchdog now does.
- A field hidden while the browser asked kept asking.
- Safari may start the analyser suspended; it is now resumed.
- Recovery steps missed the computer's own privacy settings.
- The gallery lacked several states and a narrow field, and some docs were stale.

## Verification

**The recorder in the row, after the owner's second look (2026-09-29).**

- `bun run typecheck`, `bun run lint` and `bun run test` (4,075 tests) are clean.
- Live on `:3030` in the existing Voice memos capability (no capability created), in the
  Browser pane's Chrome, with a speech-shaped tone standing in for its blocked microphone:
  1. Record recorded in the row, with "Recording, 0:0x", the short wave, and Stop and Cancel
     squares; the save said "I’m waiting on the recording…".
  2. Stop uploaded "Voice note … .webm", and the row filled at 0:15.
  3. Saved, opened the record and its player: a 15.3 s duration, and a seek to 2.00 s with
     no error.
- `design/controls.html` walks all nineteen states, holds Finishing still, and keeps the timer
  in a 20rem field.

**Before the row (the panel recorder, since replaced).**

- `bun run typecheck`, `bun run lint` and `bun run test` (4,078 tests) are clean.
- Real recordings, captured on 2026-09-29, are kept in `src/platform/files/recordings/`:
  - Chrome 152 WebM and MP4, from the Browser pane;
  - Firefox 156 WebM and Ogg, from headless Firefox's fake microphone.
- Each is admitted through the upload route under the name and type the recorder gives it
  (`upload-route.recording.test.ts`). Safari's is its `iso5` head until a real Safari recording
  replaces it: Safari can't be driven here.
- Live on `:3030`, in the existing Voice memos capability, with no capability created: headless
  Firefox recorded from its fake microphone, and Chrome in the Browser pane recorded from a tone
  standing in for its blocked microphone. Each ran the flow end to end:
  1. Record, prime, Continue, ready.
  2. Start, with the level moving, the timer running and "Recording." said.
  3. Pause ("Paused at 0:01."), Resume, Stop.
  4. Review, playing from `blob:` with its waveform, and the file's own length said.
  5. Use the recording: it uploads and the filled row shows its time.
  6. Save, open the record, open the player: a finite duration, and a seek to 1.5 s with no
     error.
- The pane's real microphone is blocked, which showed the denied state and its Chrome steps.
  Cancel returned the keyboard to Record.
- `design/controls.html` walked all sixteen of the panel's states, and no row overflowed at 375 px.

