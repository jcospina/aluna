# 0010 — Record addresses and answer links

Status: Accepted

## Context

A capability's collection has an address, `/capability/:id`. Without an address for each
record, a record would open only from its card. A question about a Photos capability can
count its photos, but to see one the person would read its name in the answer and then
hunt for its card, and an open record would survive no reload and could not be pasted into
a new tab.

Two constraints shape the design. Every capability declares the same fixed five Actions,
each served by a generated Handler. And an answer is prose (ADR-0008) whose words reach
the screen as escaped text, so anything in it that points somewhere has to come from the
platform.

## Decision

### The address

The address has three shapes. `/` is the bare desk, `/capability/:id` is a capability's
collection, and `/capability/:id/:record` is one record open in its record view: the
*record address*. `:record` is the record's `id`, a random UUID, compared in lower case.
The search term and a half-typed edit stay out of the address and die with the tab. The
record view is the form in edit mode, and Aluna has no read view of a record.

Opening a record moves the address. A card press pushes the record address. The back
control, Save, Cancel and Delete return to wherever the record was opened from, a
collection or another record, and the back control names it. When no such place is known,
as after a pasted address or a reload, they go to the record's own collection. Back and
Forward render without pushing, and the leave question and the run hold cover a record
address like any other traversal.

A build gives back the collection, and the address follows it. A build's restoration
descriptor names a capability and never a record. A build started from a record address
keeps that address while it runs, as it keeps any address it displaced. When it gives the
window back to that capability, restored or shown evolved, the window shows the collection
and the address is replaced with `/capability/:id`, adding no entry. A successful first
build pushes its new capability.

### The record address is a platform route

`GET /capability/:id/:record` is registered ahead of `/capability/:id/:action`. A segment
shaped like a UUID is a record, the five Action names keep their route, and anything else
answers 404. No Action can collide with a record, and the fixed set of Actions does not
change. The route takes a read token and closes with the read gate, as the collection view
does, and its full-page load runs the desk-load recovery.

The server draws the record. The platform reads one row by `id` from the active
incarnation's table and narrows it as the collection does, so the view gets no inactive
field and no `extra`. It draws the record view, and no generated Handler runs. With
`HX-Request` the route answers the record view fragment for the window. Without it, the
route answers the whole desk, which opens the record from its address, so a reload, a
pasted address and a new tab all land on the record. A card press asks this route too.

Between the form's fields and its action row, the record view lists the records linking to
the record: each relation pointing in gets a section of the linking records, newest first,
drawn with the linking capability's own item renderer. The route takes each linking
capability's read token apart from the record's own, and draws each section under the
Handler timeout. A renderer that throws, or returns after the timeout, leaves its section
out, as does a linking capability its own deletion has closed, and the record opens either
way. A renderer that never returns is out of reach, as on a list route. "Show all" fetches
the rest of a section under the same tokens and the same timeout. An item renderer is
generated presentation the Gate already checked, so the record view runs no Handler.

An absent record leaves its capability open. A record address whose record was deleted,
never existed or lives in another capability opens that capability's collection, says the
not-found notice on the prompt bar, answers 404, and corrects the address to
`/capability/:id`. An absent capability gives the bare desk.

### Answer links

The model nominates records, and the platform vouches for them. When a question asks about
particular records rather than a figure, the turn prompt asks the model to select `id` with
them. The answer schema is `{ answer, records }`, where `records` is a required array,
possibly empty, of `{ says, id }`: the words in the answer that name a record, and the id
the model says it read for it. Both keys are required, which keeps the schema valid under
strict structured outputs. The platform keeps a nomination only when five checks hold:

1. The id came back as a whole cell in a row that some step returned.
2. Exactly one capability read by the steps that returned the id holds a record with that
   id, checked inside the question's own read scope.
3. That capability has a record view.
4. `says` stands as whole words in a cell of a row that returned the id, and that cell,
   ignoring case, is one of the record's own text or choice values. A statement can return
   any id beside any name, so this check links a name to the record it names and not to one
   returned beside it.
5. `says` occurs in the answer outside any other link.

The platform links the first free occurrence of `says` that stands as words of its own,
else the first free one. It drops any other nomination without a word, and the answer is
spoken either way. Only an answered question carries links. A question that ends on
**nothing matched** or **nowhere for it**, whose every statement failed, or that spent its
step budget ends in the platform's own sentence, which links nothing.

The prose never carries an id. The prompt tells the model so, and the platform removes from
the answer every record id the steps returned before it is shown.

The platform builds every link. The answer fragment holds escaped text runs and `<a
data-answer-record href="/capability/:id/:record">` elements whose text is the escaped
`says`. The client reads that fragment parsed and inert. Of each anchor written that way it
keeps only its words and the two ids, which it validates, and it reads every other node as
the words it shows. It then builds each anchor itself, with `createElement` and
`textContent`, through the one `recordAddress()` builder in `public/core/routes.js`.
Generated item markup cannot emit `<a>` or `href`, and a card stays a `<button>`.

A plain press on an answer link takes the same path as a record address: push, then open,
under the same leave question and run hold. The answer window stays where it is, and the
capability window comes forward with the record's first field focused. A modified or
middle press belongs to the browser and opens the record address in a new tab.

## Considered options

**The record view as a sixth Action.** It would change the fixed set of Actions every
capability declares, and it would put a generated Handler on a read the platform can do
alone, from the same narrowed row a card is drawn from.

**A read view beside the form.** The record view is the form in edit mode, and Aluna has
no read view (ADR-0005), so the record address opens the form.

**The incarnation in the record address.** Record ids are random, so a capability deleted
and built again under the same id holds none of the old records, and the absent-record rule
already answers an address from before the rebuild.

**Ids in the prose, or links the model writes.** An id in the spoken text or an anchor the
model wrote would reach the screen without the platform's checks, so the platform builds
every link from ids it checked.

## Consequences

**Generated code never handles a record address.** A linked field reaches a Handler as the
text it holds. The open icon in a linked field, which the platform draws, opens its
target's record address and takes the same path as a press on an answer link (ADR-0011).

**The answer window carries answer links and never a capability's records.** It shows
prose and the platform-built links inside it. It shows no file, no image and no file
address, and the question loop never sees a file key (ADR-0008, ADR-0009).
