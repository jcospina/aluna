# A filtered count says how many matched and how many there are

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.1 — What every collection holds
(PLAN decision 32, and the honesty rule it shares with decision 17;
ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

With a search active, the collection states the matched count **and** the total.
A filtered number presented alone is a number that reads as the whole truth and
is not — the same honesty rule decision 17 applies to a spoken answer, applied
here to a rendered one. Clearing the search returns the plain count 6.1/01
already ships.

**Generated code is still untouched.** A capability's `search` Handler owns its
own filter and the platform cannot re-derive it without re-running generated SQL
it does not own, so the matched number is what the platform actually rendered
into the records region for that search. The total stays the `count` from 6.1/01
against the read connection. Two numbers, one of them already free and the other
already on screen.

**A search that matches nothing is the case this decision exists for.** Zero
matched is stated as zero matched, beside a total that is not zero, so the
collection never implies the capability is empty when it is only filtered.

The shape signed off in 6.1/01 governs the rendering; this issue adds the second
number to it and settles no new placement or styling of its own.

## Acceptance criteria

- [x] With a search active the collection states both the matched count and the
      total, and neither stands alone
- [x] Matched equals the records rendered in that collection; the total equals every record
      the capability holds
- [x] Clearing or emptying the search returns to 6.1/01's plain count
- [x] A search matching nothing states zero matched beside the real total, and
      never renders as an empty capability
- [x] The matched number is not obtained by the platform re-running a
      capability's own filter, and no generated artifact changes
- [x] Still one `count` on the read connection; no write, no new state
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open Notes with a handful of records. Type a term into the search that matches a
few and read both numbers — how many matched, and how many notes there are.
Search for something that matches nothing and confirm the collection says none
matched rather than implying you have no notes. Clear the search and watch the
plain count come back.

## Blocked by

- modules/06-reads-set-free/6.1-what-every-collection-holds/issues/01-the-collection-states-how-many-records-it-holds.md

## What landed

**Both numbers, in the shape 6.1/01 signed off.** A search answers `0 of 22 entries` where a
resting collection answers `22 entries` — same label, same place, one more number
(`filteredCollectionCountSentence`, `src/presentation/records/collection-count.ts`). The
total governs the noun, because the noun belongs to the collection and not to the search,
and a noun the platform will not pluralize safely leaves the bare pair. A total of zero says
nothing at all: that collection is bare rather than filtered, and the empty state is what a
bare collection says.

**The matched half is read off the answer, never re-derived.** The capability's `search`
Handler owns its filter and the platform cannot re-run it without re-running generated SQL it
does not own, so `countRenderedItems` (`src/presentation/records/list-container.ts`) counts
the platform's own item wrappers in the very fragment being sent — matching
`.capability-item[data-item]`, both marks the wrapper always writes together, so a Handler's
own `<div class="capability-item stack">` is not a record. `answerWithHandlerFragment` now
takes the sidecar as a function of the *scrubbed* html, so the count reports on the answer
that actually ships. The wording is the user's ruling; `design/` was corrected to state the
two-number rule, the record-noun rule and where the search status line sits.

**A search with no matches no longer says two things at once.** The reported bug, and a
worse cause than the copy suggested: all four `.capability-collection[data-search-state=…]`
rules in `public/css/collection.css` used a child combinator that could not cross
`.capability-collection__list`, so **every** search-state rule was inert — the empty state
never hid, the idle status line was never quieted, the loading spinner never showed. They are
descendant selectors now, `results` joins the states that hide the empty state, and the
empty state keys on element children rather than `:empty` so a whitespace-only answer cannot
take it away. The full {5 states} × {empty, whitespace, records} matrix was read out of a real
browser cascade: exactly one of the empty state and the no-match sentence is ever on screen.

**One `COUNT(*)` per read, on the read connection, inside no transaction.** The count now
validates the spec before naming its table and honours the route's read lease, so a count
running while a deletion drains the capability is cancelled rather than answering from a
table that is going away — and a cancelled read leaves no error in the log, because it is not
a fault.

## Findings fixed

Quality and adversarial passes both ran before the live test; every finding is closed,
pre-existing and INFO included.

- **A Handler could forge a count.** Aiming at the records region was the whole guard, and
  the aim is the Handler's to choose: a `read` fragment authoring its own create form with
  `hx-target="#<id>-records"` puts a forged sidecar at position zero of a create's answer.
  The shell now honours a sidecar only for a GET of *this* region's capability `read`/`search`
  route, which a mutation can never be. Separately, `hx-swap-oob` reaches any element on the
  desk by id and bypassed the guard entirely; the fragment enforcer now removes it — out-of-band
  is platform machinery (`src/server/http/fragments.ts`) and no generation contract asks a
  Handler for one.
- **An incoherent pair is not stated.** The two numbers are taken one after the other, so a
  delete landing between them can yield more matched than there are. "3 of 1 notes" is not a
  number to repair into a plausible one; the label says nothing and the next read says it
  properly.
- **A test that could not fail.** The old CSS-parity test asserted the literal broken selector
  string, which is exactly why a completely dead feature shipped green. The replacement reads
  the nesting out of the parsed render and refuses the child combinator over a
  whitespace-flattened, comment-free sheet — the rule that shipped broken was written across
  three lines, and a single-space scan would not have seen it. Both regression shapes were
  re-introduced and confirmed to fail it.
- **`results` was the last unquieted state.** "I updated the results." is the announcement of a
  change already on screen twice — the records, and the count saying how many of how many. It
  is screen-reader-only now, beside `idle`; the states that stay visible are the ones carrying
  something a person cannot otherwise see.
- Also fixed: the count label was called a *label* in prose and a *slot* in code (one name
  now); the two sentence functions duplicated their noun tail (`withNoun`); the sidecar seam
  had a dead default and a speculative name; `aria-describedby` was documented as the thing
  that announces the count, when the window's own live region is; `design/scripts/patterns.js`
  counted in "records" rather than the capability's noun; issue 01's "the status line reserves
  a line" rationale was true only *because* of the dead selectors; and three comments described
  things the code does not do (`public/index.html`'s import claim, the header's non-existent
  title, the item counter's "two attribute orders").

## Carried out, not carried

Routing the count through `CapabilityQueryPort` — the seam every other read of capability data
crosses — was tried and reverted. `CapabilityQueryPort.all()` leaves the shared read-only
connection pinned to the snapshot it read: after one call, every later read on that
connection, including the registry lookup that resolves a capability's artifacts, answers from
before any subsequent commit, on a freshly prepared statement with no transaction open.
`records()` does not do this and neither does a direct query. A latent test catches it
(`router.views.test.ts`, "the default loader keys Bun imports by incarnation path for a
recreated semantic id"). The count reads directly and says why in its header; the port bug is
filed separately, and Module 6's `data_query` loop will need it fixed.

## Verification

- `bun run test` — 2600 passed, 0 failed (72s). `bun run typecheck`, `bun run lint` clean.
- New coverage: the filtered sentence including the incoherent pair, the item counter against
  hostile and hand-authored markup, the forgery refusals (mutation verb, another capability's
  read, a search with its query on the path), the enforcer's out-of-band strip and its
  idempotence, every active-search state hiding the empty state, and a CSS guard that fails on
  both shapes the original bug took.
- Live on `:3030` against a capability built long before this issue: 22 entries → search
  "coffee" → `2 of 22 entries` over 2 rendered rows → search "zzzqqqxyz" → `0 of 22 entries`
  with "I couldn't find a match. Try another word." and no empty state → clear → 22 entries.
  The wire was read directly too: `<!--aluna:count:0%20of%2022%20entries-->` and a body that is
  the sidecar alone, so the region stays childless.

## Comments

**2026-09-04 — "Carried out, not carried" is now history.** The port bug filed out of this
issue is fixed (6.1/03), so the reason the count read directly is gone and the count has been
carried onto `CapabilityQueryPort.all` after all. The section above stays as the record of what
was true while 6.1/02 was built; what it says about `all()` pinning the connection no longer
describes the code. The retaining statement turned out to be the scope check's own `EXPLAIN`,
not `all()`'s projection, and `records()` was unaffected only because it cleared the statement
cache on its way into its snapshot.
