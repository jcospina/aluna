# 0010 — Record addresses and record links in answers

Status: accepted

Seeds epic 7.5 (`modules/07-files-upload-store-serve/PLAN.md`, decisions 40 to 49). It
gives every record an address of its own, and lets an answer link the records it names.
It reverses three earlier decisions: Module 5's decision 6, under which the address
named a capability and nothing below it; ADR-0005's deferral of a route that reads a
single record; and Module 7's decision 37, which kept the answer window text. It amends
the address, router, record view and answer window passages of ARCH, and `design/`'s
D14.

Files made the gap visible. A question about a Photos capability can count its photos,
but to find one the person reads a name in the answer and then hunts for its card.

## Decision

**The address has three shapes.** `/` is the bare desk, `/capability/:id` is a
capability's collection, and `/capability/:id/:record` is one record open in its record
view: the *record address*. `:record` is the record's `id`, a UUID from `randomUUID()`,
compared in lower case. The search term and a half-typed edit still stay out of the
address. The record view is the form in edit mode, as it is today, and there is no
read-only details surface.

**The record address is a platform route, not an Action.** `GET /capability/:id/:record`
is registered ahead of `/capability/:id/:action`. A segment shaped like a UUID is a
record, the five Action names keep their route, and anything else answers 404 as it does
today. No Action can collide with a record, and the fixed set of Actions does not
change. The route takes a read token and closes with the read gate, exactly as the
collection view does, and its full-page load runs the desk-load recovery.

**The server draws the record.** The platform reads one row by `id` from the active
incarnation's table and narrows it as the collection does: `item.shows`, the record
target, the active detail and edit fields, and `created_at`, with no inactive field and
no `extra`. It renders the record view through the presentation adapter that already
writes a card's `<template>`, and no generated Handler runs. With `HX-Request` the route
answers the record view fragment for the window. Without it, the route answers the whole
desk, which opens that record from its address, so a reload, a pasted address and a new
tab all land on the record.

**An absent record leaves its capability open.** A record address whose record was
deleted, never existed or lives in another capability opens that capability's
collection, says the existing not-found notice on the prompt bar, answers 404, and
corrects the address to `/capability/:id`. An absent capability still gives the bare
desk. Every capability declares all five Actions today, so every capability has a record
view. The record view renders nothing for a capability without `update`, and the record
address follows that guard: it would open such a capability's collection without a
notice. Record ids are random, so a capability deleted and built again under the same id
finds none of the old records, and the address needs no incarnation.

**Opening a record moves the address.** A card press pushes the record address. The back
control, a save and a delete all leave the record view the same way. When the entry
before is this capability's collection, they step back. When the person arrived by link,
they replace the entry with the collection's address. Back and Forward render a record
or a collection without pushing. The leave question for unsaved changes and the hold on
a running build cover a record address like any other traversal. `desk-address.js` keeps
its single `pushState` and its single `replaceState`.

**A build gives back the collection, and the address follows it.** A build's restoration
descriptor stays capability-only. A build started from a record address keeps that
address while it runs, as it keeps any displaced address. When it gives the window back
to that capability, restored or shown evolved, the window shows the collection and the
address is replaced with `/capability/:id`, adding no entry. A successful first build
pushes its new capability as before.

**The model nominates records, and the platform vouches for them.** When a question asks
about particular records rather than a figure, the turn prompt asks the model to select
`id` with them. The answer schema becomes `{ answer, records }`, where `records` is a
required array, possibly empty, of `{ says, id }`: the words in the answer that name a
record, and the id the model says it read for it. Both keys are required, which keeps
the schema safe under strict structured outputs. The platform keeps a nomination only
when four checks hold:

1. The id came back as a cell in a row that some step returned.
2. Exactly one capability that step read holds a record with that id, checked inside the
   same read scope.
3. That capability has a record view, which every capability with `update` has.
4. `says` occurs in the answer outside any other link.

The platform links the first free occurrence of `says`. It drops any other nomination
without a word, and the answer is still spoken. Only an answered question carries links.
A question that ends on **nothing matched** or **nowhere for it**, whose every statement
failed, or that spent its step budget ends in the platform's own sentence, which links
nothing.

**The prose never carries an id.** The prompt tells the model so, and the platform
removes from the answer every record id the steps returned before it is shown.

**The platform builds every link.** The answer fragment holds escaped text runs and `<a
data-answer-record href="/capability/:id/:record">` elements whose text is the escaped
`says`. The client builds each anchor itself, with `createElement` and `textContent`,
from a capability id and a record id it validates, through one `recordAddress()` builder
in `routes.js`. It never parses markup out of the answer. Generated item markup still
cannot emit `<a>` or `href`, and a card stays a `<button>`.

**A link press opens the record in the capability window.** A plain press takes the same
path as a record address: push, then open, under the same leave question and run hold.
The answer window stays where it is, and the capability window comes forward with the
record's first field focused, on every desk (owner ruling 2026-10-05).
A modified or middle press belongs to the browser and opens the record address in a new
tab. The answer still has no address, and nothing about it survives a reload.
`intent_resolution_metrics` records no record id.

## Considered options

**The record view as a sixth Action.** Rejected. It would change the fixed set of
Actions every capability declares, and it would put a generated Handler on a read the
platform can do alone, from the same narrowed row a card is drawn from.

**A read-only details surface beside the form.** Rejected. The form in edit mode is the
desk's one record surface (ADR-0005, amended 2026-08-20), and the record address opens
that surface rather than adding another.

**The incarnation in the record address.** Rejected. Record ids are random, so a
capability rebuilt under the same id holds none of the old ones, and the absent-record
rule already answers an address from before the rebuild.

**Ids in the prose, or links written by the model.** Rejected. The model nominates and
the platform checks each nomination against what the steps returned. An id in the spoken
text or an anchor the model wrote would reach the screen without that check, so the
platform builds every link from ids it checked and never parses markup out of the
answer.

## Consequences

**Module 5's address rule is reversed.** Module 5's plan is closed and stays as it was.
ARCH, `CONTEXT.md` and `design/`'s D14 carry the third shape, and *record address* is
the term. "Deep link" stays on the Avoid list.

**ADR-0005's read-single route now exists, as a platform route.** ADR-0005 deferred it
because it would expand the fixed route contract and add a generated handler. This route
adds no handler and no Action: the platform reads the record, and the closed item
vocabulary is unchanged.

**The answer window carries links, and still never a capability's records.** It shows
prose and the platform-built links inside it. It shows no file, no image and no file
address, and the question loop still never sees a file key (ADR-0008, ADR-0009).

**Module 8 points at the record address.** Its link projection hands generated code a
`url` beside a name, as a file reference does. For a linked record that `url` is the
record address, so Module 8 needs no second scheme.

**Module 10's Event Log must admit the record address as a route context.** The Event
Log derives which capability incarnations an event belongs to from admitted route, query
and read-token context, and an event recorded on a record address belongs to that
record's capability exactly as one on its collection does.