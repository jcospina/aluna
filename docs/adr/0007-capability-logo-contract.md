# 0007 — Capability logos: one accepted artwork per incarnation, immutable delivery and bounded retry

Status: Accepted

## Context

Every capability has a logo on the desk: a picture on a 64px tile with the
capability's name written under it. The desk has no taskbar, so the logos are the
only standing list of what exists, and a capability keeps its logo for life.
[`design/logo.html`](../../design/logo.html) shows the tile, the colours, the label
and the placeholder, and
[`src/lifecycle/logo/request.ts`](../../src/lifecycle/logo/request.ts) holds the
generation request and its prompt. The architecture places the logo in a build under
[Going live without a redeploy](../architecture.md#45-going-live-without-a-redeploy)
and at boot under [Recovery](../architecture.md#414-recovery).

A hosted vector service draws the artwork. Each generation is a call to that
outside service, and a call can fail, time out, return something malformed or still
be running when the capability is deleted. What comes back is third-party SVG that
the desk serves from its own origin. Anything the model chooses can differ between
two logos on the same desk, and the tiles still have to read as a set.

The model that authors a capability's spec collapses to one answer when asked for a
colour. It names the same colour for a whole neighborhood of prompts, and each
build is a stateless call that has never seen another capability, so no colour the
spec names varies reliably from one capability to the next.

## Decision

### Generation decides a subject and two hues

A subject and two colours is the smallest list that still gives a capability a face
of its own.

Recraft's `recraftv3_vector` model draws every logo, with the
`vector_illustration` style and the `bold_stroke` substyle. The substyle keeps the
drawing flat, which prompt wording cannot do. No local model enters the creation
path. Each capability incarnation gets one accepted artwork from at most three
claimed calls.

The request holds everything constant except the subject phrase, the two shades and
the seed, and `buildLogoGenerationRequest` has no parameter for anything else, so no
caller can vary the rest.

The spec authors three logo birth facts. `subject` is a short phrase naming one
concrete object. `ground` is the hue of the field the object sits on, and
`companion` is the hue the object is drawn in. Each names one of eight hue families,
such as `cyan_blue` or `mustard_ochre`. The two must differ, and the spec checks
that over the whole object because a per-field enum cannot see the pair. The
families are named as hues and never as things, because the model reads a colour
named after a thing, such as sky, as a scene to put behind the object. Signal red is
reserved for alerts and destructive confirmation and is not offered.

The platform chooses the shade. Each family opens onto four shades, and
`resolveLogoShades` picks one shade of each family from the incarnation's seed. No
spec authors a shade, and no caller can steer the choice. The model choosing the
hue keeps the colour apt, and the seed choosing the shade lets two capabilities
that name the same hue come out in different colours. The seed is the only entropy
in the colour path. A family's four shades differ in hue as well as lightness, so a
capability that names `cyan_blue` can come out cyan, azure, aqua or cerulean.

Shades are not design tokens and style nothing: the tile is a full-bleed SVG, and
the shell adds no colour of its own. Every shade in the platform's table is
saturated and light enough for daylight, with no near-blacks, pastels or grays, so
validating a spec's colours is a check against eight names. A test measures the
table, never model output.

The seed is minted with the incarnation's first registry row and carried unchanged
through every version. It is never derived from the capability's name or position,
because a rename or a move would then re-describe artwork that is never redrawn.
The same seed goes to the service as `random_seed`, and the registry keeps it as
the record of what drew the artwork.

The request names the ground twice, once as `controls.background_color` and once
in words inside the prompt, because naming it in only one of the two places does
not work. Both name the resolved shade, and the prompt names the companion's shade
in words too. `controls.colors` carries exactly the two shades, ground first.
Passing the whole palette returns a busier, heavier drawing and gives the model
enough colour to build a horizon out of.

The prompt wraps the subject phrase inside a sentence and never puts it at an edge
of the prompt. `controls.no_text` alone does not stop the model lettering an
unwrapped description into the drawing, and the wrapping closes that gap.

The subject comes from what the capability is for, never from art direction in the
person's words. The Intent Resolver refuses a prompt that tries to direct the logo,
under the general rule that refuses "move this 2px right" or "add more padding":
how a thing looks is Aluna's to decide, and a logo is presentation. No
logo-specific validator exists, because this is not a logo-specific defense.

Nothing else in the spec feeds the drawing. The label and the record noun may
change as a capability evolves, and changing either never draws a logo.

The prompt block may be edited freely and carries no version. A retry only ever
runs for a capability that has no picture at all, so a changed prompt has nothing
to be inconsistent with, and no rule asks two logos to look as if they came from
the same period.

Two capabilities may look alike. No capability's colour depends on another's, and
nothing in the request spends effort keeping two apart. A shared ground colour, a
repeated subject, a gradient the prompt asked against and a background blocked into
panels are accepted outcomes, and no code looks for them.

### The shell adds the rest, outside the file

The artwork arrives as a full-bleed square, so its own colour field is the
silhouette and the shell draws no edge. The shell clips a 10% corner, casts a hard
offset shadow in ink that is never blurred, and draws the tile at 64px, in pixels so
the drawing never scales with the reader's text size. The tile is the only square on
the surface with a rounded corner. It is also the only exception to the desk's
drawn-line rule, because a logo is a picture where everything else is a boundary,
and it has to read as pressable. A percentage keeps the corner's shape at any size.

The corner clip also removes a defect. A generation sometimes paints white wedges
over its own corners, the largest measured at 8.5% of the side, and a 10% clip
removes all of them. The clip lives only in CSS, so a server-side raster of a logo
that skips the mask shows pale corners wherever a drawing has them.

The service returns filled paths only, although the prompt asks for a dark
contour. The colour-against-colour look is therefore emergent, and no contour can be
added to the artwork afterwards, which is one more reason the tile carries no line.

The capability's name is written straight onto the desk with no plate behind it,
carried by a halo of three straight-down shadow passes. That halo is the only
blurred type treatment in Aluna, and the prompt notice shares it because it too is
read off the wallpaper. The no-blur rule governs the shadow an object casts onto the
desk, and a glyph casts nothing. The name wraps to two lines and then truncates;
`design/logo.html` holds its face, size, colour and measure.

### A logo is drawn once, after v1 activates, and kept as it arrived

The first attempt follows a successful v1. The Gate, publication and SQLite
activation have all succeeded before anything is ordered, so a build that fails,
goes stale, is cancelled or never activates draws nothing, and a provider failure
cannot roll back or relabel the build's success. Evolution never enters this path.

Activation commits the seed and a logo lifecycle of `absent` with no attempts
spent, and the build's commit event puts the capability's tile on the desk as a
placeholder. That arriving tile arms the first attempt. Its claim is a short
platform write that waits for the build to release its lease, so the build stream
can end before the artwork exists. Until the artwork lands, the capability stands
on the same placeholder that marked its ground while the build ran.

What comes back is stored as received: gradients and all, with no stripping, path
rewriting, cleanup or retouching. Before installing, the attempt checks that the
response carries base64 that decodes to an SVG document, and then keeps the bytes
untouched. Everything the shell adds sits outside the file.

A logo is made once and **never remade**. Rendering does not regenerate it, and
evolving the capability does not touch it, so every later version keeps the drawing
v1 was born with. Deleting the capability and building it again is the only route
to a different logo. An evolved capability therefore keeps a subject drawn from what
it used to hold: a reading journal that grows into a library catalog still shows
the open book it was born with.

A logo that fails to arrive is retried, never faked. No drawn stand-in takes its
place, because a stand-in that persists becomes the capability's face by accident,
and the never-remade rule would then forbid replacing it.

### Delivery: one immutable picture route per incarnation

Each incarnation serves its artwork from `/capability/:id/:incarnation_id/logo.svg`
as `image/svg+xml`, marked immutable. The incarnation is in the address because a
deleted id may be built again with different artwork, and an immutable address
keyed by the id alone would let the browser reuse the deleted lifetime's bytes. The
never-remade rule makes the directive honest, since one incarnation's bytes never
change. The desk uses the address unchanged as the tile's `background-image`.

Only a matching active incarnation whose lifecycle is `present` receives the
immutable answer, and the tile carries the address only then. Every other answer is
`no-store`, whether the row is in another state, the incarnation does not match or
the file is missing, so a request made before the artwork arrives cannot cache its
absence.

The response headers make the file picture-only: it renders as an image where the
desk draws it and is inert when its address is opened as a document, while the
stored bytes stay untouched.

The C2PA provenance block is kept, and the response is gzip-compressed for any
client that accepts it. The block is a small fixed size against the drawing's paths,
so stripping it saves little and destroys the record of where the drawing came from.
Gzip saves more and changes nothing on disk.

### Storage: a file at the incarnation root

The artwork is `capabilities/<id>/<incarnation_id>/logo.svg`, beside the immutable
`v<n>/` directories, outside the active version's snapshot and outside the registry.
A retry can therefore install it after activation without mutating a published
snapshot or falsifying the snapshot's recorded inventory. Deletion already removes
the incarnation tree, so the artwork's lifetime follows the capability's with no
second cleanup path, and a registry read never carries a picture nobody asked for.
Installation never overwrites: a second installer fails, and the first drawing
survives.

### Retry: three claimed attempts, then never

The registry keeps a durable logo lifecycle for each incarnation: a status of
`absent`, `generating`, `present` or `abandoned`, and the count of attempts spent.
An attempt is spent when its claim is won, before the service answers, and the
claim's own conditional write enforces the cap, so concurrent loads cannot spend the
same attempt. Every failure consumes its claimed attempt, whether a timeout, a
cancellation, malformed output or a failed install, and every attempt removes its
own staging file when it ends. After three failed attempts the lifecycle is
`abandoned` and the placeholder is permanent.

A missing provider key or a closing read gate is checked before the claim, so
neither spends an attempt. The desk sends its armed attempts one at a time, because
a burst draws refusals that each spend one.

The three-attempt cap is the only limit on retries. A cap ends a retry loop, where a
time budget only bounds how long it runs.

An attempt is a `POST` to `/capability/:id/:incarnation_id/logo-attempt` that
answers only an htmx request that is not cross-site. A navigation, a plain form or
another site's page gets nothing. Each attempt spends one of the three, so it is
never a `GET`, because a browser, a prefetcher or a proxy may make a `GET` on its
own. The response is `no-store` and replaces only that tile. It comes back inert
even when a failure returns the row to `absent`. Only a fresh desk render or a newly
activated tile arms an attempt, so one swap cannot spend all three attempts in a
loop.

The desk-load sweep is the whole retry mechanism. Every full-page render of a desk
address arms one load-triggered attempt on every `absent` tile, and no scheduler
exists, because the desk load is the one moment the platform reliably gets. A load
that loses a claim makes a **bounded observation**: it waits on the winner's own
in-process completion, for no longer than the winner itself can run, and answers
with the tile the winner produced. It calls no provider, never holds up the desk's
first render and polls nothing, and it stops waiting when the reader who asked has
gone.

Logo recovery runs before a desk is drawn, on every full-page desk render and once
at boot. Only an `absent` tile arms an attempt, so a row that a crash left in
`generating` would otherwise never be offered another. Recovery is a registry write
on a `GET`: it corrects state the platform already knows to be untrue, it is
idempotent, and it never calls the service. It waits only a bounded moment for
mutation ownership and leaves the rest to the next load, so a build holding the
platform's lease cannot make recovery the thing that blocks the desk.

Recovery settles an interrupted claim from the no-overwrite final file and the count
already spent, and removes any staging file the crashed claim left. It never
decrements a count, never deletes an accepted file and never spends a fourth call.
A `present` row whose file has gone becomes `abandoned` and keeps the permanent
placeholder. It is not redrawn, because the never-remade rule still holds after a
loss.

A running claim and a crashed one leave the same durable row, and recovery has to
tell them apart before it touches either. The platform tracks the attempts running
in this process, from before each claim is asked for until after it is finalized,
and recovery settles only rows that nothing here is holding. That set is exact where
a timestamp would guess how slow the service is allowed to be, and the bounded
observation reads the same set. Each transition also revalidates, inside its own
write, the status and count it was decided from, so a claim taken while recovery
waited cannot be released from under a running call.

Claim and finalization are short writes bound to the exact active incarnation.
Between them, the provider call and the installation hold that incarnation's read
token and observe its cancellation, and each attempt has a time bound. A deletion
that races an attempt therefore cancels the call or removes the installed file with
the incarnation tree, and a late response cannot mark a deleted capability present.
The token is released before finalization asks for mutation ownership again,
because a queued acquisition awaited inside a read-token scope deadlocks against a
deletion.

## Considered options

**A general-purpose local model.** It returns detailed illustration and ignores the
palette.

**Recraft's v4 vector models.** They accept no style, substyle or controls, so neither
the flatness nor the two colours could be held in the request.

**A companion derived from the ground by a fixed lookup.** It would keep the second
colour out of the spec, but it allows only one pair per ground and never chooses the
second colour for what the capability is.

**A spec that names the exact shade.** It would hand the variety to the model that
collapses to one answer, and tiles would keep coming out the same colour.

**Sanitizing the SVG on arrival.** It would rewrite the drawing, and the picture-only
headers already make the file inert without touching it.

**A registry column for the artwork.** It would be a second lifetime to keep in step
with the capability's.

## Consequences

The registry carries the logo lifecycle as a status and an attempt count, because
the desk-load sweep needs state it can query and claim atomically, and a missing
file offers neither.

The two logo routes are platform code beside the fixed `/capability/:id/:action`
convention and never a generated Action. Their four segments mean no Action can
collide with them. Serving holds the exact incarnation's read token, so deletion
cannot race the file.

Evolution never reads or writes the logo. The Diff Engine has no logo fact,
candidate validation rejects a candidate that moves `subject`, `ground` or
`companion`, and no change to a spec can select regeneration of its artwork.

Deletion needs no logo step. Removing the incarnation tree takes the file with
everything else the capability owned
([ADR-0006](0006-capability-evolution-versioning-and-diff-contract.md)).

The logo is also the doorway to Rename and Delete, through its context menu. Rename
changes only the platform-owned display-label override, so the authored snapshot,
id, address, version and artwork stay as they were, and nothing in this contract
moves. The flow behind the menu belongs to ADR-0006.
