# 0002 — SSE transport conventions

Status: Accepted

## Context

A sentence typed at the prompt bar can take minutes to become a capability, and the
person watches it happen in the window. While the run works, the server has to tell
the browser what it is doing; when it finishes, the server has to deliver the
finished View in one piece and say how the run ended. Once the sentence is posted,
everything flows from server to browser, and the browser's only other word to the
run is a cancel.

The server renders HTML fragments and htmx drives the browser, so everything the
stream puts in front of the person is HTML, apart from the facts the narration draws
([How it works](../architecture.md#4-how-it-works)). Some stages stay silent for
longer than the server's idle timeout while a model writes a large unit or the Gate
runs. The window a run lands in is created and destroyed by the client, so the
server cannot know whether it is open. And activation becomes durable on the server
before the browser hears about it.

## Decision

Server-to-browser streaming uses server-sent events, one stream per run, with named
events that htmx swaps into named regions.

### One stream per run

`POST /prompt` creates a job in memory and makes no model call, so the prompt bar
answers at once and the wait for the Intent Resolver happens on the stream. It answers
with the run's subscriber (`renderBuildSubscriber`), which the prompt bar appends to
the window's content region and whose `sse-connect` opens `GET /build/:id/stream`. The
job runs while that stream is open: intent resolution first, then whatever the
Resolver chose, whether a build, an evolution, a linking-only request, a question
(ADR-0008), a deflection or a refusal. The server closes the stream after `done`, and
no channel outlives its run. The run's Cancel control posts to `/build/:id/cancel`.

A stream that drops mid-run cancels its run, because the server reads the closed
connection as cancellation and aborts the job. The job queue deletes a job when its
run ends, so a reconnect hears a lone `done`, carrying `error` while the job winds
down and `missing` once it is gone. No request ever runs a job twice.

### Transport

Every application event carries a named `event:` field and an `id` that counts up
from 0 within its stream, and the transport serializes writes so the ids arrive in
order (`src/server/sse/transport.ts`). The client tells one kind of message from
another by its name alone.

The stream sends an id-less `heartbeat` at an interval below the server's idle
timeout, so a silent stage keeps its connection. The heartbeat is transport and
stands outside the event vocabulary. Clients ignore it, and because it carries no id
it leaves application ordering alone.

The response is `cache-control: no-store`, because the stream may carry the person's
own question (ADR-0008).

### The event vocabulary

Five event names make up the vocabulary.

| Event | Carries | Client wire |
|---|---|---|
| `progress` | One fact about the run as JSON, with no copy: the planned stages, a stage starting, a part being made or checked, a Gate check, and the names the plan settled on (`ProgressFact`). | `sse-swap="narration,progress"` on the narration region. The window cancels the swap and hands the fact to the design system's narrator. |
| `narration` | The line a run ends on when no View replaces it, as markup: the authored sentence and an out-of-band swap that turns the run's Cancel control into Continue. An activation whose View cannot be shown ends on a plain line asking for a refresh. | The same narration region, `hx-swap="beforeend"`. |
| `fragment` | HTML that is not the success swap: an out-of-band sidecar for the desk (the provisional logo, a sentence for `#prompt-notice`), a marked frame the desk reads and drops (the window's title, what the answer window says), or the restoration a run gives back when it activates nothing. | `sse-swap="fragment"`, `hx-swap="beforeend"` on the fragment region. |
| `commit` | The terminal success swap: the activated capability's complete View, with its logo as an out-of-band sidecar. | `sse-swap="commit"`, `hx-swap="innerHTML"` on the commit region. The shell moves the View into the window when the stream closes. |
| `done` | The terminal lifecycle signal. The server closes the stream after it. | `sse-close="done"` on the subscriber. |

`done` carries `ok`, `error` or `missing` as data, which the tests read. The browser
reads how a run ended from what arrived before it.

A failure has no event of its own. A build or an evolution that fails, is refused as
stale, has its candidate refused or changes nothing speaks over `narration`, gives
back over `fragment` and closes with `done`, and the window holds that ending until
the person presses Continue. A cancelled run gives back over `fragment` at once. A
deflection, a refusal and a linking-only request say their sentence on the prompt bar
or in an answer window, over `fragment`, and hold nothing. A question ends with the
answer window's last sentence over `fragment` and `done`, and a cancelled question
sends only `done` (ADR-0008). A pipeline that throws without presenting an ending of
its own sends the generic failure line over `narration` and `done`, and Continue then
uncovers whatever the run covered.

The stream also carries the developer panel's preview events, each named for the
panel stage it fills and carrying raw JSON (`PREVIEW_STAGES` in
`src/server/http/fragments/fragments.ts`). They stand outside the vocabulary: hidden
listeners hand them to the panel, nothing else reads them, and the swap-target guard
ignores them.

### The htmx SSE extension

The browser consumes the stream through the htmx SSE extension, vendored beside
htmx. Each named event swaps into its listener region, and htmx applies the
out-of-band sidecars in the same message to the desk.

`sse-close` is required for clean termination. The extension wraps a native
`EventSource`, which reconnects with backoff whenever the server closes the stream.
Without `sse-close`, the browser reconnects to every finished stream, and each
reconnect gets a lone `done` carrying `missing`. `sse-close="done"` makes the
extension close its source when `done` arrives, and `renderBuildSubscriber` sets it
on every subscriber.

The client reads the end of a run from `htmx:sseClose`. Its type is `message` for a
stream the server finished, and `nodeReplaced` or `nodeMissing` for one whose
subscriber left the document. Either of the last two closes the connection, which the
server reads as cancellation. `htmx:sseError` fires on every transient drop while the
extension retries, and only a source the browser has given up on wakes the prompt
bar.

### A run reports facts and the window narrates them

The stages send what happened as `progress` facts, and the window draws them (**Build
narration** in [CONTEXT.md](../../CONTEXT.md)). The design system's narration owns
every word said about a fact (`design/scripts/narration/voice.js`). A fact carries no
sentence except the model's opening one, and no other text except the names the plan
settled on. The narrator sets them as text, and the JSON escapes `<` and `&`, so a
fact htmx swapped in as markup with no narrator to take it still reads as text.

`narration` keeps one job, the ending. The narrator moves the ending's line into the
band's place and stops where it stood.

When no window stands, the one a sentence opens stays out of sight until the run's
first fact, its ending or its `commit` arrives, so a deflection never flashes one. On
`commit` the window holds the finished drawing and its last line for about a second
and a half, the committed View waiting under it, before the shell places the View.
The hold is presentation after the point of no return.

No Gate check depends on a fact. The Gate's observer reports a check or a repair as
it starts, and the observer and the house-rules writer drop a fact whose write fails
instead of raising it, so a reader who left cannot fail the Gate it was watching.

### Transport delivery is not activation

The registry pointer and the `success/activated` metrics row commit in SQLite before
the presenter emits `commit`, and that commit is the point of no return. A
disconnect, a render failure, a timeout or a lost `done` afterwards cannot roll the
build back or relabel it. Terminal presentation runs under the build lease, so it is
bounded (`src/pipeline/streaming/terminal-presentation.ts`). A presenter past the
bound writes nothing more, and the lease is released however presentation ends. When
the activated View cannot be delivered, the run ends with a line asking the person to
refresh, and the reload draws the desk from the registry, new logo included.

### The swap target outlives the window

The server addresses every swap unconditionally and never asks whether its target is
there. A run's `commit` and `fragment` land in listener regions inside the
subscriber, which the prompt bar appended to the window's content region
(`#spec-build-output`). Their sidecars name stable ids on the desk: the logo layer
(`#capability-logos`), each logo (`#capability-logo-<id>`) and the prompt bar's
notice slot (`#prompt-notice`). The client creates and destroys the window, and it
guarantees the target exists whenever a swap can be in flight.

Two rules keep that promise. The first is that release follows content: the release
scope frees whatever a content region's content started, such as in-flight fetches,
search controllers and server read tokens, when that content is replaced or removed.
A swap inside the window, from list to record and back, therefore releases exactly
what putting the window away does. The second is that a run cannot lose its window
mid-flight. While a run is using the window, putting it away, pressing another logo,
or going Back or Forward asks first (`public/desk/leaving-a-run.js`), and a confirmed
leave cancels through the run's own cancel route, so the run ends the way the
vocabulary describes. A second sentence, or a desk action that would take the window,
is turned down on the prompt bar.

A target that cannot be found is never absorbed. htmx's extension drops a message
whose listener has left the document and says nothing, so `public/core/swap-target.js`
raises when a `commit` or `fragment` arrives with no listener or with a target that
has gone. Page assembly throws when either of its two literal anchors is missing from
the shell: the logo layer and the prompt bar's notice slot. The shell holds no anchor
for the window, because the client makes it.

### Logos on the desk

`commit` carries the capability's logo out of band. A new capability's logo is
appended to `#capability-logos`, which arms its first logo attempt. An evolution's
`commit` replaces the logo in place, inert, so it arms no attempt (ADR-0007).

Before activation, an admitted new capability puts a provisional tile on the desk,
keyed by build id. The tile rides `fragment` carrying nothing but its out-of-band
sidecar, so the fragment region receives nothing, and a second `fragment` writes its
name once the spec authors one. The tile is presentation state, not a registry entry,
and a reload forgets it. The client takes it down on every `htmx:sseClose`, whatever
its type, and on a success `commit` has already put the registry's logo on the desk.
Evolutions and Resolver outcomes that admit no new capability put no tile on the
desk, and no restoration carries a logo sidecar.

### Restoration on the wire

A run that activates nothing gives back what it displaced over `fragment`: the
canonical collection of the capability that stood in the window, resolved against the
registry as the terminal runs, or the bare desk (ADR-0006). Cancellation places it at
once. A run that holds an ending sends the ending first, so when the restoration
follows, the client parks it in an inert `<template>` inside the subscriber and places
it when the person presses Continue. A parked collection reads no records into a
subscriber nobody can see. It reads its records when it lands, so only the surface
around them is as old as the ending.

A parked restoration is never placed after another build or a deletion on this desk
has changed the registry, because each takes the run's window first. A new sentence
from the prompt bar drops the held run, ending and all. Any other teardown, such as a
deletion's question taking the window or the window put away, carries the line to
`#prompt-notice` on its way out, because the window is the only place an ending lives.

The prompt bar's notice slot carries whatever is said outside the window, including
an ending carried out of a window that went. A held build ending stays out of it while
the window stands, because the narration is already the live region and where the
person is looking.

### Deletion answers where it was asked

Capability deletion does not use the build stream. Its question and its answers are
htmx requests into the window's content region, and they follow a run's rule: the
answer lands where the question was asked and holds there until it is dismissed. The
question stands over the window, with the capability's own collection dimmed and
inert under the veil, and an ending replaces it in the same panel (ADR-0006). A held
deletion ending carries only evidence, so it sends no `HX-Replace-Url`, and Continue
takes the route **Keep it** takes. A committed or already-gone deletion answers on
`#prompt-notice` and sends the address at once. A window torn down over an unread
deletion ending carries its sentence to `#prompt-notice`, as a build ending does.

## Considered options

**A WebSocket.** It would give the run a channel back that it does not use. The
browser's only word to a running job is a cancel, an ordinary POST, and server-sent
events ride plain HTTP that the htmx extension already reads.

**One undifferentiated stream.** The client would have to parse every payload to tell
narration from HTML from lifecycle signals. Named events let each kind land in its own
region by name.

**A raw `EventSource` with hand-written DOM writes.** It would put every placement in
client code. The htmx extension swaps each event into its region and applies the
desk's out-of-band sidecars declaratively, which leaves the shell to place only the
View, the restoration and the narration by hand.

**A persistent shell channel.** It is what server-initiated push needs, and Aluna
pushes nothing unprompted, so every stream belongs to one run and closes with it.

**Patching the window unit by unit as a build lands.** It would show parts the Gate
may still reject. One complete `commit` swap shows only what activated, and every
other outcome gives back the canonical committed View over `fragment`.

**A dedicated failure event.** It would add a name for an outcome that already fits
the ending's shape: a line over `narration`, a restoration over `fragment`, and
`done`.

**Server-written narration sentences.** They cannot drive a drawing, which needs
facts, and they would split the voice between the pipeline and the window. The server
sends facts and the design system's narration owns the words.

**A teardown hook scoped to the window.** It would leak on every swap inside it,
because a list-to-record swap leaves the window standing. Release tied to content
covers both.

## Consequences

- A dropped stream cancels its run, and no reconnect re-runs a build: a reconnect
  hears `done` carrying `error` or `missing`. With `sse-close` in place a finished
  stream does not reconnect at all.
- New kinds of message ride `fragment` as a sidecar or a marked frame, as the
  provisional logo, the window's title and the answer window do. A sixth event name
  is a change to this ADR.
- The server stays blind to the window and the client owes every target. A client
  change that lets a target go while a swap can be in flight shows up as a raised
  error, never as a build that silently showed nothing.
- What the window shows is never ahead of the registry. A lost `commit` leaves an
  activated capability that the next page load shows.
- A held ending never holds the desk. A new prompt is admitted over it and drops it,
  and desk actions are not refused while one stands.
- Nothing reaches the browser over SSE unless a person sent a sentence, so anything
  that speaks unprompted needs a channel of its own.
