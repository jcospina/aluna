# 0011 — Linked capabilities: the model judges, Aluna wires

Status: proposed, for the owner's sign-off at 8.1/01. The amendment notes on ADR-0004,
ADR-0006, ADR-0008 and ADR-0010, and the amended live documents, take effect with it.

Seeds Module 8 (`modules/08-composition-linked-capabilities/PLAN.md`, decisions 1 to 29
and 42 to 56): a record in one capability can point at a record in another, so a library
is three small capabilities, Authors, Books and Inventory. The record surface, decisions 30
to 41, keeps the form as the one place a record opens, and joins this record as 8.2 and
8.3 build it.

Before Module 8, a capability could read another one's table through
`read_dependencies`, but nothing recorded which record points at which. Books holds each
author as typed text. Building Authors puts "Ursula K. Le Guin" in two places, and
nothing tells Aluna they name the same person.

This record withdraws a promise: ADR-0010 and Module 7's decision 49 said Module 8's link
projection would hand generated code a `url` beside a name, and generated code now
receives nothing. It amends ARCH §3, the Intent Resolver's overlap rule (§6.2), the
storage passages (§6.3) and §8, and the passages on the registry row, the Builder, the
Diff Engine, writes, reads, search, the query loop, concurrency and deletion. ADR-0004, ADR-0006,
ADR-0008 and ADR-0010 carry notes pointing here.

Three rules here are proposed by 8.1/01 and wait on the owner's sign-off, because PLAN
leaves them open: a chain of links and the loop it must not close, a relation whose
rules stop holding after an evolution, and a target whose text is cleared. Each is
marked *Proposed* where it stands.

## Decision

**A model judges which fields relate, and Aluna does all of the wiring.** The judgment is
semantic. Inventory's book title names a record that lives in Books, and Movies' title
names nothing anywhere else, though both fields are called title. The wiring is
mechanical and the same for every link, so the platform does it with no model: it stores
the relation, draws the dropdown, keeps the picked record's id, refreshes linked text, and
follows links in search, in questions and on deletion. Generated code carries no link
logic and never notices a link. Handlers, cards and frozen tests see a linked field as the
text it always held.

**Only single-line text fields link, as source and as target.** A single-line text field
is a `string` field the form does not draw as long text (`ui_intent.form.long_text` names
the long ones). People link to show a name, a title or another readable identifier, and
those live in text fields. Matching a paragraph against records makes no sense, and a
yes/no or a date has no reading to show. A list of text never links: anything can be
added to a list, in any amount, and linking only the items a model chose would be half a
feature. A choice field never links either. A field holds at most one link. *Good Omens*
typed with "Pratchett and Gaiman" in one author field matches no single record, so it
stays text.

**A relation names one field and what it points at, and nothing else.**

```
relations: [
  { field: "author",
    to: { capability: "authors", incarnation: "inc_…", field: "name" } }
]
```

Nothing else is read, so nothing else is stored. A relation made by the link step and one
made by the Link control are the same relation, and nothing records which made it. Four
rules decide which fields can link:

1. The source is an active single-line text field of this capability, with at most one
   relation.
2. The target is an active single-line text field of another capability: one the Intent
   Resolver flagged, when the link step proposes it, or any capability, when the Link
   control writes it.
3. The target is read under the lease the write holds. Its incarnation is pinned and
   checked again when the relation is written: at activation for a build, and at once for
   the Link control and a linking-only request.
4. The source's length limit is absent or at least the target's, so a picked name always
   fits.

**A target may itself be a linked field, and a relation that would close a loop is
refused.** *Proposed.* Quotes · entry → Reading Log · title → Books · title is
allowed: each quote names a log entry, and each entry names a book. Editing a book's
title rewrites Reading Log's title, which is itself a change to a linked target, so
the linked-text refresh follows the chain to Quotes' entry and visits each field
once. A relation whose target already reaches its source through other relations,
dormant ones included, is refused, so reviving a field can never close a loop either.
Two fields that each show the other's text have no source: both are dropdowns,
neither can be typed into, and no record in either could ever take a new name. The
chooser leaves out a target that would close a loop, as it leaves out one that is too
long.

