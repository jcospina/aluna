// A stepped diagram: stages light up in turn and a readout explains the beat. Four benches
// share it — the first build, the write queue, the question loop and a deletion.

/**
 * @typedef {{ title: string, body: string, rule?: string, on?: number[],
 *             done?: number[], refuse?: number[], text?: Record<number, [string, string]> }} Beat
 */

/** @type {Record<string, readonly Beat[]>} */
const SEQUENCES = {
  trip: [
    {
      title: "The prompt bar sends your sentence.",
      body: "You press Make it, and the sentence goes to the server. Nothing else goes with it, because no capability is open in the window.",
      rule: "POST /prompt",
    },
    {
      title: "The intent resolver reads the catalog.",
      body: "The intent resolver is one model call that works out what a sentence asks for. Its prompt holds your sentence and the catalog, the list of capabilities on the desk. On an empty desk the catalog says only that there are none.",
      rule: "- none",
    },
    {
      title: "It classifies the sentence as a new capability.",
      body: `With nothing on the desk, the resolver classifies the sentence as new_capability. The classification carries a line in Aluna's voice, such as "I'll make a place for the books you read", and that line will open her narration once the build starts. A provisional tile appears on the desk. It gets a name once the spec is written.`,
      rule: "type: new_capability",
    },
    {
      title: "The model writes the spec.",
      body: "The builder, the platform code that drives a build step by step, asks the model for Books' spec: a structured description of what Books holds and how it behaves. The platform checks the spec and derives Books' table, cap_books, from it.",
      rule: "id: books",
    },
    {
      title: "Tests first, then six units of code.",
      body: "With the behavioral tests switched on, as they are by default, the model writes tests from the spec before any code exists. Next it writes six units, one file each: the item renderer, which draws one book's card, and a handler for each of the five Actions (create, read, update, delete and search).",
      rule: "item.ts · create.ts · read.ts · update.ts · delete.ts · search.ts",
    },
    {
      title: "The Gate runs four kinds of check.",
      body: `As it starts, Aluna says "I'm checking the first version now." The Gate type-checks the six units, runs them against a throwaway database, renders the card and runs the tests. Nothing is published until every check that runs has passed.`,
      rule: "structural · smoke · design-lint · behavioral",
    },
    {
      title: "One transaction makes Books live.",
      body: "Books' spec, units and tests are written to disk as version 1. Then one database transaction creates cap_books and makes Books live.",
      rule: "v1",
    },
    {
      title: "The window opens on the empty collection.",
      body: 'The server\'s commit event carries the Books collection to the window: a search box, a button for adding a book and the line "Nothing here yet — add your first book above." The collection replaces the narration.',
      rule: "event: commit",
    },
  ],

  queue: [
    {
      title: "The laptop's build takes the lease.",
      body: "Both builds were classified against Books v2. The laptop's build reaches the queue first, finds nothing ahead of it and takes the lease at once. The phone's, classified a moment later, waits behind it and does no work of its own: no further model call, no files. Reads sit apart on the right: they use a separate read-only SQLite connection and never wait for the lease.",
      on: [3],
      done: [0, 4],
    },
    {
      title: "It checks again before it starts.",
      body: "Before any model work, the build checks that Books still exists as the same capability at v2, and that the catalog fingerprint has not moved. The fingerprint is a hash of the catalog the classification was made against. Everything still matches: the build starts and opens its metrics row.",
      on: [3],
      done: [0, 4],
      text: {
        0: ["Build — rating", "Left the queue"],
        3: ["Build — rating", "Rechecked, running"],
      },
    },
    {
      title: "You press Save on the phone.",
      body: "The phone's window keeps showing Books until its build gets the lease and Aluna starts narrating there. You use that time to give The Left Hand of Darkness a finished date, and press Save.",
      on: [3, 2],
      done: [0, 4],
      text: {
        0: ["Build — rating", "Left the queue"],
        3: ["Build — rating", "Rechecked, running"],
      },
    },
    {
      title: "The save is refused.",
      body: `A save needs the lease for one short transaction, and the laptop's build holds it. The phone shows "I'm still putting something together. Give me a moment, then try that again." Nothing was written, and the finished date is still empty.`,
      on: [3],
      refuse: [2],
      done: [0, 4],
      text: {
        0: ["Build — rating", "Left the queue"],
        3: ["Build — rating", "Rechecked, running"],
      },
    },
    {
      title: "The laptop's build ends.",
      body: "It makes Books v3, with an optional rating field, and the laptop's window shows the new collection.",
      on: [3],
      done: [0, 4],
      text: {
        0: ["Build — rating", "Left the queue"],
        3: ["Build — rating", "Made Books v3"],
      },
    },
    {
      title: "The lease passes straight to the next build.",
      body: "However a build ends, it lets go of the lease. The lease goes straight to the phone's build, and no save can slip in between. That build was classified against v2, and Books is now v3. Will it run?",
      on: [3],
      done: [0, 1, 4],
      text: {
        0: ["Build — rating", "Finished"],
        1: ["Build — page count", "Left the queue"],
        3: ["Build — page count", "Phone"],
      },
    },
    {
      title: "The phone's build is stale.",
      body: "Its recheck finds Books at v3, and the build is refused before any model work. One metrics row is written with the outcome stale, no file is touched and the lease is let go. On the phone, Aluna says that something on your desk changed after you asked, and that you can ask her again if you still want it.",
      refuse: [3],
      done: [0, 1, 4],
      text: {
        0: ["Build — rating", "Finished"],
        1: ["Build — page count", "Left the queue"],
        3: ["Build — page count", "Rechecked: stale"],
      },
    },
  ],

  question: [
    {
      title: "No build runs for a question.",
      body: "No spec, generated code or version is made. A loop of at most ten read-only steps works out the answer.",
      rule: "data_query",
    },
    {
      title: "The model starts from where the answer lives.",
      body: "The loop's prompt lists every capability's table, with its active fields and choice options. The model starts from Books without looking anything up, and a query that reads the schema is refused.",
    },
    {
      title: "Its first step reads how the author is written.",
      body: `A naming step reads the distinct values the author field holds and finds all three spellings. Only after reading them can the model know that "Le Guin" would miss one, or that a wildcard such as %Guin% happens to catch all three. The final query names each spelling.`,
      rule: "naming",
    },
    {
      title: "SQL does the counting.",
      body: "The final query counts the books whose author is written any of those three ways and whose finished date falls in this year. The Left Hand of Darkness is one of them: its finished date is in March. The model chose both steps, and another question would take others.",
      rule: "counting",
    },
    {
      title: "Aluna answers in words.",
      body: 'A separate model call writes her answer from what the steps returned: "You finished two Le Guin books this year." Nothing is cached, and the same question asked tomorrow runs the whole loop again.',
    },
  ],

  deletion: [
    {
      title: "It starts at the tile, with a confirmation.",
      body: "Delete sits in the Films tile's menu and nowhere on the window. The confirmation fills the window and says what will happen: every record goes, and it cannot be undone. No model is called anywhere on this path.",
    },
    {
      title: "A deletion needs a free lease and an empty queue.",
      body: "If anything holds the lease or waits in the queue, the deletion is refused at once; the window says why and waits for Continue. A deletion that joined the queue could run long after you confirmed it.",
    },
    {
      title: "A capability that reads Films would block the deletion.",
      body: "Declared reads are kept in the registry, and the deletion looks for dependants there. Had you typed \"mark each book I've also watched as a film\", Books' SQL would join cap_films, and dropping the table would break Books. Nothing reads Films, and the deletion goes on.",
    },
    {
      title: "Reads stop, and the ones running get fifteen seconds.",
      body: "New reads of Films are refused, and so is every question, because a question can read every capability. Reads already running, questions included, are told to stop and get up to fifteen seconds to let go. The table is dropped once all of them have let go.",
    },
    {
      title: "One transaction drops the table and leaves a tombstone.",
      body: "The registry row becomes a tombstone: no route reaches it, and it still reserves the id films. cap_films is dropped, with any records in it. After this commit, the deletion cannot be undone.",
    },
    {
      title: "The files are removed after the commit.",
      body: "Files cannot join a database transaction: the version directories and the logo are removed after the commit. The clean-up runs straight away, and the tile leaves the desk as soon as the server answers the confirmation. A clean-up that fails is retried until it finishes.",
    },
    {
      title: "The tombstone goes, and the id is free.",
      body: "Once the clean-up finishes, the tombstone is removed and the id films can be used again. Until then, a new Films build stops as soon as its spec names the id films.",
    },
  ],
};

