/**
 * Escape regex metacharacters so a user-supplied search term is matched literally.
 *
 * Search boxes across the API feed their input straight into a Mongo `$regex`.
 * Unescaped, a single unbalanced "(" — or "[", or "*" — is an invalid pattern:
 * Mongo throws, the controller's catch block turns it into a 500, and the user
 * sees an empty table with a generic error for what was just a typo mid-word.
 * A crafted pattern also makes the endpoint a ReDoS target.
 *
 * Matching literally is what a search box means anyway — nobody types "(" at a
 * "Search teams…" prompt expecting a capture group.
 */
export const escapeRegex = (value) =>
  String(value ?? "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default escapeRegex;
