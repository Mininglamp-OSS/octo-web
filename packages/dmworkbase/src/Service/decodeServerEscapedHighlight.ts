/**
 * Decode the HTML entities emitted by the server-side highlight escape
 * (`escapeHighlightFragment` in octo-server, applied only to
 * `FileHit.NameHighlight` / `FileHit.ContentSnippet`). Pure string transform,
 * no DOM parsing — every decoded segment renders as a React text node
 * downstream, never as HTML.
 *
 * The set matches what Go's `html.EscapeString` (which the server uses via
 * `escapeHighlightFragment`) actually emits — verified against octo-server's
 * `TestEscapeHighlightFragment` (modules/messages_search/search_files_test.go):
 *   `"` → `&#34;` (decimal, NOT `&quot;`)
 *   `&` → `&amp;`
 *   `'` → `&#39;` (decimal, NOT `&#x27;`)
 *   `<` → `&lt;`
 *   `>` → `&gt;`
 * `/` is NOT escaped by Go's html.EscapeString and is NOT in this table.
 * The literal `<mark>` / `</mark>` highlight tags are preserved by the server
 * escape (value-restored after html.EscapeString) and extracted by the
 * downstream `parseChannelSearchSnippetHighlights` regex.
 *
 * `&amp;` must be replaced LAST so the pass is single-decode: an input of
 * `&amp;lt;` decodes to `&lt;` (the original characters the user typed), not
 * `<` (which would happen if `&amp;` ran first and then `&lt;` matched).
 *
 * IMPORTANT: this only decodes fields the server actually escaped. Do NOT run
 * it over shared snippet paths (e.g. `MessageHit.Snippet` from `/_search`,
 * `/_search_all`, `_search_global_messages`, `_search_global_groups` top_hits)
 * — those are raw on the wire and decoding them corrupts intentionally-typed
 * ampersands, angle-brackets, etc. in message bodies.
 *
 * File location: this helper lives in `Service/` (rather than `Components/`)
 * because it is consumed by `SearchResultMapper` at the data-layer boundary.
 * Keeping it here avoids a `Service → Components` back-edge that in an earlier
 * revision transitively pulled the App component tree (react-virtuoso, etc.)
 * into node-only test files, breaking four unrelated suites during vitest
 * collection. Adding any component/React import to this module re-opens that
 * failure mode.
 */
export function decodeServerEscapedHighlight(input: string): string {
  if (!input) return input;
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
