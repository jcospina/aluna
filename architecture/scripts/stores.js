// What a confirmed deletion does to each store, and which two survive it.

const storesRoot = document.querySelector("[data-stores]");
if (storesRoot) {
  /** @type {Record<string, { normal: string, deleted: string }>} */
  const copy = {
    registry: {
      normal:
        "One row per capability: its spec, which version is live, the incarnation and seed the platform assigned and any display name a rename wrote. The resolver reads a summary of every row each time it classifies a sentence.",
      deleted:
        "The row becomes a tombstone in the deleting transaction. No route reaches it, and it reserves the id until the file clean-up finishes.",
    },
    tables: {
      normal:
        "Your records, one isolated table per capability, with no foreign keys between tables.",
      deleted: "Dropped, with any records in it.",
    },
    snapshots: {
      normal:
        "On disk, outside the database: one immutable directory per version, with the logo beside the versions.",
      deleted:
        "Every version directory of that incarnation goes, and the logo with it, after the commit. The removal is retried until it finishes.",
    },
    metrics: {
      normal:
        "One row per build that reaches the front of the queue: how long each stage took, which model ran, how many tokens it used, the resolution, the outcome and, for a failed build, the stage it stopped at and its message.",
      deleted: "Kept, identifiers included. A failure message can quote the spec.",
    },
    questions: {
      normal:
        "One row per question, rejected request or sentence caught as a duplicate: the outcome and the classification, plus the resolver's model, time and tokens. A duplicate never reaches the resolver, so the platform writes extend_capability as its classification, with a time of zero and no tokens. A question's row also counts the loop's steps and how long you waited.",
      deleted: "Kept. A row can name the capability a request was about.",
    },
  };

  /** @param {HTMLElement} card @param {"normal" | "deleted"} view */
  const paintCard = (card, view) => {
    const body = card.querySelector('[data-slot="body"]');
    if (body) body.textContent = copy[card.dataset.store ?? ""]?.[view] ?? "";
    /* The two metrics tables outlive a deletion so the experiment keeps its measurements. */
    const survives = card.dataset.store === "metrics" || card.dataset.store === "questions";
    card.classList.toggle("note--sky", view === "deleted" && survives);
    card.classList.toggle("note--clay", view === "deleted" && !survives);
  };

  /** @param {"normal" | "deleted"} view */
  const apply = (view) => {
    const cards = /** @type {NodeListOf<HTMLElement>} */ (
      storesRoot.querySelectorAll("[data-store]")
    );
    for (const card of cards) paintCard(card, view);

    const buttons = /** @type {NodeListOf<HTMLElement>} */ (
      storesRoot.querySelectorAll("[data-stores-view]")
    );
    for (const button of buttons) {
      button.setAttribute("aria-pressed", button.dataset.storesView === view ? "true" : "false");
    }
  };

  for (const button of storesRoot.querySelectorAll("[data-stores-view]")) {
    if (!(button instanceof HTMLElement)) continue;
    button.addEventListener("click", () =>
      apply(button.dataset.storesView === "deleted" ? "deleted" : "normal"),
    );
  }
  apply("normal");
}
