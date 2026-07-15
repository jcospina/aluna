export const DEFAULT_MUTATION_PREVIEW_HOLD_MS = 15_000;

export function renderMutationCoordinatorPreviewPage(holdMs: number): string {
  const holdSeconds = Math.round(holdMs / 1_000);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Aluna · mutation coordinator preview</title>
    <link rel="stylesheet" href="/static/app.css">
    <style>
      body {
        height: auto;
        min-height: 100dvh;
        margin: 0;
        padding: var(--space-4) var(--space-3) var(--space-6);
      }
      .coordinator-preview {
        width: min(100%, 54rem);
        margin-inline: auto;
      }
      .preview-kicker,
      .state-label {
        font: var(--meta);
        color: var(--color-text-muted);
      }
      .preview-kicker {
        margin: 0 0 var(--space-1);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      h1 {
        max-width: 18ch;
        margin: 0;
        font: var(--h1);
      }
      .preview-lede {
        max-width: 65ch;
        margin: var(--space-2) 0 var(--space-4);
        color: var(--color-text-muted);
      }
      .preview-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        padding-block: var(--space-3);
        border-block: var(--border-thin) solid var(--color-border);
      }
      .preview-actions button {
        min-height: 2.75rem;
        padding-inline: var(--space-3);
        font: var(--body-emph);
        color: var(--color-text-on-secondary);
        background: var(--color-accent-secondary);
        border: var(--border-thin) solid var(--color-text);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-sm);
        cursor: pointer;
        transition: transform var(--duration-fast) var(--ease-pop), box-shadow var(--duration-fast) var(--ease-pop);
      }
      .preview-actions button:hover:not(:disabled) {
        transform: translate(-1px, -1px);
        box-shadow: var(--shadow-md);
      }
      .preview-actions button:active:not(:disabled) {
        transform: translate(1px, 1px);
        box-shadow: var(--shadow-none);
      }
      .preview-actions button:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      .action-status {
        margin: 0;
        color: var(--color-text-muted);
      }
      .state-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 1.4fr);
        gap: var(--space-4);
        margin-block: var(--space-4);
      }
      .state-region {
        min-width: 0;
      }
      .state-label {
        display: block;
        margin-bottom: var(--space-1);
      }
      .active-lease {
        min-height: 8.5rem;
        padding: var(--space-3);
        background: color-mix(in oklch, var(--color-feature), transparent 48%);
        border: var(--border-regular) solid var(--color-text);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-sm);
      }
      .active-lease[data-empty="true"] {
        color: var(--color-text-subtle);
        background: var(--color-surface);
        border-style: dashed;
        box-shadow: none;
      }
      .lease-kind {
        display: block;
        margin-bottom: var(--space-1);
        font: var(--h2);
      }
      .lease-id,
      .queue-id {
        overflow-wrap: anywhere;
        font: var(--meta);
      }
      .queue-list {
        margin: 0;
        padding: 0;
        list-style: none;
        border-top: var(--border-thin) solid var(--color-border);
      }
      .queue-list li {
        display: grid;
        grid-template-columns: 2.5rem minmax(0, 1fr) auto;
        gap: var(--space-2);
        align-items: center;
        padding-block: var(--space-2);
        border-bottom: var(--border-thin) solid var(--color-border);
      }
      .queue-position {
        font: var(--h3);
        color: var(--color-accent);
      }
      .queue-kind {
        font: var(--body-emph);
      }
      .queue-list li.empty-queue {
        display: block;
        color: var(--color-text-subtle);
      }
      .test-note {
        max-width: 70ch;
        padding: var(--space-3);
        background: var(--color-surface);
        border: var(--border-thin) solid var(--color-border);
        border-radius: var(--radius-md);
      }
      .test-note h2 {
        margin: 0 0 var(--space-1);
        font: var(--h3);
      }
      .test-note p {
        margin: 0;
      }
      .test-note a {
        color: var(--color-accent-secondary);
        font-weight: var(--weight-bold);
      }
      @media (max-width: 42rem) {
        body { padding: var(--space-3) var(--space-2) var(--space-4); }
        .state-layout { grid-template-columns: 1fr; gap: var(--space-3); }
      }
      @media (prefers-reduced-motion: reduce) {
        .preview-actions button { transition: none; }
      }
    </style>
  </head>
  <body>
    <main class="coordinator-preview">
      <p class="preview-kicker">Developer preview · Module 4.2</p>
      <h1>One owner on the write path</h1>
      <p class="preview-lede">
        Hold a deliberately slow build lease, then watch admission change. Reads remain free;
        record writes receive a warm refusal until the lease releases.
      </p>

      <div class="preview-actions">
        <button id="hold-build" type="button">Hold build lease for ${holdSeconds} seconds</button>
        <p id="action-status" class="action-status" role="status" aria-live="polite">Ready.</p>
      </div>

      <div class="state-layout" aria-live="polite" aria-atomic="false">
        <section class="state-region" aria-labelledby="active-heading">
          <span id="active-heading" class="state-label">Active lease</span>
          <div id="active-lease" class="active-lease" data-empty="true">No active owner.</div>
        </section>
        <section class="state-region" aria-labelledby="queue-heading">
          <span id="queue-heading" class="state-label">FIFO queue</span>
          <ol id="queue-list" class="queue-list"><li class="empty-queue">No queued tickets.</li></ol>
        </section>
      </div>

      <section class="test-note">
        <h2>Second-tab check</h2>
        <p>
          First install the field-lifecycle demo. While the build lease is active, open
          <a href="/capability/field_lifecycle_demo" target="_blank" rel="noreferrer">Field lifecycle in a second tab</a>
          and submit a new entry. The form stays put and shows the warm retry message. Reloading
          or reading existing entries still works.
        </p>
      </section>
    </main>
    <script>
      const active = document.getElementById("active-lease");
      const queue = document.getElementById("queue-list");
      const button = document.getElementById("hold-build");
      const status = document.getElementById("action-status");

      function renderState(snapshot) {
        if (snapshot.activeLease) {
          active.dataset.empty = "false";
          active.innerHTML = "";
          const kind = document.createElement("strong");
          kind.className = "lease-kind";
          kind.textContent = snapshot.activeLease.kind + " lease";
          const id = document.createElement("span");
          id.className = "lease-id";
          id.textContent = snapshot.activeLease.leaseId;
          active.append(kind, id);
        } else {
          active.dataset.empty = "true";
          active.textContent = "No active owner.";
        }

        queue.innerHTML = "";
        if (snapshot.queuedTickets.length === 0) {
          const empty = document.createElement("li");
          empty.className = "empty-queue";
          empty.textContent = "No queued tickets.";
          queue.append(empty);
          return;
        }
        snapshot.queuedTickets.forEach((ticket, index) => {
          const item = document.createElement("li");
          const position = document.createElement("span");
          position.className = "queue-position";
          position.textContent = String(index + 1).padStart(2, "0");
          const identity = document.createElement("span");
          identity.className = "queue-id";
          identity.textContent = ticket.ticketId;
          const kind = document.createElement("span");
          kind.className = "queue-kind";
          kind.textContent = ticket.kind;
          item.append(position, identity, kind);
          queue.append(item);
        });
      }

      async function refresh() {
        try {
          const response = await fetch("/demo/mutation-coordinator/state", { cache: "no-store" });
          renderState(await response.json());
        } catch {
          status.textContent = "State refresh paused. Retrying.";
        }
      }

      button.addEventListener("click", async () => {
        button.disabled = true;
        status.textContent = "Build lease requested.";
        try {
          const response = await fetch("/demo/mutation-coordinator/slow-build", { method: "POST" });
          if (!response.ok) throw new Error("request failed");
          status.textContent = "Lease released. Record writes can continue.";
        } catch {
          status.textContent = "The preview stopped before the lease completed.";
        } finally {
          button.disabled = false;
          await refresh();
        }
      });

      void refresh();
      setInterval(refresh, 250);
    </script>
  </body>
</html>`;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
