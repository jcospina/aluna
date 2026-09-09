// One classification every suite that needs a valid one can reach for, so a test about a single
// field is not also a second copy of the shape around it. Not run as a test by bun.

/** A question about saved data, classified. Valid through `intentClassificationSchema`, which is
 * what makes it usable as the base a suite changes one field of. */
export const A_DATA_QUERY_CLASSIFICATION = {
  type: "data_query",
  confidence: 0.94,
  target_capability: null,
  resolution: "none",
  proposed_identity: null,
  proposed_action: "Look at what is saved.",
  user_facing_label: "Let me look at what you've saved.",
  requires_confirmation: false,
};
