// A valid M3 item renderer beside the deliberately failing handler. Its presence keeps
// the fixture on the mandatory artifact shape so the router test reaches the handler
// failure it intends to exercise.

export default function renderItem(record) {
  return `<p class="text-base">${escapeHtml(record.note)}</p>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
