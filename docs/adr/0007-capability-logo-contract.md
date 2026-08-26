# 0007 — Capability logos: one accepted artwork per incarnation, immutable delivery & bounded retry (seeds Module 5)

Status: accepted

The art contract itself is [`design/logo.html`](../../design/logo.html): eleven
locked decisions (L1–L11), the prompt block, the request fields, and the
measurements each number was settled on. This ADR carries that contract into the
decision record and closes what the page leaves to the platform — how a logo
reaches the browser, what keeps it behaving as a picture and nothing else, where
the bytes live, what happens when the call fails, and what the spec and the
registry have to carry. All of that was settled in the desktop design session of 2026-08-20 and is
recorded in `modules/05-the-desk/PLAN.md` (decisions 34–42).

**Status of the delivery half.** Four real generations exist, and so do the tile
and label rules in `design/styles/components/logo-contract.css`. Epic 5.5 has
since built the rest in order: the spec and registry fields (5.5/01), then the
request, the provider client, the incarnation-root storage, the claimed attempt
and the tile's load-triggered POST (5.5/02), then the logo route's immutable
cache directive, its negotiated gzip and its fail-closed non-present answers
(5.5/03). What remains is the desk-load sweep's recovery — an interrupted claim,
a stale attempt temp, a `present` row whose file has gone, and the bounded wait a
concurrent claim loser owes (5.5/04).

## Decision

### Generation decides a subject and two colours, and nothing else

One accepted artwork per capability incarnation, with at most three claimed calls
to a hosted service: Recraft `recraftv3_vector`, bearer token, roughly $0.08 a
generation (L1). No local model enters the creation path.
Free local rigs refine wording before credits are spent and never produce artwork
that ships: a general-purpose raster model returned detailed illustration across
eight constructions and ignored the palette every time. Recraft's vector substyle
enforces the flatness in the keepers; words do not buy it.

Model, `style`/`substyle` (`vector_illustration` / `bold_stroke`), `size`
(1024×1024), `response_format` (`b64_json`) and `controls.no_text` are held
constant for every capability, and no caller may vary them. What changes per
capability is short: two colours in `controls.colors` with the capability's
authored ground first and its authored companion second,
`controls.background_color` pinned to that same first colour, a
`random_seed` stored with the capability rather than derived from its name or its
position, and the prompt block with its subject slot filled.

**Amended 2026-08-25: the companion is authored, not derived.** It was a closed
symmetric lookup — leaf/shade, teal/sky, sun/ochre and clay/violet — chosen so the
second colour would not be a fourth authored fact and the provider client would
have no caller-variable colour choice. It kept both of those properties and cost
something nobody priced while the contract was being judged against four
hand-picked specimens: four pairs is the whole product. Two capabilities collide
25% of the time, four collide 91% of the time, and five collide with certainty —
a desk of five cannot avoid two tiles wearing the same two colours.

The model now names both. `ground` is the field the drawing sits on and
`companion` is the colour the object is drawn in; each is one of the same eight
anchors and they must differ, which the spec refines over the whole object because
a per-field enum cannot see it. That is 56 ordered pairs against four. (Superseded
in part by the second 2026-08-25 amendment below: the eight anchors became eight
hue families, and the concrete shade is resolved from the seed.) The caller
still chooses nothing — `logoRequestColors` is the one place the ordering is
fixed — and aptness, which is the argument for letting the model name a colour at
all, now reaches the second one too.

The ground colour is named twice, once in the control and once in words inside
the prompt, because naming it in only one of the two places does not work (L2).
Both halves name the resolved *shade*, not the family the spec authored.
Exactly two colours go in the list: passing the whole palette returns a busier
drawing at seven times the file size and hands the model enough colour to build a
horizon out of. Everything else a logo has is applied afterwards by code that does
not vary (L3).

### The tile carries no line, and the name sits on the desk