**A relation lives on Aluna's registry record for the capability, never in the spec a
model writes.** It sits beside the logo seed and the label override, and the evolution
writer never sees it. Changing a relation never makes a version. Aluna updates the record
in place, the way Rename updates a label, so no code regenerates and no frozen test moves,
and a test proves it as equal artifact digests before and after. Every evolution carries
relations forward unchanged, and the link step never re-decides a committed relation.
Only Unlink, or deleting either capability, removes one. A relation diff of its own
maps every relation change to platform work, so the Diff Engine's change-fact contract
does not grow. Hiding the source or the target field makes the relation dormant: the text
stays, Aluna treats the relation as absent, and reactivating the field revives it with its
link rows. The revival runs in the activation transaction (8.1/08). Each record a link row
names takes its target's current text, as when the id wins, and the names typed while the
relation slept are matched, as at startup.

**A relation whose rules stop holding is dormant until they hold again.** *Proposed.* An
evolution can change a field the relation names: turn it into long text, give the source
a length limit below the target's, or give the target a larger limit than the source's,
or none. Refusing the evolution would let a link fail a build, and dropping the relation
would undo a link the person made. The relation goes dormant instead, as a hidden field
makes it, and revives with its link rows when the rules hold again. A source made dormant
this way stays active, so the form draws it as plain text. A save that changes its text
drops its link row, so a revival never overwrites what the person typed. While a relation
is active, rule 4 holds, so the text a pick or a refresh writes always fits the source.

**The field keeps its text, and the picked record's id lives in the link table.** The link
table holds rows of source capability, record and field, each pointing at a target
capability, incarnation and record, on the file ledger's pattern (ADR-0009). Generated code
reads and writes the source table exactly as it did before the link. The link table lies
outside every Handler's query scope by construction: a Handler's query may open only its
own `cap_` table and its declared dependencies', so a platform table is out of reach with
no list to maintain. The Gate's scratch database creates it beside the ledger. It is
indexed in both directions, because search walks links backwards.

**Links are soft, and the id wins.** Text is never refused for lacking a match. A name
typed before its record exists, a work that names two authors, and a target deleted since
are ordinary on a personal desk, and none of them may cost the person a save, a record or
a build. A linked field is a dropdown of the target's records, each shown by the target
field the relation names. Typing into it only searches the records the dropdown holds, so
it cannot be free-typed while it is linked. The dropdown and the save hold a read token
for the target's incarnation
as well as their own, so deleting the target cannot race them. A save whose relation woke
or was linked after it read the desk checks its pick inside its transaction, under the
record lease that no deletion can hold beside it (8.1/08). The form posts the text and
a reserved `__aluna_link` marker, carrying the field and the picked record's id. The marker
joins the router's closed set of reserved keys and never reaches a Handler. The router
checks the id before generated code runs and again inside the transaction, as it does for
a file reference. A forged id, or a stale one such as a pick whose record was deleted while
the form was open, refuses the save, and the field asks for a new pick. That is the only
save a link refuses. A marker for a field whose relation is gone or dormant, posted by a
form drawn before an Unlink, is dropped, and the text saves as plain text. The link row
is written inside the mutation interface, in the record's own transaction, because that is where a new record's id is minted. When a valid id arrives,
the stored text becomes the target field's current text in the same transaction, checked
again against the source field's length limit. A create Handler that title-cases the name
cannot change what the link shows, and a form opened before the target changed cannot
write the old text back. Nothing about a link can make a record fail to load, whether its
link row dangles, its target's incarnation is gone or its relation is dormant. No build or
test can fail because of a link, and the Gate's inputs do not change.

**When a target's text changes, every field linked to it follows.** The linked-text refresh
rewrites those fields in the target record's own transaction, under the record lease the
save already holds. It takes no second lease: the mutation coordinator admits one lease at
a time, so a request for another from inside the save would wait on itself. The rewrite is
platform SQL against the linking capability's table. The router hands it the relations and
the linking capabilities' specs. When it admits the save, it takes the read token of every
capability the refresh reaches, apart from the request's own set, and a target record's
deletion does the same for the capabilities its clearing reaches. That is an exception to
taking a token set all at once or not at all, and it lets a linking capability closed by
its own deletion be skipped, never waited on, because that deletion takes its relations and
link rows with it.

