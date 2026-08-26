# One claimed generation attempt after v1 activation, stored once under the incarnation root

Status: done

Type: HITL — this slice spends real credits and needs a human to look at the
artwork. Implementation is fully specified and agent-ready; sign-off is the gate.

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decisions 37, 41; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

The first generation attempt is a **post-build follow-up to a successful v1**,
through the same claim operation and platform route the desk-load sweep will use.
The activated `absent` tile carries one load-triggered, same-origin POST to
`/capability/:id/:incarnation_id/logo-attempt`; this is a paid mutation and is
never a GET. The response replaces only that tile with its then-current
registry-backed rendering and is `no-store`; even if the attempt returns to
`absent`, that response is inert and does not carry another load trigger. Only a
fresh desk render or newly activated tile may arm one attempt. The activation
transaction first commits seed plus `absent/0`; the presenter reaches its terminal
path and the long build lease releases; only then may the follow-up acquire a
short coordinator claim (a request arriving earlier waits in ordinary FIFO order).
The build SSE need not stay open to carry the artwork. The Gate, snapshot publication and SQLite activation
have already succeeded, so no refused or never-activated build pays for artwork,
there is no nested coordinator acquisition, and provider failure cannot change
`success/activated` into failure. Evolution never enters this path. A crash in
the gap is harmless: the next desk load sees `absent/0` and offers the same claim.

- One request per **claimed attempt** to the hosted vector service, at roughly
  $0.08 a call, and at most one accepted artwork per incarnation. Model, style and substyle, size, response format and `controls.no_text`
  are held constant for every capability and no caller may vary them. What varies
  is short: the capability's two authored colours — the ground first, then the
  companion — the background colour pinned to that same first colour, the stored
  `random_seed`, and the prompt block with its subject slot filled.
  The ground is named twice — once in the control and once in words inside the
  prompt — because naming it in only one of the two places does not work.
- **The artwork is `capabilities/<id>/<incarnation_id>/logo.svg`, beside the
  immutable `vN/` directories rather than inside one.** Retry is therefore able
  to create the file after activation without mutating a published snapshot or
  falsifying `snapshot.json`'s exact inventory. Capability deletion already owns
  the whole incarnation tree, so no second cleanup path is introduced.
- The claim atomically moves `absent → generating` and increments `attempts`
  before the call, through a short coordinator write bound to the exact active
  incarnation. Provider I/O then holds that incarnation's read token and observes
  its cancellation signal. Successful bytes are written to a same-filesystem
  temporary file and installed with no overwrite while the token is still held.
  The token releases before a second short coordinator write revalidates the
  active incarnation and marks `present` — never await a queued coordinator
  acquisition inside the read-token scope. If deletion closes the gate, the call
  aborts and no late response can recreate the tombstoned artifact tree.
- **A failed call does not fail the build.** It returns `generating → absent`
  unless the third claimed attempt has failed, in which case it becomes
  `abandoned`. The capability remains finished, usable and placeholdered; the
  sweep in 5.5/04 is what tries again.
- Each attempt has a bounded timeout and validates the provider envelope, base64
  decoding and an SVG document root before installation. Validation does not
  strip or rewrite accepted SVG bytes. Timeout, cancellation, malformed output or
  install failure counts as a failed claimed attempt, removes its temporary file
  in `finally`, and leaves no untracked staging artifact.
- **The prompt block may be edited freely and owes no versioning.** The worry that
  editing it breaks retry-determinism does not survive L7: a logo is made once and
  never remade, so a retry is always for a capability that has no picture at all,
  and there is nothing for it to be inconsistent with. Nothing requires two
  capabilities to look like they came from the same era either.

The credit budget is a hard ceiling, not a target. Agree the number of live
generations with the human before spending any, and drive the automated tests off
stored specimens rather than the live service.

## Acceptance criteria

- [x] A successfully activated v1 commits `absent/0`, finishes presentation and
      releases the build lease before the first claim; evolution and every
      non-activated terminal make none