The artwork arrives as a full-bleed square, so its own colour field is the
silhouette and the shell adds no edge. The shell clips a 10% corner, casts a hard
3px/4px shadow in ink at 24%, and draws the tile at 64px (L4). That corner is the
only rounded one on the surface and the only exception to the desk's drawn-line
rule (D11): a logo is a picture where everything else is a boundary, and it has
to read as pressable at 20px. The clip is a percentage rather than a pixel value,
so the shape holds at 256px and at 20px alike.

The capability's name is written straight onto the desk in Outfit 600 at 12px in
`--surface`, carried by three straight-down shadow passes with no plate behind
the type (L5). Those passes are the only blurred pixels in Aluna, and they are a
shadow rather than an outline; the no-blur rule governs the shadow an object
casts onto the desk, which a glyph does not do (L6). The name sits on a 96px
measure, wraps to two lines, and truncates after that.

### A logo is attempted after v1 activation, kept as it arrived, and never remade

The first request is a **post-build follow-up to a successful v1** (L10), made
through the same atomic attempt claim used by desk-load recovery. Activation
first commits seed plus `absent/0`; the presenter terminates and the long build
lease releases before the follow-up may acquire its short coordinator claim. The
Gate, publication and SQLite activation have already succeeded. A build that fails,
goes stale, is cancelled, or never activates costs nothing, and a provider
failure cannot roll back or relabel `success/activated`, and a crash in the gap is
recovered by the next desk-load claim. The consequence is that
a capability stands on the desk for a moment without a face: until the artwork
lands, its tile is the same placeholder that marked the ground while the build
was running. Evolution never enters this path.

The handoff is concrete: only a registry-backed `absent` tile emits one
load-triggered, same-origin POST to
`/capability/:id/:incarnation_id/logo-attempt`. The response is no-store and
replaces only that tile. It may queue behind the still-releasing build lease, so
the build SSE can terminate before artwork exists; a paid mutation is never
encoded as GET. The response is deliberately inert even if failure returns the
row to `absent`; only a fresh desk render or activation arms a load trigger, so a
tile swap cannot recursively spend all three attempts.

What comes back is stored as received — gradients and all, no stripping, no path
rewriting, no cleanup, no retouching. Everything the shell adds sits outside the
file (L8). The seed is stored beside the artwork as the record of what drew it.
A logo is made once and never remade: rendering does not regenerate it, and
evolving the capability does not touch it, so v2, v3 and vn keep the drawing v1
was born with (L7). Deleting the capability and growing it again is the only
route to a different logo. Two capabilities are allowed to look alike, and
nothing in the request spends effort keeping them apart (L9). A logo that fails
to arrive is retried, never faked (L11): no drawn stand-in is substituted,
because a stand-in that persists becomes the capability's face by accident, and
L7 would then forbid replacing it.

### Delivery: a route per capability, declared as a picture, marked immutable

Each capability incarnation serves its artwork from
`/capability/:id/:incarnation_id/logo.svg`, declared `image/svg+xml`, and marked
**immutable**. Incarnation identity is required because permanent deletion may be
followed by rebuilding the same semantic id with different artwork; an id-only
immutable URL would let the browser reuse the deleted lifetime's bytes. L7 says
the exact incarnation's bytes never change, so this URL is honest. The platform
renders it into the desk and CSS uses it unchanged as `background-image`.

Only a matching active incarnation whose lifecycle is `present` receives that
immutable response, and the tile emits the URL only then. Non-present,
mismatched-incarnation and missing-file responses are `Cache-Control: no-store`,
so a request made before artwork arrives cannot cache absence forever.

### Safety: the response makes it picture-only, and the bytes stay untouched

The response headers make the file **picture-only**. It renders as an image where
the desk draws it, and it is inert if its address is opened directly as a
document. Nothing is done to the stored bytes, which honours L8 literally —
everything the shell adds sits outside the file.

This is cheap insurance rather than an urgent hole. Reaching the exposure at all
requires the vendor's own output to carry a program, and all four shipped
specimens are provably free of one: zero `<script>`, zero event handlers, zero
`javascript:` in any of them. The headers cost nothing, so the door gets shut
anyway.

