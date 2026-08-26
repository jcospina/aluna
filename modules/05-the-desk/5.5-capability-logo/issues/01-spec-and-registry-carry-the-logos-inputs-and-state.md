# The spec and registry carry the logo's inputs and state, and a prompt cannot direct a logo

Status: done

> **Superseded in part, 2026-08-25 (during 5.5/02's sign-off).** The closed
> companion lookup described below is gone. It kept the second colour from being
> a fourth authored fact, which was the property it existed for, and it also
> capped the whole product at **four distinct colour pairs** — two capabilities
> collide 25% of the time, four collide 91% of the time, and a desk of five
> cannot avoid two tiles wearing the same two colours. That was invisible while
> the contract was judged against four hand-picked specimens and obvious the
> moment two real capabilities stood side by side. The model now names a
> `companion` alongside the `ground`; the two must differ, the ground is still
> first, and the caller still chooses nothing. Everything else in this issue
> stands. See ADR-0007's 2026-08-25 amendment and PLAN decisions 39 and 42.
>
> **Superseded again the same day.** The eight tint anchors below are no longer
> the spec's vocabulary. `ground` and `companion` name one of eight **hue
> families** (`grass_green`, `forest_green`, `teal_green`, `cyan_blue`,
> `golden_yellow`, `mustard_ochre`, `coral_orange`, `amethyst_violet`), and the
> concrete shade is resolved from the incarnation seed rather than authored.
> Opening the pairing was not enough on its own: the model kept collapsing to one
> modal answer per neighbourhood of prompts, so the reachable pairs stayed
> unreached. Validation is still a word-list check and no column was added — the
> seed already records what drew the artwork. See ADR-0007's second 2026-08-25
> amendment.

## Epic

Module 5 — The Desk · Epic 5.5 — The capability logo
(PLAN decisions 39, 40, 42; [ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md):
`modules/05-the-desk/PLAN.md`)

## What to build

The data the logo needs, and the rule that keeps users out of it.

This is the module's second and last reset-bounded authored-spec cut. Capabilities
built as placeholder proofs in 5.1–5.4 predate the required birth facts and have
never spent logo credits, so run `bun run reset` here before rebuilding them. No
missing-field compatibility default, registry-only backfill, or snapshot/spec
drift is introduced. From this issue onward every capability is born with the
final logo inputs and no later Module 5 issue resets the corpus.

**Three model-authored keys on the spec.** `subject` (a short phrase), `ground`
(one of the eight tint anchors) and `noun` (for the desk's empty-state copy).
*(A fourth, `companion`, was added by the amendment above.)*

**Two runtime values owned by the registry.** The per-incarnation `seed`, stored
rather than derived from a name or position, and a durable logo lifecycle value
containing both `status` and `attempts`. Status is **absent**, **generating**,
**present**, or **abandoned**. `generating` is the atomic claim that prevents two
desk loads from spending the same attempt; `attempts` is incremented when that
claim is won, not after the provider returns. The artwork itself is not a registry
column and is not part of an immutable version snapshot — 5.5/02 stores it once
under the incarnation's artifact root.

`subject` and `ground` are birth facts. Evolution must preserve them byte-for-byte
and they never become Diff facts; accepting a change would make the spec disagree
with artwork that L7 forbids remaking. `noun` may evolve as a platform-View fact
and never selects logo generation. The seed and lifecycle value are
platform-owned and absent from authored candidates.

**Ground validation becomes a word-list check.** The eight anchors are leaf,
shade, teal, sky, sun, ochre, clay and violet. Signal red is reserved and is not
offered. This deletes the chroma-and-lightness validator entirely: *in the
palette*, *saturated*, *light enough for daylight*, *no near-blacks*, *no
pastels* and *no greys* are all satisfied by construction, because the eight
anchors were chosen that way. A model choosing beats a hash because the colour
stays apt — telescope on sky, recipes on ochre. Two capabilities are allowed to
look alike (L9), so no uniqueness rule is owed.

The request's second colour is not another authored fact. The shell derives it
from one closed, symmetric companion lookup — leaf/shade, teal/sky, sun/ochre and
clay/violet — and passes the selected ground first. That makes every request
fully determined by the three authored keys plus registry seed without quietly
asking the model for a fourth key or letting a caller choose presentation.

**Users do not steer presentation, and the logo is presentation.** The subject
phrase is derived from intent, never from user-authored art direction. A prompt
attempting to direct the logo is refused by the intent classifier under the same
general rule that refuses *"move this 2px right"* or *"add more padding"* — no
logo-specific defence and no logo-specific validator. ADR-0007's existing
requirement stands unchanged: the request wraps the injected subject phrase,
because `controls.no_text: true` is recorded as not sufficient on its own.

## Acceptance criteria

- [x] A spec carrying `subject`, `ground` and `noun` round-trips through
      generation, validation and storage
- [x] `bun run reset` removes the pre-logo placeholder corpus before the schema
      cut; no old row is backfilled and no later Module 5 issue requires a reset
- [x] A `ground` outside the eight anchors fails validation; signal red fails
      validation
- [x] The second request colour is `companion`, authored by the spec as a hue family
      and stored in its own column, and it must differ from `ground`. Which rung of
      that family the request carries is resolved from the incarnation seed by
      `resolveLogoShades` and is not caller-variable or inferred ad hoc by the
      provider client. *(Amended: this criterion originally named a closed companion
      lookup deriving the second colour from the first. That lookup was superseded
      during this epic — it capped the product at four distinct pairs — and the
      head-note records the change; the criterion is restated here to match what
      shipped.)*
- [x] The chroma-and-lightness validator is deleted, not bypassed
- [x] The registry carries the per-incarnation seed plus durable logo status and
      attempt count; `generating` is an atomically claimed state
- [x] Evolution preserves `subject` and `ground` exactly; a `noun` change is a
      View-only fact and no evolution fact can select logo generation
- [x] A prompt attempting to direct a logo is refused by the intent classifier,
      on the same path as any other presentation-steering prompt — with no
      logo-specific rule added
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with the logo provider disabled and confirm the developer
preview shows its `subject`, `ground`, `noun`, seed, status and attempt count.
Evolve the capability and confirm its subject, ground and seed do not move.
Submit *"make the notes icon blue and bigger"*
and confirm the ordinary presentation-steering refusal.

## Blocked by

- modules/05-the-desk/5.4-desk-wallpaper-logos-prompt-bar/issues/02-the-logo-layer-replaces-the-toolbar.md

## Notes

### What the shape actually became

`subject`, `ground` and `noun` sit on `commonSpecShape`, so the one spec schema
gates them for both a new capability and an evolution candidate. `ground` is a
`z.enum` over the eight anchors read from `src/registry/logo.ts`, which the
builder prompt also reads — the prompt cannot drift from the wall behind it.

The registry gained four scalar columns plus the lifecycle pair. `CapabilityRow`
carries `seed` and `logo`; **writes take a narrower shape that has no room for a
lifecycle at all**. That is the load-bearing choice: an evolution CAS assembled
from a row read seconds earlier could otherwise roll back a claim some other desk
load had already won and paid for. Only `claimLogoGeneration`, `releaseLogoClaim`
and `settleLogoGeneration` move it.

The claim is one conditional `UPDATE … RETURNING` that both wins the right to
spend and hands back everything a request needs. It runs inside a transaction with
its own validation, so a row that cannot produce a valid request rolls the claim
back rather than stranding in `generating` with an attempt burned.

### The chroma-and-lightness validator

Nothing was deleted, because nothing existed. `git log -S chroma -- src` is empty:
the validator lived only in `design/logo.html`, ADR-0007 and the PLAN, and
decision 39 retired it before it was ever built. The criterion is met by the
word-list check being the whole of ground validation, not by an act of removal.

### Adversarial findings, and what they changed

Two reviews ran before the live test. Both reproduced real defects:

- **The catalog fingerprint hashed the logo lifecycle.** `capabilityRowSchema`
  feeds `fingerprintActiveRegistryCatalog`, and the fingerprint is what a build is
  revalidated against at the lease head. A desk-load claim for one capability would
  therefore have refused every unrelated in-flight build as
  `catalog_revision`. The lifecycle is now excluded from the fingerprinted view —
  it moves out of band, and whether a picture has landed is not semantic registry
  content. The seed stays in: it never moves within a lifetime.
- **`empty_state_noun` was missing from `UI_CHANGE_FACTS`.** The most ordinary
  rename there is — "call these Recipes", which moves the label *and* the noun —
  hard-failed as out of `ui_change` scope. Both facts are platform copy; the noun
  is now admitted, and the resolver's own description of `ui_change` names it.
- **The lifecycle had no `generating → absent` edge.** ADR-0007 needs one for a
  failed-but-not-final attempt and for recovering an interrupted claim; without it
  a process dying mid-attempt left a capability permanently faceless, since only
  `absent` is claimable. `releaseLogoClaim` adds it, keeping the spend. Settle also
  now admits `present → abandoned`, the reconciliation for accepted artwork that
  later goes missing.
- **The claim validated after it had already committed**, and `subject` was an
  unchecked cast that could hand `null` to a paid request. Both fixed.
- **`getCapabilityLogoState` keyed on id alone** while the claim binds the
  incarnation — a `present` from a deleted-and-rebuilt lifetime could have been
  read as this one's. It now takes the incarnation.
- Two tautological tests were rewritten (the seed-preservation test now passes a
  *different* seed in and asserts the stored one wins), and the builder prompt's
  art-direction line was reworded so it reads as derivation guidance rather than
  as the second refusal rule ADR-0007 says is not owed.

Not fixed here, and deliberately. *(The three-attempt cap, listed here originally as
belonging to 5.5/04, was delivered there: the claim's own conditional `UPDATE` carries
`AND logo_attempts < LOGO_MAX_CLAIMED_ATTEMPTS` — `src/registry/store.ts`.)*

- **`noun` is validated as one short non-blank line, not as lowercase.** The
  builder prompt asks for a bare lowercase singular; the schema does not enforce
  it, so a model returning "Notes" would render "add your first Notes above".
  Tightening the shape of authored copy is a design call, not an implementation
  one. **Decided 2026-08-26: left as-is.** The prompt asks for a bare lowercase
  singular and the model generally complies; the occasional "add your first Notes
  above" is not worth either a build failure or silently rewriting authored copy.

### Demo-vs-real boundary

None. Everything here is on the path a real prompt takes. The only piece still
gated on a later issue is the artwork itself: with no provider client (5.5/02)
every capability is born `absent`/0 and stays there, which is exactly the state
this issue is about.

## Verification

```
bun run test
bun run typecheck
bun run lint
```

`bun run test` → 1404 total. Typecheck and lint clean.

On an unloaded machine the suite is green end to end (1404 passed, 0 failed, ~100s
for two shards). Under load one pre-existing test flakes:
`app.spec-build-failures.test.ts` → *"a behavioral gate failure sends developer
evidence without leaking into narration"*. That file sets its own 15s budget and
this case compiles TypeScript in the gate, taking 14–18s depending on machine
load. It fails identically on unmodified `main` (verified by stashing this change
and re-running), so it is not this work — but it is worth fixing, because a
15-second budget on a case that legitimately takes 14 seconds is not a budget.

New coverage:

- `src/registry/logo.test.ts` — the eight anchors are exactly the eight, every one
  is a real palette token, signal red is present in the palette and withheld from
  the list; the companion lookup is closed and symmetric over all eight and throws
  rather than inventing a partner; a request's colours are the ground first; the
  lifecycle is the four statuses and nothing rides along; a minted seed is always
  in domain and 200 draws are 200 different values, which a derived seed could not
  be.
- `src/registry/spec.logo.test.ts` — all three keys are required with no defaults;
  every anchor validates and signal red does not; subject and noun are one short
  non-blank line; a spec cannot author the seed or the lifecycle; the write shape
  has no room for a status.
- `src/registry/store.logo.test.ts` — birth state round-trips; a claim spends its
  attempt in the same statement that wins it; a second claim loses; a claim is
  bound to its incarnation; release returns to `absent` keeping the spend and the
  next claim spends attempt two; a claim whose inputs cannot make a request rolls
  back rather than stranding; `present` reconciles to `abandoned` and never back;
  an evolution CAS carrying a *different* seed and a `logo` key changes neither;
  a pre-logo row fails loudly on read; the stored status is confined to four.
- `src/builder/evolution/candidate-validation.test.ts` — subject and ground are
  refused by name with the reason; an off-list ground fails first; a changed noun
  is accepted.
- `src/builder/evolution/diff-engine.test.ts` — a noun change is one View fact
  selecting no unit; the union of every fact the matrix can make names no logo
  work; a moved subject or ground fails closed as an unmapped difference.
- `src/pipeline/evolution/evolution-matrix.test.ts` — a new matrix row for the
  noun, and *every* row now asserts subject, ground, seed and lifecycle unmoved.
- `src/pipeline/evolution/evolution-intent-scope.test.ts` — a label-and-noun
  rename is in `ui_change` scope (the regression the review found).
- `src/intent-resolver/resolver-catalog.test.ts` — a claim and an arrival leave the
  catalog fingerprint identical; a different seed does not.
- `src/intent-resolver/resolver-fixtures.test.ts` — the refusal fixtures travel the
  ordinary path, and the resolver's rules contain no logo vocabulary at all.
- `src/presentation/list-container.test.ts` — the empty state is written around the
  noun, and a hostile noun is escaped into the sentence.
- `src/builder/commit/commit.test.ts` — v1 is born with a minted seed and a logo
  nobody has ordered; two incarnations of one id draw different seeds.
- `src/app/app.spec-build.test.ts` — the developer preview carries subject, ground,
  the derived ordered colour pair, noun, seed, status and attempts.

### Live evidence

Against the dev server on `:3030` with a real provider, after `bun run reset`:

| step | result |
| --- | --- |
| build *"I want to keep track of my notes"* | model authored `subject: "an open notebook"`, `ground: "sky"`, `noun: "note"`; preview showed `colors: ["sky","teal"]`, `seed: 1436601874`, `absent`/0 |
| *"add due dates to my notes"* | v2 — subject, ground and seed byte-identical |
| *"call my notes jottings instead"* | v3 `ui_change` — label moved, birth facts and seed did not |
| *"each one should be called an entry, not a note"* | v4 — noun moved to `entry`, desk copy became "add your first entry above", birth facts and seed did not |
| *"make the notes icon blue and bigger"* | classified `reject`; no build opened, no lifecycle row, ordinary refusal notice shown |
| *"move this 2px right and add more padding"* | identical outcome — same rule, same path |

The refusal needed a fix found by the live test, not by the suite: both prompts
were previously classified `ui_change` at 0.99 and absorbed as no-op evolutions,
so the classifier promised *"I'll make the Notes icon blue and larger"* and then
contradicted itself. The general presentation-steering rule now states that a
presentation request outside the closed `ui_change` list is `reject` — one general
rule, no logo vocabulary anywhere in it.

## HITL — how to check this

The dev server on `:3030` (start it with `bun run dev` if it is down). Run
`bun run reset` first — this issue is the module's last corpus reset, and rows
built before it will fail loudly on read rather than being backfilled.

1. **A capability is born with a face it has not been given yet.** Type *"I want to
   keep track of my notes"*. Open the developer panel (the `</>` control) and read
   the **Commit** pane: it carries `subject`, `ground` and `companion` (each one of
   the eight hue families — `grass_green`, `forest_green`, `teal_green`,
   `cyan_blue`, `golden_yellow`, `mustard_ochre`, `coral_orange`,
   `amethyst_violet` — and the two always differ), the resolved `colors` pair with
   your ground shade first, `noun`, a `seed`, and `logo: absent, attempts 0`.
   *(Amended: the palette-token vocabulary this step originally named was
   superseded within this epic — see the head-note.)* The tile on the desk is
   still the placeholder — nothing has been ordered, because the provider client is
   5.5/02.
2. **The empty state speaks your noun, not the capability's name.** Open the
   capability. It reads *"Nothing here yet — add your first note above"*, not
   "…your first Notes above".
3. **Evolving does not touch the drawing.** Type *"add due dates to my notes"*.
   When it lands, the Commit pane shows **v2** with the same `subject`, the same
   `ground` and the same `seed`. Rename it too — *"call my notes jottings instead"*
   — and check again: the name moved, the birth facts did not.
4. **The noun is allowed to move.** Type *"each one should be called an entry, not
   a note"*. The capability's empty state becomes *"add your first entry above"*,
   the Commit pane shows the new `noun`, and `subject`, `ground` and `seed` are
   still unchanged.
5. **You cannot direct the picture.** Type *"make the notes icon blue and bigger"*.
   Nothing builds; the prompt bar answers *"I'm not quite sure what to make from
   that yet. Try telling me one thing you'd like to keep track of."* Type *"move
   this 2px right and add more padding"* and confirm you get exactly the same
   answer — it is one rule, not a defence the logo has of its own.
6. **A ground outside the eight cannot be stored.** Nothing in the UI can do this,
   which is the point; if you want to see the wall, run
   `bun test src/registry/spec.logo.test.ts`.
