// @ts-check
/**
 * The state picker every specimen on these pages switches with: a `.segmented` group whose
 * buttons each carry a `data-state`. Pressing one marks it pressed and hands its state to `show`,
 * which redraws the specimen. The pressed button at load, or else the first, is shown at once.
 *
 * @param {Element | null} group
 * @param {(state: string) => void} show
 */
export function wireStates(group, show) {
  if (!group) return;
  const buttons = [...group.querySelectorAll("button[data-state]")].filter(
    (button) => button instanceof HTMLButtonElement,
  );
  /** @param {HTMLButtonElement} pressed */
  const pick = (pressed) => {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button === pressed));
    show(pressed.dataset.state ?? "");
  };
  for (const button of buttons) button.addEventListener("click", () => pick(button));
  const first = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
  if (first ?? buttons[0]) pick(/** @type {HTMLButtonElement} */ (first ?? buttons[0]));
}

/**
 * A specimen host that a state picker redraws: each state names a function that builds what the
 * host shows, and picking one replaces the host's contents with it.
 *
 * @param {Element | null} group
 * @param {Element | null} host
 * @param {Record<string, () => Node | null>} states
 */
export function swapStates(group, host, states) {
  if (!host) return;
  wireStates(group, (state) => {
    const node = states[state]?.();
    host.replaceChildren(...(node ? [node] : []));
  });
}

/**
 * Every pick a drawn listbox picker takes, including the one it already holds. A
 * `listbox:change` only says the choice moved, and a picker has to redraw a state the specimen
 * has since left. Emptying the picker is not a pick.
 *
 * @param {Element | null} root the picker's `[data-listbox]`
 * @param {(value: string, label: string) => void} pick
 */
export function onEveryPick(root, pick) {
  if (!root) return;
  const input = root.querySelector('[role="combobox"]');
  /** @param {Element | null} option */
  const again = (option) => {
    if (option?.getAttribute("aria-selected") !== "true") return;
    const value = option.getAttribute("data-value") ?? "";
    queueMicrotask(() => pick(value, labelOf(option)));
  };
  root.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element) again(event.target.closest('[role="option"]'));
    },
    true,
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Enter" || event.isComposing) return;
      const active = input?.getAttribute("aria-activedescendant");
      again(active ? document.getElementById(active) : null);
    },
    true,
  );
  root.addEventListener("listbox:change", (event) => {
    const { value, label } = /** @type {CustomEvent<{ value: string | null, label: string }>} */ (
      event
    ).detail;
    if (value !== null) pick(value, label);
  });
}

/** An option's own words, without the note under it. @param {Element} option */
const labelOf = (option) =>
  [...option.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("")
    .trim();