### Size and provenance: the manifest is kept, the response is compressed

Measured on the four specimens under `design/assets/logos/`:

| File | Raw | Provenance block | Gzipped | Scripts |
|---|---|---|---|---|
| reading-journal | 24 kB | 4,354 B | 11 kB | 0 |
| coffee-tasting-log | 44 kB | 4,354 B | 17 kB | 0 |
| telescope-observations | 51 kB | 4,354 B | 17 kB | 0 |
| recipes | 111 kB | 4,354 B | 32 kB | 0 |

The C2PA manifest is a flat 4,354 bytes in every file, so it is not the bulk:
`recipes.svg` is 220 vector paths at 111 kB. Stripping provenance would recover
4.4 kB and destroy the record of where the drawing came from. Gzip recovers
54–71% — the saving grows with the drawing, so the 111 kB specimen gains most —
and changes nothing on disk. The manifest is kept and the response is
compressed.

### Storage: a stable file beside immutable version snapshots

The artwork is `capabilities/<id>/<incarnation_id>/logo.svg`, beside the immutable
`vN/` directories rather than inside the active `artifacts_path` snapshot, and
not a registry column. A retry can therefore install it after activation without
mutating a published snapshot or falsifying `snapshot.json`'s exact inventory.
The incarnation tree is already removed when the capability is deleted, so the
artwork's lifetime ties to the capability's with no second cleanup path. A
registry read also stops carrying a picture nobody asked for.

### Retry: every faceless capability, once a load, three attempts and then never

The post-build v1 follow-up and desk load share one atomic claim path. A load offers
one incarnation-bound tile POST to every capability that has no artwork. Durable status includes
`generating`, and the attempt count increments when a claim is won, so concurrent
loads cannot spend the same attempt. A capability stops for good after **three
failed claimed attempts**, and its placeholder becomes permanent. Recovery
reconciles an interrupted claim from the no-overwrite final file and the already
consumed count, removing any incarnation/attempt-scoped temp left by the crashed
claim; it never decrements, deletes an accepted final file or spends a fourth
call.
A `present` row whose accepted file is later missing reconciles to `abandoned`
and the permanent placeholder. It is not regenerated: L7's once-accepted rule
still applies after loss.
Concurrent claim losers wait only for a bounded observation of the winner and
return the current tile; they do not call the provider, block initial desk render
or create a general polling/scheduler mechanism.

Claim and finalization are short coordinator writes bound to the exact active
incarnation. Between them, provider I/O and atomic no-overwrite installation hold
that incarnation's read token and observe its cancellation signal. The token is
released before finalization reacquires mutation ownership, preserving the rule
that no queued acquisition is awaited inside a read-token scope. A deletion race
therefore cancels the call or removes an already-installed file with the
incarnation tree; a late response cannot resurrect or mark a tombstone present.
Each attempt is time-bounded and validates the provider envelope, base64 decoding
and SVG document root before no-overwrite installation. Accepted bytes are still
stored exactly as received. Timeout, cancellation, malformed output or install
failure consumes the claimed attempt and removes its temporary file in `finally`;
recovery never has to guess from an untracked staging artifact.
That is self-healing with no scheduler to build, since the desk load is the one
moment the platform reliably gets.

The guard that matters is the attempt cap rather than a spend ceiling. At ~$0.08
a call, the expensive failure mode is a retry loop, not a few extra attempts, and
an attempt cap kills the loop where a budget only bounds how long it runs.

### The colours: the model names two of the eight hue families, the seed names the shade

The model names a `ground` and a `companion`, each one of `grass_green`,
`forest_green`, `teal_green`, `cyan_blue`, `golden_yellow`, `mustard_ochre`,
`coral_orange` or `amethyst_violet`, and the two must differ. Each family opens
onto four shades; **which of the four a capability wears is resolved from its
incarnation seed**, not authored. Signal red is reserved for alerts and
destructive confirmation, and is not offered.

