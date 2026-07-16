export type DetailModalMode = "read" | "edit" | "delete-confirm";
export type DetailModalEvent =
  | "open"
  | "close"
  | "request-edit"
  | "cancel-edit"
  | "request-delete"
  | "cancel-delete"
  | "delete-failed"
  | "delete-succeeded";

export const DETAIL_MODAL_MODE: {
  readonly read: "read";
  readonly edit: "edit";
  readonly deleteConfirm: "delete-confirm";
};

export function transitionDetailModalMode(
  current: DetailModalMode,
  event: DetailModalEvent,
): DetailModalMode;