**A target whose text is cleared breaks the link the way deleting it does.** *Proposed.* A
target field can be optional while the field linked to it is required, and a refresh would
then write an empty value into a required field. Clearing the target's text instead removes
the link rows: an optional linked field is cleared, and a required one keeps the last name
it showed, as plain text with the broken-link mark.

**A save on one capability now writes into another capability's records.** Before Module 8,
every write into a capability's table came from a request on that capability. The
linked-text refresh, and the clearing that deleting a target record brings (8.4), are the
first writes that reach across. Both are platform SQL and never generated code, both run
inside the transaction of the save or deletion that caused them, and both touch only the
linked field's column.

**Links are applied with the build, and nobody is asked to confirm them.** Aluna is not a
coding agent: it builds and delivers. A wrong link costs one Unlink, with no model, and a
question before every build that links would stop every one of them.

**The Link control makes a link by hand, with no model.** Product copy calls it
connecting, and *link* stays the engineering word (owner ruling, 2026-10-08). A small
icon-button sits inside every unlinked single-line text field, in a new record and
an existing one, and never in long text. It opens a chooser, the drawn listbox the desk
already has, whose heading states the scope, "Connect every book’s author to…". The
chooser lists every single-line text field of every other capability that can be
picked, grouped by capability, each with a few of its values, so a name, a title, an
ISBN and a phone number can all be targets. Aluna suggests one without a model, by
comparing the clicked field's name and label with each capability's record noun and
each field's name and label, and the suggestion only orders the list, in a Suggested
group of its own. A target that cannot be picked, such as one longer than the clicked
field allows, is left out: a choice the person cannot make is noise in the list
(owner ruling, 2026-10-08). The control takes the platform-write lease and writes in
place, as Rename does: a link is an in-place change to the registry row like a new
name, and that lease queues behind a running build, so a link never races an
evolution. Its write is conditional on the row it read, so when a build changed
either end in the meantime, the press is refused as stale, nothing is written, and
the prompt bar says so. A queued press whose connection closes is dropped from the
queue and writes nothing, as a queued rename is. PLAN decision 18 calls that case
refused as stale; the coordinator drops it instead, and with the connection gone
there is no prompt bar to tell. While Aluna connects a field, both buttons fade with
Save and Delete, since no save can land until the matching scan finishes, and one note
atop the form says "Connecting your books to authors…". Nothing fades during a build
(owner ruling, 2026-10-08): the build takes the window, so the form is on screen during
one only in a second tab, where a press waits its turn and then applies or is refused as
stale.

**The matching scan links what is already typed.** It runs under the same lease as
the write that made the relation. It trims spaces at both ends and ignores case, with
Unicode case folding and no accent folding, and links each value that matches exactly
one target record. Ambiguous and unmatched values keep their text and carry the
broken-link mark, ready for a pick. No stored text changes and no code regenerates.
After linking, the field becomes a dropdown in place, and the prompt bar reports how
many records were connected and how many need a pick: "45 books found their author. 5
still need you to pick one."

**Unlink asks once and gives the field back.** The question is read over the window,
as the unsaved-changes question is, with the disconnect button in red, and it says
that each record keeps the text it shows; product copy says disconnect. It deletes
the relation and its link rows, leaves every record's text as it was, and makes the
field plain text again. A link's target is never changed in place: Unlink, then Link.

**The broken-link mark shows a linked field holding text with no record behind it.** It
appears on the card in the list, drawn in the platform's item wrapper and never by the
generated card. It covers names the matching scan could not place, links broken by deleting
a target record on a field that keeps its text, and links broken by clearing a target's text
(proposed above).

**The Intent Resolver alone flags the existing capabilities a request relates to.** The
spec writer and the link step see only the flagged ones, so the two steps cannot disagree.
Each flagged capability reaches them with its name, description, record noun and
single-line text fields, read under the build lease, and each field carries its length
limit, so the spec writer can give the field that names the record a limit that fits. When
nothing is flagged, the spec writer's prompt is unchanged and the link step does not run.
The flag judges records, not field names: the Resolver asks whether each record of the new
capability names one record that already exists, and no flag is the ordinary answer. The
spec writer is told not to add a text field that a flagged capability already holds.

