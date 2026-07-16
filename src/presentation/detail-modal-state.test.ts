import { describe, expect, test } from "bun:test";

import { DETAIL_MODAL_MODE, transitionDetailModalMode } from "../../public/detail-modal-state.js";

describe("detail modal local presentation state", () => {
  test("arms deletion without leaving read detail or making it implicit", () => {
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.read, "request-delete")).toBe(
      DETAIL_MODAL_MODE.deleteConfirm,
    );
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.edit, "request-delete")).toBe(
      DETAIL_MODAL_MODE.edit,
    );
  });

  test("Cancel restores ordinary read actions and edit remains a separate mode", () => {
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.deleteConfirm, "cancel-delete")).toBe(
      DETAIL_MODAL_MODE.read,
    );
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.read, "request-edit")).toBe(
      DETAIL_MODAL_MODE.edit,
    );
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.edit, "cancel-edit")).toBe(
      DETAIL_MODAL_MODE.read,
    );
  });

  test("a failed delete stays visibly confirmed while open/close reset local state", () => {
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.deleteConfirm, "delete-failed")).toBe(
      DETAIL_MODAL_MODE.deleteConfirm,
    );
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.deleteConfirm, "open")).toBe(
      DETAIL_MODAL_MODE.read,
    );
    expect(transitionDetailModalMode(DETAIL_MODAL_MODE.deleteConfirm, "close")).toBe(
      DETAIL_MODAL_MODE.read,
    );
  });
});