- [x] Only an `absent` registry-backed tile emits the incarnation-bound
      load-triggered POST; the paid operation is never GET/cacheable and its
      response replaces only that tile without recursively arming another attempt
- [x] The constant fields are not caller-variable; the two-colour request is
      exactly the authored ground followed by the authored companion, with the
      background pin, seed and filled subject slot as specified
- [x] The ground is named both in the control and in the prompt text
- [x] The artwork lands atomically at the incarnation-root logo path, outside all
      immutable `vN/` inventories, and the logo state becomes `present`
- [x] A publication or activation failure spends no logo call; a post-activation
      logo failure cannot relabel the activated build or its metrics
- [x] Claim and finalization are short coordinator writes; provider/install work
      holds the exact read token, responds to cancellation, releases it before
      reacquiring mutation ownership, and cannot resurrect files after deletion
- [x] A failed or unavailable service leaves a finished, usable, placeholdered
      capability — the build does not fail
- [x] No automated test calls the live service
- [x] Timeout/malformed/cancel/install-failure paths consume the claimed attempt,
      remove temporary bytes, preserve any prior final file, and never leave
      `generating` without a deterministic recovery outcome
- [x] **Sign-off gate:** the human has looked at the generated artwork on the desk
      and accepted it
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability from the prompt bar and watch its placeholder tile become real
artwork through the tile follow-up after v1 activates, even though the build
stream has already ended. Then build a second one with the network
to the service unavailable and confirm the capability is finished, usable and
still placeholdered.

## Blocked by

- modules/05-the-desk/5.5-capability-logo/issues/01-spec-and-registry-carry-the-logos-inputs-and-state.md

## Notes

### What the shape became

`src/capability-logo/` is the whole delivery half, in five pieces that each hold
one property:

- **`request.ts`** — every constant is a module-level literal and
  `buildLogoGenerationRequest` takes *only* the claim's `subject`, its two colours
  and its `seed`. "No caller may vary the constants" is therefore a fact about the
  signature, not a rule anyone has to remember: there is no second parameter and
  no knob in the object it returns.
- **`provider.ts`** — the `LogoGenerationProvider` seam, and the Recraft client
  behind it. Every test injects the seam; no automated test reaches the network.
- **`storage.ts`** — `link` + `unlink` rather than `rename`, because `rename`
  clobbers silently and L7 says an accepted drawing is never remade.
- **`attempt.ts`** — the claimed attempt, and the ordering the ADR fixes.
- **`routes.ts`** — the two addresses a tile talks to.

Three decisions in there were not obvious:

**The POST lives on the tile `<span>`, not on the logo button.** htmx honours one
verb per element and `hx-get` wins. The button already carries `hx-get` for the
click that opens the capability, so putting the attempt on it would have silently
fired the GET and never claimed anything. The span targets the button by id and
swaps `outerHTML`.

**The request is verified against Recraft's own OpenAPI document**, not against
memory: `controls.colors` is an array of `{ rgb: [r, g, b] }`, `random_seed` is a
uint32, and the envelope is `{ created, credits, data: [{ image_id, b64_json }] }`.
The eight anchors' RGB values are cross-checked against `design/styles/tokens.css`
by a test, the same way `design-tokens.test.ts` cross-checks their names. Both
colours are named in words as well as in the controls, because L2 records that the
control alone is ignored — an authored companion that reached the service only as
`controls.colors[1]` would be a stored fact with nothing visible behind it.

**The prompt block is not a literal in the code.** `request.test.ts` reads the
block out of `design/logo.html`, fills all three `<mark>` slots, and asserts byte
equality with `buildLogoPrompt`. The contract page *is* the contract, so editing
the block means editing the page and the code follows. Verified to bite: dropping
one word from the code fails that test.

### Adversarial findings, and what they changed

Three review rounds ran before a credit was spent. Two of the findings were
serious.

