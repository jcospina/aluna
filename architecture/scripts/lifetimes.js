// Versions inside an incarnation, and one live pointer across them.

/** @typedef {{ versions: number, gone: boolean }} Lifetime */

const lifetimesRoot = document.querySelector("[data-lifetimes]");
if (lifetimesRoot) {
  const stage = lifetimesRoot.querySelector("[data-lifetimes-stage]");
  const readout = lifetimesRoot.querySelector("[data-lifetimes-readout]");
  const slots = {
    title: readout?.querySelector('[data-slot="title"]'),
    body: readout?.querySelector('[data-slot="body"]'),
    rule: readout?.querySelector('[data-slot="rule"]'),
  };
  let lifetimes = [{ versions: 1, gone: true }];

  /** @param {string} title @param {string} body @param {string} rule */
  const say = (title, body, rule) => {
    if (slots.title) slots.title.textContent = title;
    if (slots.body) slots.body.textContent = body;
    if (slots.rule) slots.rule.textContent = rule;
  };

  /** @param {number} version @param {Lifetime} life @param {boolean} isLive */
  const versionRow = (version, life, isLive) => {
    const row = document.createElement("div");
    row.className = isLive ? "version is-live" : "version";
    const name = document.createElement("span");
    name.textContent = `v${version}`;
    const state = document.createElement("span");
    state.className = "xs";
    state.textContent = life.gone ? "gone" : isLive ? "live" : "history";
    row.append(name, state);
    return row;
  };

  /** @param {Lifetime} life @param {number} index */
  const lifetimeBox = (life, index) => {
    const box = document.createElement("div");
    box.className = life.gone ? "lifetime is-gone" : "lifetime";

    const heading = document.createElement("p");
    heading.className = "caps";
    heading.textContent = `Incarnation ${index + 1}`;

    const sub = document.createElement("p");
    sub.className = "xs";
    sub.textContent = life.gone
      ? "Deleted: its table, versions and logo"
      : "A logo and a history of its own";
    box.append(heading, sub);

    for (let version = 1; version <= life.versions; version += 1) {
      box.append(versionRow(version, life, !life.gone && version === life.versions));
    }
    return box;
  };

  /** The lifetime everything acts on: always the last one, and always present. */
  const current = () => /** @type {Lifetime} */ (lifetimes[lifetimes.length - 1]);
  const rebuild = lifetimesRoot.querySelector("[data-lifetimes-rebuild]");

  const render = () => {
    if (!stage) return;
    stage.replaceChildren();
    for (const [index, life] of lifetimes.entries()) stage.append(lifetimeBox(life, index));
    if (rebuild) rebuild.textContent = current().gone ? "Build it again" : "Delete and build again";
  };

  const introduce = () =>
    say(
      "Films after the deletion.",
      "Incarnation 1 is gone. Build Films again to start a second incarnation at v1, then evolve it to add versions to that incarnation.",
      "",
    );

  render();
  introduce();

  lifetimesRoot.querySelector("[data-lifetimes-evolve]")?.addEventListener("click", () => {
    const life = current();
    if (life.gone) {
      say(
        "Build Films again first.",
        "A deleted incarnation gains no versions. Building Films again starts a new one.",
        "",
      );
      return;
    }
    life.versions += 1;
    render();
    say(
      `Version ${life.versions} is live, and every earlier version of this incarnation is still on disk.`,
      "Only a deletion removes them. The logo stays too, because a logo is drawn once per incarnation.",
      `capabilities/films/<incarnation ${lifetimes.length}>/v${life.versions}`,
    );
  });

  rebuild?.addEventListener("click", () => {
    if (lifetimes.length > 2) {
      say(
        "Each rebuild would add one more incarnation.",
        "The earlier ones cannot come back. Reset to start over.",
        "",
      );
      return;
    }
    const wasLive = !current().gone;
    current().gone = true;
    lifetimes.push({ versions: 1, gone: false });
    render();
    say(
      "Same id, a new incarnation.",
      `${wasLive ? "Deleting removed its table, every version and the logo. " : ""}The model writes the id films again, so the address and table name come back. Everything else starts over: a new incarnation at v1, with a new logo.`,
      `capabilities/films/<incarnation ${lifetimes.length}>/v1`,
    );
  });

  lifetimesRoot.querySelector("[data-lifetimes-reset]")?.addEventListener("click", () => {
    lifetimes = [{ versions: 1, gone: true }];
    render();
    introduce();
  });
}
