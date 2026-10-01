// Hand-written fixture item renderer — the photos fixture's card. It draws each file through the
// projection's `url` and never composes an address of its own: the photo, then the album in order.

export default function renderItem(record) {
  const photo = record.photo
    ? `<img src="${escapeHtml(record.photo.url)}" alt="${escapeHtml(record.photo.name)}">`
    : "";
  const album = (record.album ?? [])
    .map((file) => `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name)}">`)
    .join("");
  return `<div class="stack gap-2">${photo}${album}<p class="text-lg">${escapeHtml(record.caption)}</p></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