**Installing a logo made the platform unbootable.**
`artifact-reconciliation.ts` enumerates `capabilities/<id>/<incarnation>/` at
boot, at the head of every new-capability build and at the head of every
evolution, and throws on any entry that is not `.publish-lock`, `.staging` or
`vN`. The artwork's whole reason for living beside the `vN/` directories is that
it is not inside one — and the tree's grammar had never been taught about it. Two
independent reviewers reproduced it end to end: the first capability to grow a
face made every later build fail and the server refuse to start. The names now
live once, in `src/capability-logo/artifact-names.ts`, imported by both the
installer and the reader. A crashed attempt's `.staging/logo-attempt-N.svg` had
the same problem and the same fix; reconciliation deliberately *tolerates* it
rather than sweeping it, because that pass also runs while an attempt may be
mid-write, and removing a live attempt's staging file would break the claim it
has already paid for. Sweeping stale ones is 5.5/04's.

**With no key set, three desk loads abandoned every logo permanently.**
`requireRecraftApiKey` throws inside `generate`, which the attempt swallows as an
ordinary failure — so an unconfigured machine spent all three attempts without a
single request leaving the process, and nothing ever decrements one. The claim is
now preceded by a preflight that asks two questions the answer to which is knowable
before spending: is the provider configured, and is this incarnation's read gate
open. The same preflight closes a smaller version of the same harm — a deletion
draining its readers used to burn attempts with no provider call.

The rest, and what each changed:

- **The timeout did not cover the body read.** A service answering its headers
  promptly and then dribbling 111 kB forever would have held the incarnation's
  read token past deletion's drain deadline. One budget now spans the whole call.
- **The prologue scanner rejected valid SVG twice.** A prologue longer than the
  4 kB fast window was refused outright — the window is now an optimization with a
  full re-read behind it, because a false rejection throws away a paid generation.
  And a greedy DOCTYPE internal subset ran to the last `]` in the document, so a
  DOCTYPE followed anywhere by CDATA swallowed the root; it is lazy again, with a
  comment saying why the two are not interchangeable.
- **htmx's history cache was a fourth arming source.** The logo button carries
  `hx-push-url`, so opening a capability snapshots the desk under the previous URL
  and Back re-processes it, re-firing every `hx-trigger="load"` in it. An attempt
  runs for the better part of a minute, so a snapshot taken mid-attempt was armed,
  and a few taps of Back would spend all three. `public/logo-attempt.js` disarms a
  tile the moment its request starts; htmx snapshots the live DOM, so a tile that
  has fired can never be restored armed.
- **The paid POST had no origin guard.** Any page the user visited could have
  posted a plain cross-origin form at it and burnt three attempts. It now requires
  `HX-Request: true` — a custom header, so a cross-origin request carrying it needs
  a preflight this route never answers, and htmx always sends it.
- **Evolution's tile re-render armed an attempt.** A rename re-renders the tile,
  and a still-faceless capability would have got a free extra attempt for every
  rename. It renders inert now; only a fresh desk render or a newly activated tile
  arms one.
- **`/demo/swap-targets` fired a real POST at the paid route** and then deleted its
  own logo button — the element the rehearsal exists to exercise. Its synthetic row
  is `abandoned` now: the one status meaning "no artwork, and none coming".
- **A discard that trusted a path.** When the registry write moved nothing — the
  row deleted or settled by something else mid-draw — the installed bytes are
  unacknowledged, unservable, and would fail every later attempt on EEXIST, so
  they are removed. It identifies the file **by inode**, not by path: "only this
  attempt could have written here" is an invariant of today's single-claim
  lifecycle, and 5.5/04's sweep is exactly the code that could add a second
  writer, while removing *accepted* artwork is unrecoverable.
- **Four ground phrases argued with the prompt they sit in.** The block's closing
  sentence asks for daylight colours at high chroma and bans pastels and dark
  backgrounds; "pale sky blue", "deep forest green", "muted teal" and "soft
  lavender" were written three lines above it. `sky` also named a place the block
  bans in the same breath ("no horizon, no ground line"). Both ban lists are now
  tests. `teal` was separately just wrong — `#3e9e92` is teal, not sea green.
- **Outcomes that lied.** `finalizeAttempt` reported `installed`/`failed` even
  when the registry write changed nothing; there is a `superseded` outcome now.