This **deletes the chroma-and-lightness validator entirely**. The properties that
validator checked — saturated, light enough for daylight, no near-blacks, no
pastels, no greys — hold for all thirty-two shades by construction, because the
ladder was built on exactly those grounds. Validation stays a word-list check
against eight names. L9 already permits two capabilities to look alike, so no
uniqueness rule is owed either. The model choosing the hue is what keeps the
colour apt; the seed choosing the shade is what keeps two capabilities from
wearing the same colour when the model picks the same hue twice.

**Amended 2026-08-25 (second): the vocabulary is hues, and the shade is the
platform's.** The eight anchors were the palette's own token names, and the first
four live capabilities came out `sky`, `leaf`, `sky`, `sky`. The prompt was not
the cause in the way it first appeared: an earlier fix had already balanced its
worked examples so no anchor was named more often than another, and five probe
builds against that balanced prompt still answered with the same *companion* three
times out of five. A spec-authoring model collapses to a mode — asked for a colour
for a notebook it gives the same colour every time — and every build is a
stateless call that has never seen another capability, so nothing upstream of the
seed can produce variety. 56 reachable pairs were never the constraint; the model
simply never reached for them.

Two things changed. The vocabulary became hue words, because two of the eight
token names — `sky` and `shade` — named things rather than colours, and `ground`
is defined to the model as what sits *behind* the object: one of the four live
capabilities was a house, and it went on sky. And the platform took the shade,
which is the only entropy in the path. The ladder's rungs differ in hue nuance as
well as lightness, so a capability that names `cyan_blue` may come out cyan,
azure, aqua or cerulean and two that both name it are still two different tiles.
That is 896 cross-family ordered pairs against 56 — but the number is not the
point, because the number was never what was binding.

This does **not** make the desk aware of itself. No capability's colour depends on
any other's, no uniqueness rule is added, and L9 stands: two capabilities may name
the same hue, and after the change three of five probe builds still did. What the
ladder buys is that they no longer come out the same colour.

The eight former anchors survive in the ladder at their exact former bytes, so the
change widened the vocabulary rather than restating it. The shades are **not**
design tokens and no longer pretend to be: `ground` and `companion` style nothing
— the tile is a full-bleed SVG and the shell adds no colour of its own (L8) — so
the cross-check against `design/styles/tokens.css` is replaced by a direct
measurement that every shade sits in the daylight band. That measurement is over
the platform's own literal table, not over model output, so the deleted validator
stays deleted.

### Art direction is not the user's to steer

The subject phrase is derived from **intent**, never from user-authored art
direction. A prompt that tries to direct the logo is refused by the intent
classifier, under the same general rule that refuses "move this 2px right" or
"add more padding". Users do not steer presentation, and a logo is presentation.
No logo-specific validator is added, because this is not a logo-specific defence.

### Determinism owes nothing

L7 dissolves the worry that editing the prompt block would break a retry's
determinism. A retry is always for a capability that has **no picture at all**,
so there is nothing for the result to be inconsistent with, and nothing requires
two capabilities to look like they came from the same era — L9 says the opposite.
The prompt block may be edited freely and owes no versioning.

### What the spec and the registry gain