**The link step is one model call with one job, and it fails open.** It reads the
request, the finished spec and the flagged capabilities, and answers which
single-line text field of the spec points at which single-line text field of each. It
returns relations only and never adds, removes or edits a field, because removing a
field after the spec is written would leave sentences about it in the prose the tests
and the code writer read. It never relates on a field name alone: the target's noun
or label has to appear in the request, the field's label or the spec's description.
On a build it runs beside the frozen tests and the code writer, because nothing
generated depends on a relation, and its relations are written in the activation
transaction. On an evolution it runs only for the text fields the change adds. Aluna
checks each entry on its own against the four rules and the loop rule, with the
source drawn from the capability being built and the target from a flagged
capability, and drops a bad one. A failed or timed-out step means no relations, and
it never fails a build or an evolution. The answer's schema is loose, a list of
entries whose every key is a required string, because the openai-compatible wire
sends the model no schema.

The builder's units fail closed, and the link step does not, because what each produces is
different (ADR-0003). A unit's output is code that runs against the person's data. A build
that published a broken unit would publish a broken capability, so a unit that fails its
second attempt fails the build. A relation is optional platform state that nothing generated
reads. A build without one is complete and correct, and it lacks only a convenience the
person adds with Link. Failing a two-minute build over it would discard every unit that
succeeded to save the person one link.

**A request only about linking runs the link step alone.** "Link each book to its author":
the Intent Resolver flags Authors and sees that the request is only about linking. The link
step runs on Books' current spec under the build lease, with no spec writer, no code and no
version. Its source may be any active single-line text field with no relation, its target
must belong to a flagged capability, and the target's incarnation is checked at once. The
relation is written in place through the code the Link control uses, and the matching scan
follows. Both run inside the build lease the request already holds.

**Building a capability never links an existing one on its own.** A build changes one
capability, and the link step looks only at the capability being built. Building Authors
leaves Books' author as typed text until the person links it, by hand or by asking.

**Deleting what a link points at never holds anything up.** Deleting a target record never
deletes or blocks the records that point at it. An optional linked field is cleared. A
required one keeps the text it already holds, the last name it showed, as plain text with
the broken-link mark. Nothing extra is stored, because the field's own column already holds
that name, so the deletion only removes the link row. Two rules were decided without the
owner in 8.4/01 and stay open to reversal: a cleared field that is itself a target is
treated as a target whose text was cleared, and a field behind a dormant relation is plain
text, so it keeps its text and loses only its link row. Deleting a target capability works
like Unlink on every relation pointing at it: the relations and link rows go, every record
keeps the text it shows, and the field is plain text again, with no mark, because nothing is
left to pick. Deleting a capability whose own fields are linked takes those relations and
their link rows with it, in the same transaction. A relation is no `read_dependency` and
never blocks a capability's deletion.

**Search follows links, in platform code.** Searching Inventory for "sanderson" finds the
copies of his books, though Inventory holds only titles and counts. The generated search
Handler runs unchanged, and its whole answer is records drawn through Aluna's `present()`,
so Aluna adds to the results without touching it. Aluna wraps `present()` to note which
records the Handler showed, and keeps only those whose wrapper reaches the cleaned answer,
as the Gate's smoke rung already does at build time. It follows every relation out of the
searched capability and every relation into it, and does the same from each capability
reached, searching each one once with `platform_search_normalize` under a read token. It
follows the link table back to the searched capability's records and appends the ones the
Handler did not show: one link away before two, and newest first within each distance.
Nothing the Handler returned is removed or reordered, and the count sidecar counts the
appended cards too. The once-only rule stops a loop such as Books → Authors → Books. Search
works backwards as well: searching Authors for "Mistborn" finds Sanderson, because a book
titled Mistborn points at him.

