// Hand-written fixture item renderer — Module 3's generated presentation unit.
//
// One record enters; capability-specific inner markup leaves. The platform-owned
// presentation adapter supplies the accessible wrapper, escaped record payload, runtime
// enforcement, and detail-modal template. Like generated item renderers, this fixture has
// no imports and escapes every interpolated field value before returning markup.

export default function renderItem(record) {
  const pin = record.pinned ? '<span class="text-sm text-muted">Pinned</span>' : "";

  return `<div class="stack gap-2">
  <p class="text-lg truncate">${escapeHtml(record.text)}</p>
  ${pin}
</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