- Four tests that could not fail were rewritten, including one whose `expect` sat
  inside an injected provider and was swallowed by the attempt's own catch.
- The module was silent about every failure; a failed attempt now says why, except
  for a cancellation, which is a designed outcome rather than an error.

### The colour contract changed under this issue

The sign-off is where the eight anchors were first judged against two *real*
capabilities rather than four hand-picked specimens, and it failed. Both tiles came
out wearing the same two colours, and the reason was structural rather than bad
luck: 5.5/01's companion lookup was closed and symmetric — leaf/shade, teal/sky,
sun/ochre, clay/violet — so **the whole product had four distinct colour pairs.**
Two capabilities collide 25% of the time, four collide 91% of the time, and five
collide with certainty. A desk of five cannot avoid two tiles wearing the same two
colours, and no number of capabilities makes it better.

The lookup existed to keep the second colour from being a fourth authored fact and
to keep presentation out of the call site. It kept both. What it also did was cap
the product, and four specimens is exactly the sample size at which that is
invisible.

So the model now names the companion too. It is one of the same eight anchors, it
must differ from the ground — a refinement over the whole spec object, because a
per-field enum cannot see two fields at once — and it is the colour the object
itself is drawn in, where the ground is the field it stands on. That is 56 ordered
pairs against four, and it makes the ADR's own argument for model choice ("the
colour stays apt — telescope on sky, recipes on ochre") reach the second colour.
`logoRequestColors` is still the one place the ordering is fixed, so the caller
still chooses nothing.

This is a contract change, not an implementation detail, and it is recorded where
contracts live: ADR-0007 carries a 2026-08-25 amendment, `design/logo.html`'s
per-capability table and L2/L3 are rewritten, `CONTEXT.md` gains a **Companion
colour** term, PLAN decisions 39 and 42 are amended, and 5.5/01 carries a
"superseded in part" note at its head.

**It cost a reset.** `capabilitySpecSchema` is strict and every published
`vN/spec.json` is re-parsed against it — at boot, at the head of every build and at
the head of every evolution. A required fourth key makes every existing snapshot
fail, and the server stops booting. Keeping the two paid logos would have meant
hand-writing an artifact-contract upgrade — rewrite five `spec.json` files,
recompute each file digest inside its `snapshot.json`, recompute each
`snapshot_content_digest` — which is machinery `docs/architecture.md` defers past
M9. The corpus was reset instead, on the human's call, and the two credits already
authorised went to rebuilding rather than to preserving two drawings that were the
problem in the first place.

One thing the reset made visible: while the schema had the new required key and the
corpus did not, `bun run dev` crash-looped on boot and pegged the machine hard
enough to time out a third of the suite. The failures were not real; the loop was.

### Not fixed, and deliberately