class Sequence {
  /** @param {Element} root @param {readonly Beat[]} beats */
  constructor(root, beats) {
    this.root = root;
    this.beats = beats;
    this.index = 0;
    // By the number it carries, not by where it sits: a beat names a stage by index, so a
    // relayout that reorders the markup would otherwise silently repaint the wrong node.
    this.stages = [...root.querySelectorAll("[data-stage]")].sort(
      (a, b) => Number(a.getAttribute("data-stage")) - Number(b.getAttribute("data-stage")),
    );
    this.original = this.stages.map((stage) => [
      stage.querySelector(".node__name")?.textContent ?? "",
      stage.querySelector(".node__sub")?.textContent ?? "",
    ]);
    this.slots = {
      title: root.querySelector('[data-slot="title"]'),
      body: root.querySelector('[data-slot="body"]'),
      rule: root.querySelector('[data-slot="rule"]'),
    };
    this.count = root.querySelector("[data-seq-count]");
    const total = root.querySelector("[data-seq-total]");
    if (total) total.textContent = String(beats.length);
    root.querySelector("[data-seq-step]")?.addEventListener("click", () => this.advance());
    root.querySelector("[data-seq-reset]")?.addEventListener("click", () => this.show(0));
    for (const [index, stage] of this.stages.entries()) {
      if (stage.tagName !== "BUTTON") continue;
      stage.addEventListener("click", () => this.show(index));
    }
    this.show(0);
  }

