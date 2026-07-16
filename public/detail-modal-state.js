// @ts-check

/** @typedef {"read" | "edit" | "delete-confirm"} DetailModalMode */
/** @typedef {"open" | "close" | "request-edit" | "cancel-edit" | "request-delete" | "cancel-delete" | "delete-failed" | "delete-succeeded"} DetailModalEvent */

export const DETAIL_MODAL_MODE = /** @type {const} */ ({
  read: "read",
  edit: "edit",
  deleteConfirm: "delete-confirm",
});

/**
 * The modal's complete local presentation state machine. Canonical state never lives
 * here: requesting delete only reveals confirmation, and only the separately submitted
 * confirmation form can invoke the server Action.
 * @param {DetailModalMode} current
 * @param {DetailModalEvent} event
 * @returns {DetailModalMode}
 */
export function transitionDetailModalMode(current, event) {
  if (event === "open" || event === "close" || event === "delete-succeeded") {
    return DETAIL_MODAL_MODE.read;
  }
  if (event === "request-edit" && current === DETAIL_MODAL_MODE.read) {
    return DETAIL_MODAL_MODE.edit;
  }
  if (event === "cancel-edit" && current === DETAIL_MODAL_MODE.edit) {
    return DETAIL_MODAL_MODE.read;
  }
  if (event === "request-delete" && current === DETAIL_MODAL_MODE.read) {
    return DETAIL_MODAL_MODE.deleteConfirm;
  }
  if (event === "cancel-delete" && current === DETAIL_MODAL_MODE.deleteConfirm) {
    return DETAIL_MODAL_MODE.read;
  }
  return current;
}