- **Two anchors argue with the block's own closing sentence.** `violet` (#9a86c4)
  is S34/L65 — a pastel by any ordinary reading — and `shade` (#2a7a45) at L32 is
  the darkest anchor. Both are pinned as `background_color` while the prompt says
  "no dark backgrounds, no pastels" ten lines later, and L2 records that this model
  follows the words. Either the closing sentence or those two anchors has to give,
  and both belong to `design/logo.html` — a design call, not an implementation one.
  Neither capability in the live test used them.
- **An install followed by a structural failure leaves an orphan.** If the
  finalizing coordinator write throws, or the process dies between install and
  finalize, the file is on disk and the row is stuck `generating`. Reconciliation
  deliberately does not touch either; recovering an interrupted claim is 5.5/04's
  by contract.
- **A concurrent claim loser returns instantly** rather than waiting a bounded
  moment for the winner. ADR-0007 asks for the bounded wait; 02's acceptance list
  does not, and 04's does.

### Demo-vs-real boundary, and what this took from 5.5/03 and 5.5/04

**5.5/02 built most of 5.5/03.** This issue's own living demo requires watching a
placeholder become real artwork, which is not possible without serving the bytes.
`GET /capability/:id/:incarnation_id/logo.svg` therefore exists here, gated on a
matching active incarnation being `present`, holding that incarnation's read token
while it serves, declared `image/svg+xml`, `nosniff`, `inline` and sandboxed by
CSP. **What is genuinely left for 03 is the `immutable` cache directive and the
compressed response** — the route currently answers `no-store` even when present,
which is the opposite of what 03 requires and is a deliberate placeholder no test
pins.

**5.5/04's arming half is also done.** Every full desk render arms one attempt per
`absent` tile, which is the sweep. 02's text sanctions that ("only a fresh desk
render or newly activated tile may arm one"), so this is widening by permission
rather than contradiction — but 04 is now a smaller issue than its acceptance list
implies. What remains for it: interrupted-`generating` recovery, the stale
attempt-temp sweep, `present`-with-missing-file reconciling to `abandoned`, the
bounded wait a claim loser owes, and moving the three-attempt cap into the claim's
`WHERE` where 5.5/01 recorded it belongs.

**All five were delivered in 5.5/04** (2026-08-26), along with the in-process
running-claims set that is what tells a live claim from a crashed one.

`docs/adr/0007`'s "None of the delivery half is built" paragraph was true when it
was written and is not now; it has been replaced with what is built and what is
left. `CONTEXT.md` needed nothing — it already describes this behavior.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1516 passed, 0 failed, ~75s across two shards. Typecheck and
lint clean.

New coverage:

- `src/capability-logo/request.test.ts` — the five constants are the contract's
  literals and every capability's request carries them; the builder takes one
  input and returns no knob; two capabilities differ in exactly `prompt`,
  `random_seed` and `controls` and nothing else; the colours are the ground first
  and its authored companion second with the background pinned to the first; every
  anchor's RGB is the hex `design/styles/tokens.css` declares; the block is
  byte-identical to `design/logo.html` with both slots filled; the subject is
  wrapped rather than trailing; no phrase argues with the block's own bans and
  none names a place it forbids.
- `src/capability-logo/provider.test.ts` — a missing key names itself; the request
  goes out as a bearer-authorized POST with the exact body; the four shipped
  specimens decode and validate byte-for-byte with their provenance intact; a
  non-2xx, a non-JSON body, an imageless envelope, junk base64, an HTML document,
  a call over budget and a body that never finishes arriving are each the right
  kind of failure; a cancelled attempt opens no request at all; the prologue
  scanner takes a BOM, an XML declaration, a DOCTYPE with an internal subset
  containing `]`, a DOCTYPE followed by CDATA and an 8 kB comment, and refuses
  `<SVG`, `<svgx`, `<html><svg/>` and 8 kB of junk.
- `src/capability-logo/storage.test.ts` — the path is beside the `vN/` directories
  and never inside one; the exact bytes land and no staging artifact survives; a
  second install is refused and the first drawing survives; two incarnations keep
  separate artwork; the tree carries it away.
- `src/capability-logo/attempt.test.ts` — a successful attempt installs and marks
  `present` from the row's own stored inputs; a second is never claimable; a
  failure spends the claim, returns to `absent` and writes no file; four different
  throw shapes never strand the row in `generating`; a refused install removes its
  temp and preserves the prior file; the third failure abandons and there is never
  a fourth call; an unconfigured provider and a closing gate spend nothing however
  many times the desk loads; the claim waits in FIFO order behind a held build
  lease; provider work observes the cancellation signal; neither coordinator write
  is made with a read token outstanding; a discard removes only the file this
  attempt installed.
- `src/capability-logo/routes.test.ts` — the attempt claims, installs and answers
  with the real tile; a GET of the same address is not a route; a POST that did
  not come from the tile reaches nothing; the response is `no-store` and carries
  one button with no OOB; the tile it answers with is inert even while still
  `absent`; a mismatched incarnation claims nothing; the logo route serves a
  present incarnation's bytes as a picture, 404s `no-store` when absent or missing
  or mismatched.
- `src/app/app.spec-build-logo.test.ts` — a real prompt→build→commit orders
  nothing and the activated tile arms one attempt bound to the minted incarnation;
  a logo failure afterwards leaves the metrics row, the version, the incarnation
  and the artifacts path untouched and the capability still opens; a build that
  fails the Gate orders nothing and stands no armed tile; reconciliation accepts a
  real published tree that has grown a face.
- `src/builder/artifacts/artifact-reconciliation.test.ts` — the artwork and a
  crashed attempt's staging bytes are known state and never removal candidates; a
  symlink wearing either name fails closed; four near-miss names are still judged
  as staging builds. Verified to bite: all three fail without the fix.
- `src/presentation/logo-attempt.test.ts` — the client disarm, and what it does
  and does not establish.
- `src/web/fragments.test.ts` — an absent tile arms one incarnation-bound attempt;
  the attempt is on the tile and never on the button; a tile answering an attempt
  is inert; `generating` and `abandoned` claim nothing; a present tile is the
  artwork addressed by its own lifetime; an activation arms one, an evolution
  arms none, a fresh desk render arms one per faceless capability.

### Live evidence

Against the dev server on `:3030` with the real Recraft key. Budget agreed with the
human beforehand: **two live generations, spent only once implementation and
adversarial findings were solved.** Two were spent.

The evidence below is the *second* live run. The first spent both credits before the
colour contract changed, and the corpus it produced was reset — what it proved is
recorded under "The colour contract changed under this issue", because the artwork it
produced is what caused the change.

| step | result |
| --- | --- |
| desk load, endpoint pointed at an unroutable host | both tiles fired their attempt, both failed, both returned to `absent`/1, nothing spent |
| the tiles that came back | plain placeholders with no `hx-post` and no `hx-trigger` — one attempt per page load, no recursion |
| opening a faceless capability | finished and usable: *"Nothing here yet — add your first entry above"* |
| build *"I want to keep track of my notes"* | model authored `subject: "an open notebook"`, `ground: sky`, `companion: violet` — a pair the closed lookup could not produce |
| build *"I want to log the plants I water"* | `subject: "a watering can"`, `ground: leaf`, `companion: sky` — under the old lookup `leaf` was locked to `shade`, so a plant capability was *guaranteed* a green-on-green tile |
| both tiles | one attempt each, `present`/1 — exactly two generations |
| the desk | two drawings that read as clearly different from each other, both legible at 64px and at 20px |
| `GET …/logo.svg` | `200`, `image/svg+xml`, `nosniff`, `inline`, sandboxed CSP |
| `GET …/logo-attempt` | `404` — the paid operation is never a GET |
| `POST …/logo-attempt` without `HX-Request` | `404` — only the tile can reach it |
| both delivered files | zero `<script>`, zero event handlers, zero `javascript:` |
| `.staging` after both installs | empty |

**Three builds were refused before those two landed**, all by the behavioral Gate on
its own generated tests — a missing-required-fields case and an ordering case that did
not match their handlers. A refused build costs nothing: no capability row, no claim,
no credit. That is decision L10 working exactly as written, and it is the reason the
two credits went to activated capabilities rather than to refused ones.

**The green-subject collision did not happen.** `companion ≠ ground` is the one spec
rule a JSON Schema cannot carry — an enum pins eight values, nothing in the wire
format says "not that one" — so a plant capability was the likeliest place for the
model to name `leaf` twice and kill the build on the refinement. The plant was chosen
deliberately for that reason. It held.

**A prompt bias the human caught, not a reviewer.** Both live capabilities carried
`sky`, and the question "is that instructed?" turned out to have an uncomfortable
answer: the two colour instructions named `sky` twice and `ochre` twice, and named
`shade`, `teal`, `sun` and `violet` not at all. The ground line carries ADR-0007's own
example ("a telescope on sky, recipes on ochre") and this issue then wrote the
companion example as *"a brass telescope in ochre on sky"* — same subject, same two
anchors. Worked examples are the most concrete thing in an instruction. The examples
are now *"a red kettle in clay on leaf, a folded map in sun on teal, a fern in shade
on violet"*, so every anchor is named exactly once across the two lines, and
`spec-gen.test.ts` fails if any is favoured or dropped. Two builds cannot say whether
the lean caused those two picks; the scale is level now and it was not before.
**It was not the cause.** Five probe builds against the levelled prompt collapsed onto
a different value instead; the examples were removed entirely and the entropy moved to
the seed. That test is gone, replaced by one that no hue is named in the colour
instructions at all.

## HITL — how to check this

The dev server on `:3030` (start it with `bun run dev` if it is down). The corpus was
reset when the colour contract changed — migration `0013` adds a `companion` column
with no default, so a row written before it reads back NULL and throws. If you are on
a database that predates the migration, `bun run reset` first; the desk you are
looking at was built after it.

1. **The desk has faces.** Open `http://localhost:3030`. *Notes* and *Watering Log*
   are drawn tiles, not hatched placeholders — with the 10% corner, the hard shadow,
   and the name written straight onto the wallpaper. They are visibly different
   colours from each other, which is the whole point of this issue's amendment.
2. **The two colours are the model's, and they differ.** Open the developer panel (the
   `</>` control) and read the **Commit** pane: `ground`, `companion`, and the `colors`
   pair in that order. `sky`+`violet` and `leaf`+`sky` — neither pair was reachable
   under the closed lookup, where `sky` was locked to `teal` and `leaf` to `shade`.