**Questions follow links.** Question views gain the link joins, so "how many copies of Le
Guin's books do I have?" follows Inventory to Books to Authors through the link table
instead of guessing a join on plain columns. A link join declares no `read_dependency`.
Every question statement is checked on the platform's own connection, where the worker's
views do not exist, so the link table is admitted to the whole-catalog check by its real
name. The worker shadows it with a view of the same name that holds only active relations'
rows and leaves out the target's incarnation, which the worker never learns.

## Considered options

**A foreign key.** Rejected. ARCH keeps one isolated table per capability with no foreign
keys, and the link keeps that true. A foreign key on the text column itself would refuse
every name with no matching record, the opposite of a soft link. A foreign key on a new id
column is the hidden column below with enforcement added: it changes the capability's DDL
and what the Gate builds, it ties one incarnation's table to another capability's in DDL,
and a capability deletion's `DROP TABLE` would have to reckon with every table that
references it.

**A hidden id column in the source table.** Rejected. Handlers are kept off a column by a
list of names to block, today `extra`, the inactive fields and, outside a record-producing
query, `id` (`src/runtime/data/access/query-runtime.ts`). A new column would join that list
and the table's DDL, and it would change what the Gate builds. A separate table is out of
reach by construction and changes no DDL.

**Hide-and-replace,** the way an evolution retires a field and adds another. Rejected.
Linking a field that holds data would regenerate the create, update and search Handlers,
and the card when it shows the field. It would need a copy step that no Handler can run,
because hidden columns are closed to them. The field would take a new name, since names
never change and must be unique, and questions would move to it. Linking by hand would be
impossible, since code regenerates, and undoing a link would reactivate the old field with
stale values.

**Relations inside the spec.** Rejected. Every evolution's writer would receive the
relation in the committed spec and have to return it unchanged. The Diff Engine would need
a new change type, or it would fail closed on the new key and block every link change.

**A link projection handed to generated code,** as ADR-0010 and Module 7's decision 49
promised: a `url` beside the name, the way a file reference reaches it. Rejected. It would
put link logic in generated code, and a capability built before Module 8 would show no
anchor until it regenerated. The platform draws that anchor itself, beside the linked
field.

**The link step failing closed, like a unit.** Rejected, for the reason under the link
step above.

**The Link control under the build lease,** as the definition first said. Rejected by the
owner on 2026-10-07 for Rename's platform-write lease, for the reason under the Link
control above.

**A settings screen for a capability's links.** Rejected. Aluna has no capability settings
screen, so a link is made from a record's form, once, and applies to that field in every
record.

**A read view a record opens into,** with Edit swapping in the form. Considered in the plan
and dropped by the owner on 2026-10-17. It would have let a person browse links without
the unsaved-changes question, but it would have cost a read rendering for every field
type, an Edit and Cancel swap and a second record surface, and it would have reversed
ADR-0005, ADR-0010 and Module 5's decision 29. The form stays the one record surface: an
icon in a linked field opens the record it points at, and the records linking here sit
between the form's fields and its actions.

## Consequences

**Generated code receives nothing for a link.** ADR-0010's consequence "Module 8 points at
the record address" and Module 7's decision 49 are withdrawn. The record address survives
as what the icon in a linked field opens, drawn by Aluna (8.2/01).

**"No foreign keys" stays true.** Joins between capabilities still materialize at query
time, now through the link table for a linked field. The overlap rule still offers no
"share a field" option, and it loses the reason it gave: a linked field is still the source
capability's own field, and the related-capability flag is how the resolver marks the
capability a request relates to.

**The router's reserved keys grow by one.** `__aluna_link` joins `__aluna_present`,
`__aluna_record_id` and `__aluna_drawn` in the closed set the router checks and strips
before generated code runs (ADR-0004).

**Relations join the registry state an evolution carries.** They sit beside the label
override and the logo seed, a relation diff maps their changes to platform work, and a
relation never blocks a capability's deletion (ADR-0006).

**The query loop reads the link table.** It is the first platform table a question reads,
through a view that holds only active relations' rows (ADR-0008).

**Link and Unlink take the platform-write lease; a linking-only request takes the build
lease.** The matching scan runs inside whichever lease made the relation, and record saves
are refused until it finishes. The linked-text refresh runs inside the save's record lease, with no lease of
its own.
