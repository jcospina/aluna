# 0011 — Linked capabilities

Status: Accepted

## Context

A capability keeps its records in a table of its own, and a person's records often name
records that another capability keeps. A library is three small capabilities, Authors, Books
and Inventory: each book names its author, and each copy in Inventory names its book. A
capability can read another one's table through `read_dependencies`, but that records
nothing about which record points at which. Typed as text, "Ursula K. Le Guin" sits in Books
and again in Authors, and nothing tells Aluna that the two name the same person. Renaming her
in Authors leaves every book on the old name, and a question about her books has to guess a
join on plain columns.

The mechanism is described under
[Linking capabilities](../architecture.md#49-linking-capabilities) in the architecture.

## Decision

### What can link

**A model judges which fields relate, and Aluna does all of the wiring.** The judgment is
semantic: Inventory's book title names a record that lives in Books, and Movies' title names
nothing anywhere else, though both fields are called title. The wiring is mechanical and the
same for every link, so the platform does it with no model. It stores the relation, draws the
dropdown, keeps the picked record's id, refreshes linked text, and follows links in search, in
questions and on deletion. Generated code carries no link logic, and Handlers, cards and
frozen tests see a linked field as the text it always held.

**Only single-line text fields link, as source and as target.** A single-line text field is a
`string` field the form does not draw as long text (`ui_intent.form.long_text` names the long
ones). People link to show a name, a title or another readable identifier, and those live in
text fields. A paragraph matches no record, and a yes/no or a date has no reading to show. A
list of text never links: anything can be added to a list, in any amount, and linking only the
items a model chose would be half a feature. A choice field never links either. A field holds
at most one relation, and each record picks at most one target record, so a *Good Omens* typed
with "Pratchett and Gaiman" in one author field stays text.

**A relation names one field and what it points at, and nothing else.**

```
relations: [
  { field: "author",
    to: { capability: "authors", incarnation: "inc_…", field: "name" } }
]
```

Nothing else is read, so nothing else is stored, and nothing records whether the link step or
the Link control made a relation. Four rules decide which fields can link:

1. The source is an active single-line text field of this capability, holding no other
   relation.
2. The target is an active single-line text field of another capability: one the Intent
   Resolver flagged, when the link step proposes it, or any capability, when the Link control
   writes it.
3. The target is read under the lease the write holds. Its incarnation is pinned and checked
   again when the relation is written: at activation for a build, and at once for the Link
   control and a linking-only request.
4. The source's length limit is absent or at least the target's, so a picked or refreshed name
   always fits.

**A target may itself be a linked field, and a relation that would close a loop is refused.**
Quotes · entry → Reading Log · title → Books · title is allowed: each quote names a log
entry, and each entry names a book. Editing a book's title rewrites Reading Log's title, which
is itself a change to a target, so the linked-text refresh follows the chain to Quotes' entry
and writes each field once. Two fields that each show the other's text would have no source:
both would be dropdowns, and no record in either could ever take a new name. A relation is
therefore refused when its target already reaches its source through other relations, dormant
ones included, so reviving a field can never close a loop either. The Link control's chooser
leaves out a target that would close a loop, as it leaves out one that is too long.

### Where a relation lives

**A relation lives on the capability's registry row, never in the spec a model writes.** It sits
beside the logo seed and the display-label override, and the evolution writer never sees it.
Changing a relation makes no version. Aluna updates the row in place, as Rename updates a label,
so no code regenerates and no frozen test moves. Every evolution carries relations forward
unchanged, and the link step never re-decides one. Only Unlink, or deleting either capability,
removes a relation. A relation diff of its own maps every relation change to platform work, so
the Diff Engine's change-fact contract does not grow.

**A relation whose rules stop holding is dormant until they hold again.** Hiding the source or
the target field breaks a rule, and so does an evolution that moves either field into long
text or changes either one's length limit so that rule 4 fails. Refusing the evolution would
let a link fail a build, and dropping the relation would undo a link the person made. The
relation goes dormant instead: Aluna treats it as absent, the field keeps its text, and a
source that is still active is drawn as plain text. Its link rows stay, but a save that
changes the field's text drops that record's row, so a revival never overwrites what the
person typed. When an activation lets the rules hold again, the relation wakes inside the
activation transaction. Each record whose link row names a target record shows that record's
current text, a row naming a record that holds no name is deleted, and the names typed while
the relation slept are matched. A field behind a dormant relation shows neither the Link
control nor Unlink. It cannot take another relation, and Unlink takes only a relation that
holds, so a dormant relation stays until it wakes or either capability is deleted.

### Saving a linked field

**The field keeps its text, and the picked record's id lives in the link table.** The link
table holds rows of source capability, record and field, each pointing at a target
capability, incarnation and record, on the file ledger's pattern (ADR-0009). Generated code
reads and writes the source table exactly as it would with no link. The link table lies
outside every Handler's query scope by construction: a Handler's query may open only the
`cap_` tables in its scope, so a platform table is out of reach with no list to maintain.
Every Gate scratch database has one too. It is indexed from both ends, because the refresh, a
record's deletion and search start from the target.

**Links are soft, and the id wins.** Text is never refused for lacking a match. A name typed
before its record exists, a work that names two authors, and a target deleted since are
ordinary on a personal desk, and none of them may cost the person a save, a record or a build.
A linked field is a dropdown of the target's records and cannot be free-typed while it is
linked. The form posts the text and a reserved marker carrying the picked record's id, which
the router checks before generated code runs and again inside the transaction, as it does a
file reference. When a valid id arrives, the stored text becomes the target field's current
text in the same transaction, so neither a Handler that title-cases the name nor a form opened
before the target changed can alter what the link shows. The link row is written inside the
mutation interface, in the record's own transaction, because that is where a new record's id
is minted.

**A save is refused for what it posts to a linked field only when it would write a wrong
link.** A pick that names no target record holding a name, because it was forged or the
record was deleted or cleared while the form was open, refuses the save, and the field asks
for a new pick. An Edit form that drew a field as plain text, before it was linked or while
its relation slept, is refused as changed, as a form drawn before an evolution is, when it
posts other text than the record holds while the record's pick stands: the refresh may have
moved the text under the form, and saving would write an old name over the link. A marker
for a field whose relation is gone or dormant is dropped, and the text saves as plain text.
Nothing about a link can make a record fail to load, whether its link row dangles, its
target's incarnation is gone or its relation is dormant. No build or test can fail because of
a link: the Gate binds no relation, so a Gate run writes no link row and its inputs do not
change.

### Linked text

**When a target's text changes, every field linked to it follows.** The linked-text refresh
rewrites those fields in the target record's own transaction, under the record lease the save
already holds. It takes no lease of its own, because the mutation coordinator admits one lease
at a time and a second request from inside the save would wait on itself. The router takes
the read token of each capability that the refresh or a deletion's clearing reaches, one
capability at a time, so a linking capability that its own deletion is closing is skipped,
never waited on: that deletion takes its relations and link rows with it.

**Clearing a target's text deletes its link rows and leaves every linking field's text.**
When an edit leaves a target field holding no name, empty or holding only spaces and invisible
marks, the refresh carries nothing down the chain. It deletes the link rows that name the
edited record, for every relation pointing at that field, dormant ones included, and writes
nothing into the linking fields. Every linking field, optional or required, keeps the last
name it showed, and one whose relation holds carries the broken-link mark, which asks for a
new pick. A link needs a target record that holds a name: a pick of a record holding none is
refused, and a revival deletes a row naming one.

**Only platform SQL writes into another capability's records.** Every write a Handler makes
lands in its own capability's table. Three platform writes reach across: the linked-text
refresh, emptying the optional fields linked to a deleted record, and a woken relation's
revival. Each runs inside the transaction of the save, deletion or activation that caused it,
and each touches only linked fields' columns.

### Making and removing a link

**Links are applied with the build, and nobody is asked to confirm them.** Aluna is not a
coding agent: it builds and delivers. A wrong link costs one Unlink, with no model, and a
question before every build that links would stop every one of them.

**The Link control makes a link by hand, with no model.** Product copy calls it connecting,
and docs and code say *link*. An icon-button sits inside every unlinked single-line text field,
in a new record and an existing one. It opens a chooser listing every single-line text field
of every other capability that can be picked, each with a few of its values, so a name, a
title, an ISBN and a phone number can all be targets. Aluna suggests one by comparing the
clicked field's name and label with each capability's record noun and each field's name and
label, and the suggestion only orders the list. A target that cannot be picked is left out,
since a choice the person cannot make is noise in the list.

**The Link control writes under the platform-write lease, as Rename does.** A link is an
in-place change to the registry row, like a new name, and that lease queues behind a running
build, so a link never races an evolution. The write is conditional on both ends as the
chooser read them: when a build changed either end in the meantime, the press is refused as
stale, nothing is written, and the prompt bar says so. A queued press whose connection closes
leaves the queue and writes nothing. No record save can land while the matching scan runs, so
every Save, Delete, Link and Unlink button on the page fades until it ends. A press waiting
behind a build fades nothing.

**The matching scan links what is already typed.** It runs in the transaction that writes the
relation. It trims spaces and invisible marks at both ends, folds case but not accents, and
links each value that matches exactly one target record. Ambiguous and unmatched values
keep their text and carry the broken-link mark, and no stored text changes. The prompt bar
then reports how many records were connected and how many need a pick. The scan runs again
when a dormant relation wakes, and at every startup for each name a linked field holds without
a working link.

**Unlink asks once and gives the field back.** The question is asked over the window, with the
disconnect button in red, and says that each record keeps the text it shows. Unlink deletes
the relation and its link rows, leaves every record's text as it was, and makes the field plain
text again. A link's target is never changed in place: Unlink, then Link.

**The broken-link mark shows a linked field holding text with no record behind it.** The
platform's item wrapper draws it on the card in the list, never the generated card, and in the
form the line under the field takes its place. It covers names the matching scan could not
place, links broken by deleting a target record on a field that keeps its text, and links
broken by clearing a target's text. It asks for a pick and refuses nothing. At startup the
matching scan relinks a marked name that exactly one target record holds.

### The model's part

**The Intent Resolver alone flags the existing capabilities a request relates to.** The flag
judges what each capability keeps, not field names or phrasing: a capability is flagged when
a new record, the field an extension adds, or the field a linking-only request links would be
about or would name one of its records. The spec writer and the link step see only the
flagged capabilities, each with its single-line text fields and their length limits, so the
two steps cannot disagree and the field that names a record gets a limit that fits. The spec
writer chooses the fields the request needs as it would with nothing flagged, except that when
one of them names a flagged capability's record, it leaves out the facts that record keeps:
they are read through the link, and a copy would drift from the record. When nothing is
flagged, the spec writer's prompt is unchanged and the link step does not run. An
evolution's flags reach only its link step, so the field a person asks for is added as asked,
and the step's relation for it is dropped if the field's length limit breaks rule 4.

**The link step is one model call with one job, and it fails open.** It reads the request, the
finished spec and the flagged capabilities, and answers which single-line text field of the
spec points at which single-line text field of each. It never adds, removes or edits a field,
because removing a field after the spec is written would leave sentences about it in the prose
the tests and unit generation read. A shared field name alone relates nothing. On a build the
step runs beside the frozen tests and unit generation, because nothing generated depends on a
relation, and on an evolution it runs only for the text fields the change adds. Aluna checks
each entry on its own against the four rules and the loop rule, on the answer and again in the
activation transaction, and drops a bad one. A failed or timed-out step means no relations,
never a failed build.

The Core Builder's units fail closed and the link step does not, because they produce different
things (ADR-0003). A unit's output is code that runs against the person's data, and a build
that published a broken unit would publish a broken capability, so a unit that fails its
second attempt fails the build. A relation is optional platform state that nothing generated
reads. A build without one is complete, and failing a two-minute build over it would discard
every unit that succeeded to save the person one link.

**A request only about linking runs the link step alone.** For "link each book to its
author", the Intent Resolver flags Authors and answers with its own type, `link_capability`.
The link step runs on Books' committed spec under the build lease, with no spec writer, no
code, no Gate and no version. Each relation it proposes is checked against the rules at once
and written through the Link control's own write, with the matching scan, inside that lease. A
step that fails or finds nothing changes nothing, says so on the prompt bar and leaves the
window as it was, and the request writes no metrics row.

**Building a capability never links an existing one on its own.** A build changes one
capability, and the link step looks only at the capability being built. Building Authors
leaves Books' author as typed text until the person links it, by hand or by asking.

### Deleting

**Deleting what a link points at never holds anything up.** Deleting a target record never
deletes or blocks the records that point at it. An optional field linked to it through a
relation that holds is cleared. A required one keeps the last name it showed and carries the
broken-link mark, and nothing extra is stored, because the field's own column already holds
that name. A cleared field that is itself a target is treated as a target whose text was
cleared, so the link rows through it are deleted and no text moves further down the chain. A
field behind a dormant relation is plain text, so it keeps its text and loses only its link
row.

Deleting a target capability works like Unlink on every relation pointing at it: the relations
and their link rows go, every record keeps the text it shows, and the field is plain text
again, with no mark, because nothing is left to pick. Deleting a capability whose own fields
are linked takes those relations and their link rows with it, in the same transaction. A
relation is no `read_dependency` and never blocks a capability's deletion.

### Search and questions

**Search follows links, in platform code.** Searching Inventory for "sanderson" finds the
copies of his books when Inventory holds only titles and counts. The generated search Handler
runs unchanged, and Aluna notes which records its cleaned answer shows, from the cards drawn
through `present`. It follows every relation that holds, out of the searched capability and
into it, and does the same from each capability reached, searching each one once by the rule a
search Handler is given, under its own read token. It then walks the link table back to the
searched capability's records and appends the ones the Handler did not show, nearest first and
newest first within a distance, and the record count counts them too. Nothing the Handler
returned is removed or reordered. A path enters each capability once, which ends a loop
such as Books → Authors → Books. Search works backwards too: searching Authors for "Mistborn"
finds Sanderson, because a book titled Mistborn points at him.

**Questions follow links.** A question's prompt lists each relation that holds as a join
through the link table, so "how many copies of Le Guin's books do I have?" follows Inventory
to Books to Authors instead of guessing a join on plain columns. A link join declares no
`read_dependency`. The question worker reads the link table through a view that holds only
the rows of relations that hold and leaves out the target's incarnation, which the worker
never learns.

## Considered options

**A foreign key.** A foreign key on the text column would refuse every name with no matching
record, the opposite of a soft link. One on a new id column would tie one incarnation's table to
another capability's in DDL, change what the Gate builds, and make a capability deletion's
`DROP TABLE` reckon with every table that references it.

**A hidden id column in the source table.** Handlers are kept off a column by a list of names to
block, so a new column would join that list and the table's DDL and change what the Gate builds.
A separate table is out of reach by construction and changes no DDL.

**Hide-and-replace, the way an evolution retires a field and adds another.** Linking a field
that holds data would regenerate its Handlers and card, move its data to a new field under a new
name, and need a copy step that no Handler can run. Linking by hand would be impossible, since
its code regenerates, and undoing a link would bring back the old field with stale values.

**Relations inside the spec.** Every evolution's writer would have to return the relation
unchanged, and the Diff Engine would need a new change type or would fail closed on the new key
and block every link change.

**A link projection handed to generated code, a `url` beside the name, as a file reference
reaches it.** It would put link logic in generated code, and a capability built before the link
would show no anchor until it regenerated.

**A settings screen for a capability's links.** Aluna has no capability settings screen, so a
link is made once from a record's form and applies to that field in every record.

## Consequences

**There are no foreign keys.** Joins between capabilities happen at query time, through the
link table for a linked field. Overlap is the Intent Resolver's extend-or-separate decision: a
linked field is the source capability's own field, and the related-capability flag, a separate
judgment, marks the capability a request relates to.

**Generated code receives nothing for a link.** The platform draws the open icon in a linked
field, which opens the target's record address (ADR-0010). It also lists the cards of the
records linking to a record, between its fields and its actions. A capability built before it
was linked shows its links with no regeneration.

**The router's closed set of reserved keys includes `__aluna_link` (ADR-0004).**

**The question loop reads a platform table.** The link table is the one platform table whose
rows a question reads (ADR-0008).