3. **Nothing is re-ordered by looking at it.** Reload a few times. The tiles do not
   change. A logo is made once and never remade.
4. **The address is honest.** Open a capability's `logo.svg` directly (the developer
   panel gives you its incarnation id) — the drawing renders, and renders as a picture
   and nothing else. Change one character of the incarnation id: `404`.
5. **The paid door is shut to everything but the tile:**

   ```bash
   curl -i -X POST http://localhost:3030/capability/notes/$(bun -e 'import{Database}from"bun:sqlite";process.stdout.write((new Database("data/omni-crud.db",{readonly:true}).query("SELECT incarnation_id FROM capability_registry WHERE id=(?)").get("notes")as any).incarnation_id)')/logo-attempt
   ```

   `404`. So is the same address as a GET. Only htmx's own request reaches it, and the
   tiles have already fired theirs.
6. **A capability with no face is still a capability.** This half costs nothing. Add
   `RECRAFT_BASE_URL=http://127.0.0.1:9/v1` to `.env`, save any file under `src/` so
   the server restarts, then build something new from the prompt bar. It builds,
   activates, opens and works; its tile stays the hatched placeholder; the Commit pane
   shows `logo: absent, attempts 1`. Remove the line from `.env` when you are done —
   the **next desk load will then spend a real credit** for that capability.