- **Spec, model-generated:** `subject` (a short phrase describing one object),
  `ground` and `companion` (each one of the eight hue-family names, and they must
  differ), and `noun` (for the desk's empty-state copy). Subject, ground and
  companion are immutable birth facts; evolution must preserve them exactly. Noun may evolve as a platform-View fact and never
  selects logo regeneration.
- **Registry, runtime:** the per-incarnation `seed`, and a durable **logo
  lifecycle** `{ status, attempts }` the desk-load sweep can claim — status is
  absent, generating, present, or abandoned.
- The artwork itself is a file, not a column.

## Context / why

L7 does more work here than any other decision. A file that is never remade can
carry the strongest cache directive there is without the risk that normally comes
with it. A retry that can only ever run against a capability with no picture
cannot produce an inconsistency, so the prompt block needs no version. And under
that same rule a stand-in would become permanent the moment it was drawn, which
is why L11 refuses to draw one.

Keeping the list of what generation decides short is the whole reason the contract
exists. Anything the model chooses can differ between two logos standing on the
same desk, and four tiles have to read as a set. A subject and two colours is
the smallest list that still gives a capability a face of its own.

The manifest question was decided by measuring rather than by guessing. The
provenance block reads as the obvious thing to cut, until it turns out to be a
flat 4,354 bytes against a file whose 111 kB is 220 vector paths. Gzip takes
between 13 kB and 79 kB off those same four files, so compression was never
really competing with stripping.

Storage went to the artifacts directory because a registry column would create a
second lifetime to keep in step with the capability's, and deletion already
removes that directory. The eight-anchor list replaced a validator for the same
kind of reason: the validator existed to enforce properties the anchor set
already guarantees, so it was checking work that could not fail.

Refusing art direction at the intent classifier rather than at the logo keeps one
rule instead of two. "Make the logo blue" and "move this 2px right" are the same
request — the user reaching for presentation — and the classifier already refuses
that class.

## Consequences

- The desk-load sweep needs a queryable and atomically claimable logo lifecycle,
  which is why the registry gains status plus attempts rather than inferring
  emptiness from a missing file.
- The incarnation-keyed logo route is platform code adjacent to, not an invented
  generated Action under, the fixed `/capability/:id/:action` convention. It
  acquires the exact incarnation's read token while serving so deletion cannot
  race the file.
- Evolution never reads or writes the logo. The Diff Engine gains no logo fact,
  and no change to a capability's spec can select regeneration of its artwork.
- Deletion needs no logo step. The tombstone's existing artifact cleanup carries
  the file away with everything else the capability owned (ADR-0006).
- The logo is also the doorway for **Rename** and **Delete**. A short context
  menu opens on it by right-click, press-and-hold, or the keyboard menu key,
  which the tile can carry because it is already a real `<button>`. Rename
  uses an inline Save/Cancel form anchored to that label and changes the effective
  label and nothing else — not its authored snapshot, id,
  address, version, or artwork. A platform-owned display-label override keeps
  immutable specs truthful and survives evolution, so nothing in this contract
  moves when a capability is renamed. The flow behind that menu belongs to
  ADR-0006, restated in window terms by its 2026-08-20 amendment.
- The shell-drawn **landform tile** — a sky band, two coloured horizons, and a
  black-and-white subject fitted to a 32px box — is superseded and gone from the
  tree, along with its renderer, geometry and drawing modules, its frozen subject
  set, and the subject prompt that fed it. Its `--sky-band` token went with it;
  the one piece of page furniture that borrowed the colour now takes the title
  bar's palest pane instead.
- A shared ground colour, a repeated subject, a gradient the prompt asked
  against, and a background blocked into panels are all **accepted outcomes**
  rather than defects with fixes pending. No code goes looking for any of them.

## Hazards this contract carries forward

The prompt **must wrap the injected subject phrase**. `controls.no_text: true`
does not stop the model lettering an unwrapped description into the drawing; the
control is recorded as insufficient on its own, and the wrapping is what closes
the gap. The contour the block asks for, meanwhile, never arrives: the service
returns filled paths and nothing else, without one `stroke=` attribute across the
four specimens. So the colour-against-colour look the whole surface is designed
around is emergent rather than specified, and no contour can be added to the
artwork afterwards, which is one reason the tile carries no line.

The **10% corner clip is load-bearing rather than cosmetic**. Where a generation
paints white wedges over its own square, the clip is what removes them, and two
of the four shipped specimens carry such a corner (the largest wedge measured 175
of 2048, or 8.5%, against a clip of 10%). The clip lives only in CSS, so any
server-side raster of a logo that skips the mask ships a pale corner artifact on
half the corpus.

An evolved capability keeps a subject phrase drawn from what it used to hold. One
that starts as a reading journal and grows into a library catalogue still shows
the open book it was born with, because L7 forbids redrawing and the phrase is
never re-derived. That is the price of a permanent identity, and the only route
to a different picture stays delete and recreate.
