// One choice, one explanation. Used where the options are alternatives rather than steps. A
// picker marked `data-picker-start="none"` waits for the reader to choose, so a guess comes first.

const PICKERS = {
  intent: [
    {
      title: "A new capability.",
      body: "Nothing on the desk holds board games, and the resolver classifies the sentence as new_capability. The builder runs every step of the first build again, and a third tile joins Books and Films.",
      rule: "new_capability",
    },
    {
      title: "An evolution of Films.",
      body: "The sentence names Films, which exists, and the resolver targets it although Books is the capability open in the window. The builder asks the model for a complete candidate spec for Films and works out what changed.",
      rule: "extend_capability · target: films",
    },
    {
      title: "A change to how Books looks.",
      body: "Only the layout changes, from a feed to a grid. A ui_change allows that. The builder runs the same steps as for any evolution, and the item renderer is written again for the grid.",
      rule: "ui_change · target: books",
    },
    {
      title: "No build runs for a question.",
      body: "The request leaves the build path for a read-only loop, and the answer arrives in a separate answer window.",
      rule: "data_query",
    },
    {
      title: "An overlap, settled by the model.",
      body: `Books already exists, and the sentence asks for a separate place. The model gives the books you want to read a separate capability, with a table, a tile and a name that tells the two apart on the desk. This resolution is called "namespace".`,
      rule: "new_capability · resolution: namespace",
    },
    {
      title: "An evolution of Books that reads Films.",
      body: "The change is to Books, which now declares that one of its Actions reads Films. That Action's SQL joins the two tables when it runs.",
      rule: "extend_capability · target: books",
    },
    {
      title: "A request classified as reject.",
      body: `The request names a pixel offset, and the resolver classifies it as reject. The prompt bar answers with one fixed line: "I'm not quite sure what to make from that yet. Try telling me one thing you'd like to keep track of."`,
      rule: "reject",
    },
    {
      title: "Answered before the resolver is called.",
      body: `Once filler words such as "track" and "my" are dropped, the sentence's words match the name Films exactly. The platform answers this duplicate without calling the resolver: "You already have Films, so I didn't create another one." Nothing is built. The platform writes the sentence's metrics row itself, with extend_capability for Films as its classification.`,
      rule: "extend_capability · target: films",
    },
  ],

  ending: [
    {
      title: "The new version is live.",
      body: "The collection replaces the narration in the window. For a new capability, its tile replaces the provisional one on the desk.",
      rule: "success · activated",
    },
    {
      title: "Nothing to publish.",
      body: `An evolution whose candidate meant exactly what was committed. No version is made, the model call is still measured and Aluna says "That's already exactly how this works — nothing to change."`,
      rule: "success · no_change",
    },
    {
      title: "The catalog changed while the build waited.",
      body: "Caught at the front of the queue, before the build makes any model call of its own.",
      rule: "failed · stale",
    },
    {
      title: "A stage failed the build.",
      body: `The metrics row names which of six failure outcomes it was, such as gate_failed or activation_failed. Whatever was live goes on serving. Most failures end with "Hmm, that didn't work. Mind trying again?" Three failures get lines of their own: a candidate spec the platform refused (one that drops a field, say), a spec whose id is already taken and a spec whose id a deletion still holds.`,
      rule: "failed",
    },
    {
      title: "Stopped before the commit.",
      body: `You cancelled, and the earlier screen comes back without waiting for Continue. A disconnect ends here too, with nobody watching. A build whose lease expired is marked cancelled in its metrics row as well, even while you are still watching. A first build then gives the earlier screen back; an evolution stopped during a model call shows "Hmm, that didn't work. Mind trying again?" instead.`,
      rule: "failed · cancelled",
    },
    {
      title: "The process died mid-build.",
      body: "At the next start-up, before the server serves anything, every build still marked running is marked interrupted. Leftover files are removed only where the metrics rows prove they never went live. You are not told.",
      rule: "interrupted",
    },
  ],
};

for (const [name, entries] of Object.entries(PICKERS)) {
  const group = document.querySelector(`[data-picker="${name}"]`);
  const readout = document.querySelector(`[data-picker-readout="${name}"]`);
  if (!group || !readout) continue;
  const buttons = [...group.querySelectorAll("[data-pick]")];
  const slots = {
    title: readout.querySelector('[data-slot="title"]'),
    body: readout.querySelector('[data-slot="body"]'),
    rule: readout.querySelector('[data-slot="rule"]'),
  };
  /** @param {number} index */
  const choose = (index) => {
    for (const [position, button] of buttons.entries()) {
      button.setAttribute("aria-current", position === index ? "true" : "false");
    }
    const entry = entries[index];
    if (!entry) return;
    if (slots.title) slots.title.textContent = entry.title;
    if (slots.body) slots.body.textContent = entry.body;
    if (slots.rule) slots.rule.textContent = entry.rule;
  };
  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => choose(index));
  }
  if (group.getAttribute("data-picker-start") !== "none") choose(0);
}