7. **The two colours cannot be the same one.** Nothing in the UI can do this, which is
   the point; to see the wall, run `bun test src/registry/spec.logo.test.ts`.
8. **The corpus, if you want to read it directly.**

   ```bash
   bun -e 'import{Database}from"bun:sqlite";console.log(new Database("data/omni-crud.db",{readonly:true}).query("SELECT id,label,ground,companion,subject,logo_status,logo_attempts FROM capability_registry").all())'
   ```

### The colour contract changed a second time, after sign-off

The human looked at four live capabilities — `sky`/`violet`, `leaf`/`sky`,
`sky`/`ochre`, `sky`/`clay` — and said the obvious thing: three grounds out of four
is not chance. It was not, and the cause was not the one this issue had already
found and fixed.

**The balanced prompt was already in place, and it did not help.** The fix above
made every anchor appear exactly once in the colour examples, on the theory that
`sky` had been named twice. Five probe builds against that balanced prompt — spec
generation only, no credits — came back `ochre`, `leaf`, `teal`, `shade`, `teal`
for the ground and **`sun` three times out of five** for the companion. Zero
`sky`. So the prompt was not leaning toward `sky`; the model was collapsing to *a*
mode, and which value it collapsed on moved with the neighbourhood of the prompts.
The four live capabilities were a notebook, a watering can, a laboratory notebook
and a house — for that neighbourhood the mode is `sky`, and for a house `sky` is
also literally what is behind the object.

Two things follow, and both were done:

