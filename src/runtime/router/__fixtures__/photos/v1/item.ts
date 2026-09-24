// Hand-written fixture item renderer — the photos fixture's card. It draws the photo through the
// projection's `url` and never composes an address of its own.

export default function renderItem(record) {
  const photo = record.photo
    ? `<img src="${escapeHtml(record.photo.url)}" alt="${escapeHtml(record.photo.name)}">`
    : "";
  return `<div class="stack gap-2">${photo}<p class="text-lg">${escapeHtml(record.caption)}</p></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
