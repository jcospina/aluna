// Hand-written fixture handler — Module 2, Epic 2.3 tracer bullet.
//
// The `read` half of the notes fixture: it pulls live rows through the scoped data
// tool and returns a data-free-shell-friendly HTML fragment. Like its sibling it
// honors the ADR-0004 contract literally — no module imports, no raw HTTP, no
// table names — and receives only the platform-built context. (Untyped on purpose:
// generated artifacts live outside the platform's type-check.)

export default async function read({ data }) {
  const notes = data.select();
  if (notes.length === 0) {
    // No records: return nothing so the platform region stays truly `:empty` and the
    // platform-owned empty state shows (ADR-0005 §1). A handler that emits its own
    // empty-state markup would fill the region — defeating that empty state and
    // lingering below the first record once create prepends it.
    return "";
  }

  const items = notes
    .map((note) => {
      const pin = note.pinned ? ' <span class="note__pin">pinned</span>' : "";
      return `<li class="note" data-id="${escapeHtml(note.id)}">${escapeHtml(note.text)}${pin}</li>`;
    })
    .join("");

  return `<ul class="notes">${items}</ul>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