- **The vocabulary is hues, not palette tokens.** Two of the eight names — `sky`
  and `shade` — named things rather than colours, in a list the model is asked to
  pick a *backdrop* from. The eight are now `grass_green`, `forest_green`,
  `teal_green`, `cyan_blue`, `golden_yellow`, `mustard_ochre`, `coral_orange`,
  `amethyst_violet`, and the colour instructions carry **no worked examples at
  all** — an even scale still only moves which value the model collapses on, so
  the test that pinned the counts is replaced by one asserting no hue is named
  outside the vocabulary list. The prompt also says out loud that there is no
  default hue and that a colourless subject takes its hue from what the capability
  is for, "never from what a backdrop usually looks like".
- **The shade is the platform's, drawn from the seed.** Each family opens onto four
  shades that differ in hue nuance as well as lightness, and `resolveLogoShades`
  picks each capability's two from its incarnation seed. Nothing is stored: the
  seed is already the record of what drew the artwork, so no column and no
  migration were added. This is the only entropy in the whole colour path, and it
  is what a stateless per-capability call cannot supply.

**It cost a second reset**, for the same reason as the first: `capabilitySpecSchema`
re-parses every published `vN/spec.json` at boot and at the head of every build, and
the old anchor names no longer validate. The four drawings were the problem being
fixed, so nothing worth preserving was lost.

The eight former anchors survive in the ladder at their exact former bytes — the
vocabulary widened rather than moved. What did not survive is their status as
design tokens: `ground` and `companion` style nothing (the tile is a full-bleed SVG
and the shell adds no colour, L8), so `request.test.ts`'s cross-check against
`design/styles/tokens.css` is replaced by a direct measurement that all thirty-two
shades sit in the daylight band. That measures the platform's own literal table, not
model output, so ADR-0007's deleted chroma-and-lightness validator stays deleted.

**Measured, on the prompts that failed.** Five probe builds on the four live prompts
plus one more, spec generation only:

| subject | hues named | drawn |
| --- | --- | --- |
| an open notebook | amethyst_violet / golden_yellow | iris / lemon |
| a watering can | grass_green / cyan_blue | emerald / cyan |
| a laboratory notebook | amethyst_violet / golden_yellow | orchid / amber |
| a house key | coral_orange / forest_green | tangerine / pine |
| a dream journal | amethyst_violet / golden_yellow | plum / marigold |

**The mode is still there** — three of five named the same hue pair. That is the
honest result, and it is what L9 permits. What changed is that those three are
`iris`/`lemon`, `orchid`/`amber` and `plum`/`marigold`: ten drawn colours, ten
distinct values. Making the desk aware of what it already wears would remove the
mode itself; it was considered and declined, because a prompt listing every colour
already on a ten-capability desk is a worse instruction than the one it fixes.

## Follow-ups this issue did not take

- **Two shades argue with the block's own closing sentence.** `amethyst` (#9a86c4,
  S34/L65) is a pastel by any ordinary reading and `forest` (#2a7a45, L32) is the
  darkest rung, and both can be pinned as `background_color` while the prompt says
  "no dark backgrounds, no pastels" ten lines later. L2 records that this model follows
  the words. Both are former anchors kept at their exact values so the ladder only
  widened; the three rungs added beside each of them stay clear of the edge, so the
  odds of drawing one fell from one-in-eight to one-in-thirty-two. The contradiction is
  still there, and it belongs to `design/logo.html`.
- **The block's content bans do not all hold.** The watering can drew grass under
  itself, against "no floor, no ground line". The six wording rules already record that
  negative lists barely steer this model; this is one more instance, not a new problem.
- **A concurrent claim loser returns instantly** rather than waiting a bounded moment
  for the winner. ADR-0007 asks for the bounded wait; 5.5/04 carries it.
- **An install followed by a structural failure leaves an orphan.** If the finalizing
  coordinator write throws, or the process dies between install and finalize, the file
  is on disk and the row is stuck `generating`. Reconciliation deliberately does not
  touch either; recovering an interrupted claim is 5.5/04's by contract.
