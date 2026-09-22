// The Gate's four rungs, climbed in the order they execute.

const gateRoot = document.querySelector("[data-gate]");
if (gateRoot) {
  const flags = { tier: true, bug: false };
  /* Execution order, which is what the widget animates. `gate.ts` runs design lint
     third and splices its outcome back into the reported order afterwards. */
  const order = ["structural", "smoke", "design", "behavioral"];
  const rungs = new Map(
    order.map((name) => [name, gateRoot.querySelector(`[data-rung="${name}"]`)]),
  );
  const readout = gateRoot.querySelector("[data-gate-readout]");
  const slots = {
    title: readout?.querySelector('[data-slot="title"]'),
    body: readout?.querySelector('[data-slot="body"]'),
    rule: readout?.querySelector('[data-slot="rule"]'),
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let running = null;

  /** @param {string} title @param {string} body @param {string} [rule] */
  const say = (title, body, rule) => {
    if (slots.title) slots.title.textContent = title;
    if (slots.body) slots.body.textContent = body;
    if (slots.rule) slots.rule.textContent = rule ?? "";
  };

  /** @param {string} name @param {string | null} state @param {string} text */
  const setRung = (name, state, text) => {
    const rung = rungs.get(name);
    if (!rung) return;
    rung.classList.remove("is-skipped", "is-pass", "is-fail", "is-running");
    if (state) rung.classList.add(state);
    const pill = rung.querySelector("[data-rung-state]");
    if (pill) pill.textContent = text;
  };

  const active = () => order.filter((name) => name !== "behavioral" || flags.tier);

  const introduction = () => {
    const rung = flags.tier
      ? "The behavioral rung is switched on."
      : "The behavioral rung is switched off, so no tests are written and none run.";
    const bug =
      "the update handler keeps the capital letters you typed in tags, although the spec says tags are saved in lowercase";
    const again = flags.tier ? ", then run it again with the behavioral rung switched off" : "";
    const next = flags.bug
      ? `The bug is planted: ${bug}. Which rung will catch it? Run the Gate${again}.`
      : `The bug to plant sits in the update handler: it keeps the capital letters you typed in tags, although the spec says tags are saved in lowercase. Which rung will catch it? Plant it and run the Gate${again}.`;
    return `${rung} ${next}`;
  };

  const reset = () => {
    if (running) clearTimeout(running);
    running = null;
    for (const name of order) {
      const live = active().includes(name);
      setRung(name, live ? null : "is-skipped", live ? "Waiting" : "Switched off");
    }
    say(
      flags.tier ? "All four rungs will run." : "Three of the four rungs will run.",
      introduction(),
    );
  };

  const reportFailure = () =>
    say(
      "A behavioral test failed.",
      'One test comes from the spec\'s rule that tags are saved in lowercase: it sets a book\'s tags to "Science Fiction" and expects "science fiction". Each handler the failure traces to gets one repair, and the same tests run again. If the repaired update handler still keeps the capitals, the build fails and nothing is published.',
    );

  const reportPass = () => {
    const passed = flags.tier ? "Every rung passed" : "Every rung that ran passed";
    if (flags.bug) {
      say(
        `${passed}, and the bug goes live with the build.`,
        "Smoke's own sample tags are already lowercase, so an update handler that keeps capitals in tags passes it. The behavioral rung catches this kind of bug.",
      );
      return;
    }
    say(
      `${passed}. The version may be published.`,
      "Its files are written to their final place on disk next, and one transaction then makes it live.",
    );
  };

  const run = () => {
    if (running) clearTimeout(running);
    const queue = active();
    const failAt = flags.bug && flags.tier ? "behavioral" : null;
    for (const name of order) {
      const live = queue.includes(name);
      setRung(name, live ? null : "is-skipped", live ? "Waiting" : "Switched off");
    }

    /** @param {number} position */
    const step = (position) => {
      if (position >= queue.length) {
        reportPass();
        return;
      }
      const name = queue[position];
      if (!name) return;
      setRung(name, "is-running", "Running");
      running = setTimeout(() => {
        if (name !== failAt) {
          setRung(name, "is-pass", "Passed");
          step(position + 1);
          return;
        }
        setRung(name, "is-fail", "Failed");
        for (const later of queue.slice(position + 1)) {
          setRung(later, "is-skipped", "Never reached");
        }
        reportFailure();
      }, 700);
    };

    say("Running the rungs in order.", "Structural first.", "");
    step(0);
  };

  for (const toggle of gateRoot.querySelectorAll("[data-gate-toggle]")) {
    if (!(toggle instanceof HTMLElement)) continue;
    toggle.addEventListener("click", () => {
      const key = toggle.dataset.gateToggle === "bug" ? "bug" : "tier";
      flags[key] = !flags[key];
      toggle.setAttribute("aria-pressed", flags[key] ? "true" : "false");
      reset();
    });
  }
  gateRoot.querySelector("[data-gate-run]")?.addEventListener("click", run);
  gateRoot.querySelector("[data-gate-reset]")?.addEventListener("click", reset);
  reset();
}