  /* A beat that names no stages walks its rail in order; one that names them owns them. */
  /** @param {Beat} beat @param {number} position @param {boolean} linear */
  stageState(beat, position, linear) {
    if (linear) {
      if (position < this.index) return "is-done";
      return position === this.index ? "" : "is-idle";
    }
    if (beat.refuse?.includes(position)) return "node--refuse";
    if (beat.on?.includes(position)) return "is-on";
    return beat.done?.includes(position) ? "is-done" : "is-idle";
  }

  /** @param {Element} stage @param {Beat} beat @param {number} position @param {boolean} linear */
  paintStage(stage, beat, position, linear) {
    const [name = "", sub = ""] = beat.text?.[position] ?? this.original[position] ?? [];
    const nameNode = stage.querySelector(".node__name");
    const subNode = stage.querySelector(".node__sub");
    if (nameNode) nameNode.textContent = name;
    if (subNode) subNode.textContent = sub;

    const state = this.stageState(beat, position, linear);
    stage.classList.remove("is-idle", "is-done", "is-on", "node--refuse");
    if (state) stage.classList.add(state);
    if (stage.tagName === "BUTTON") {
      stage.setAttribute("aria-current", linear && position === this.index ? "true" : "false");
    }
  }

  /** @param {number} index */
  show(index) {
    this.index = index;
    const beat = this.beats[index];
    if (!beat) return;
    const linear = !beat.on && !beat.done && !beat.refuse;
    for (const [position, stage] of this.stages.entries()) {
      this.paintStage(stage, beat, position, linear);
    }
    if (this.slots.title) this.slots.title.textContent = beat.title;
    if (this.slots.body) this.slots.body.textContent = beat.body;
    if (this.slots.rule) this.slots.rule.textContent = beat.rule ?? "";
    if (this.count) this.count.textContent = String(index + 1);
  }

  advance() {
    this.show((this.index + 1) % this.beats.length);
  }
}

for (const [name, beats] of Object.entries(SEQUENCES)) {
  const root = document.querySelector(`[data-seq="${name}"]`);
  if (!root) {
    console.warn(`No bench found for the ${name} sequence.`);
    continue;
  }
  new Sequence(root, beats);
}
