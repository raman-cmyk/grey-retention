/**
 * PICK-101: the only segments GROS ever makes in Klaviyo, by name: its
 * list-hygiene segment, one per rule ("GROS list hygiene · 180 days · v1").
 * The client refuses to make any other (`isGrosSegmentCreate`).
 */
export const grosSegmentNamePattern =
  /^GROS list hygiene · \d{2,3} days · v\d{1,2}$/
