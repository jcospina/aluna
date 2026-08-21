// @ts-check
/**
 * The prompt bar.
 *
 * The only thing on screen that belongs to Aluna rather than to a capability.
 * It floats clear of all four edges with ground visible beneath and beside it,
 * and it is never a full-width bottom bar — a bar welded to the bottom edge
 * *is* a taskbar, which D4 removed.
 *
 * It takes the same line treatment as a window, in the same full hand, and it is
 * square. Nothing here draws it: the rail matches `INK_SELECTOR`, so the ink system
 * picks it up the moment it is appended to the desk.
 */

import { seedFrom } from "./lib/random.js";

/**
 * @param {HTMLElement} desk
 * @param {object} opts
 * @param {(text: string) => void} opts.onSubmit
 */
export function mountPromptBar(desk, { onSubmit }) {
  const form = document.createElement("form");
  form.className = "prompt-bar";
  /* The rail's hand follows its name, like a capability's. */
  form.dataset.inkSeed = String(seedFrom("prompt-bar"));

  const input = document.createElement("input");
  input.type = "text";
  input.className = "prompt-bar__input";
  input.placeholder = "Ask Aluna to build something…";
  input.setAttribute("aria-label", "Ask Aluna to build something");

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn--warm";
  submit.textContent = "Grow it";

  form.append(input, submit);
  desk.append(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    /* Refuse a blank prompt rather than growing nothing. */
    if (!text) {
      input.focus();
      form.classList.add("is-refused");
      setTimeout(() => form.classList.remove("is-refused"), 400);
      return;
    }
    input.value = "";
    onSubmit(text);
  });

  return { el: form, input };
}
