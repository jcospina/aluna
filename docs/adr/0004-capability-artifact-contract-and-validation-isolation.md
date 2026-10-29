# 0004 — Capability artifact contract and validation isolation

Status: Accepted

## Context

A Handler is the most rewritten code in Aluna. A model writes all five when it builds a
capability and rewrites the affected ones on every evolution, and nobody reads them
before they go live.

Four parties depend on one contract for that code: the model writes to it, the Gate
asserts it, the smoke rung runs it, and the router builds it. Every convention the model
must remember, such as an import path, how to parse HTTP or a table's name, is one more
way for a unit to fail. Only a concrete shape, one default-exported function, is cheap
for the Gate to assert. The smoke rung must be able to hand the same function a practice
toolbox pointed at a scratch database. The router builds the context every Handler
receives, so no Handler parses a request itself.

The interface Aluna supplies must also fail safely when the model gets confused: a Notes
Handler using what it was given cannot write to Recipes.

An evolution may copy a Handler byte for byte once the Diff Engine proves that
nothing it depends on changed (ADR-0006), so the code must keep working as its
capability gains fields.

This record defines a capability's generated code, what that code receives and how the
Gate runs it. ADR-0005 defines how the capability's Views and cards are drawn.

## Decision

### Six units

A capability version holds six generated units: a Handler for each of the five Actions,
and the item renderer. A Handler is a default-exported async function, the item renderer
a default-exported synchronous one, and neither imports anything. The platform derives
each table's DDL from the spec.

No View is a unit. The platform draws every View (ADR-0005), so generated code reaches
the screen only as a Handler's fragment and the cards the item renderer draws through
`present`.

### Handlers take parsed input and an injected toolbox, and return HTML

A Handler receives a context the platform builds and returns an HTML fragment as a
string. The platform owns the route, the response, its status and its headers, and it
strips executable markup from the fragment before sending it. Generated code never
touches raw HTTP, routing, a read-write database connection or a file path. Its injected
toolbox is all it has: it reaches data only through the query port and, for create,
update and delete, a mutation port, and it draws records only through `present`, given
to every Action but delete (ADR-0005).

`input` holds the parsed values and the set of fields the form submitted. Parsing keeps
repeated values. Presence travels apart from value, so an update can tell a field left
alone from one cleared to null, false or an empty list. The router turns a list field's
posted values into one ordered array, following the spec's list input mode, so a Handler
never sees the mode. It also refuses an undeclared choice value and a string over its
`max_length` before generated code runs, so a Handler never validates either (ADR-0005).

The `__aluna_` prefix belongs to the platform, and no field name may use it. The router
accepts four reserved keys, `__aluna_present`, `__aluna_record_id`, `__aluna_drawn` and
`__aluna_link` (ADR-0011). It refuses any other key with the prefix and any missing,
duplicate or misplaced marker, then strips the namespace before generated code runs.

The router checks a picked record and a file reference (ADR-0009) before generated code
runs and again inside the save's transaction, so it refuses a save carrying a forged or
stale one. The record an update or delete acts on reaches a Handler bound into its
mutation port, never as a writable field. A linked field reaches a Handler as the text
it holds.

### Mutations are bound, and reads are free SQL

Create's mutation port is bound to the capability, and update's and delete's to the one
record the router validated, so no port takes a table, capability or record selector. A
write to another capability, or to a substituted record, cannot be expressed through the
ports. A port accepts only active fields and never a platform column, normalizes each
value by its type, checks required fields on the resulting record and merges an update.
A Handler carries its capability's behavior, and canonical state changes only through
its mutation port. The source check refuses a Handler that carries write SQL or builds
SQL at runtime.

Every Action may run any parameterized `SELECT`, joins included, through the query port,
on a connection SQLite opened read-only, so a write statement fails in SQLite itself. A
query reaches only the capability's own table and the read dependencies its Action
declares (ADR-0006). It declares an alias and a type for each result column and gets
exactly those back, so a `SELECT *` leaks no column a later evolution adds. A query for
records returns their ids, the platform reads the full rows on the same snapshot, and
the Handler receives opaque handles holding only the active values its Action may see.
`present` accepts only those handles, so a Handler cannot invent a card.

### The Gate isolates data access, not the process

The Gate runs generated code before any of it is published, against scratch SQLite in
memory. The candidate's table comes from the candidate's DDL, each declared read
dependency's from its full physical schema, and every table holds synthetic rows only.
The scratch database supplies the live interfaces, a read-write mutation port and a
read-only query port, so the practice toolbox has the shape of the real one. Because the
Gate never touches a real table, an evolution can rebuild a capability that already
holds the person's records.

The code still runs inside the server's process, with no process sandbox (ADR-0003). The
source check and the scratch adapters catch a model's mistakes and do not contain code
written to escape them.

## Considered options

**Handlers that return JSON for the platform to template.** The platform would need a
rendering engine that interprets each capability's results, which edges into the
business logic the platform does not hold.

**Direct platform imports in generated code.** Every generated file would depend on the
repository's layout, scoping would rest on trust with a table name passed as a string,
and the Gate could not substitute its practice toolbox.

**Handlers that return a raw `Response`.** No capability needs that power, and every
header or status decision is new surface for subtle generation bugs.

**A smoke run against the real table, with cleanup.** A crashed Gate leaves ghost
records, and during an evolution synthetic writes would interleave with the person's
records.

**A mocked toolbox with no database.** It proves that a Handler calls the right methods,
not that its SQL round-trips against the schema, which is what the smoke rung is for.

## Consequences

- The router does what generated code never does: it parses each request, binds the
  record target, builds the Action's context and wraps the returned fragment in the
  response.
- The source check and the structural rung assert the unit shape, and the smoke and
  behavioral rungs hand each Handler the scratch toolbox.
- The DDL derivation applies the same statements to the live database and to a scratch
  one (`src/runtime/data/schema/ddl.ts`).
- Generated code shares the server's process, so boot moves the model-provider and
  Recraft keys out of `process.env` before any generated code loads
  (`src/platform/secrets.ts`). That limits what an escape could read and does not
  prevent one.
- A capability that needs control of the response, such as a redirect or a download,
  extends this contract through a change to this record, never through power generated
  code takes on its own.
