/**
 * Decode the HTML entities emitted by the server-side highlight escape
 * (`escapeHighlightFragment` in octo-server, applied only to
 * `FileHit.NameHighlight` / `FileHit.ContentSnippet`) into their literal
 * characters. Pure string transform — no DOM parsing, no template evaluation —
 * so a decoded segment is only ever used as a React text node downstream
 * (never as HTML).
 *
 * The set is closed and follows Apache Lucene's `SimpleHTMLEncoder`, which is
 * what `encoder=html` resolves to server-side:
 *   `"` → `&quot;`, `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`,
 *   `'` → `&#x27;`, `/` → `&#x2F;`.
 * The literal `<mark>` / `</mark>` tags configured on the OpenSearch highlighter
 * are preserved through the server-side escape and extracted by regex in the
 * downstream parser.
 *
 * `&amp;` must be replaced LAST so the pass is single-decode: an input of
 * `&amp;lt;` decodes to `&lt;` (the original characters the user typed), not
 * `<` (which would happen if `&amp;` ran first and then `&lt;` matched).
 *
 * IMPORTANT: this only decodes fields the server actually escaped. Do NOT run
 * it over shared snippet paths (e.g. `MessageHit.Snippet` from `/_search`,
 * `/_search_all`, `_search_global_messages`, `_search_global_groups` top_hits)
 * — those are raw on the wire and decoding them corrupts intentionally-typed
 * ampersands, angle-brackets, etc. in message bodies. Decode at the mapper
 * boundary for the specific fields whose contract says "server-escaped".
 *
 * This helper is intentionally in its own module — with zero React or App
 * imports — so pure-data callers (`SearchResultMapper`) can consume it
 * without transitively pulling the entire App component tree (react-virtuoso
 * and friends) into node-only test files that don't mock those modules.
 */
export function decodeServerEscapedHighlight(input: string): string {
  if (!input) return input;
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}
