/**
 * Pure decision for the authoritative web origin used by renderer-built
 * URLs that leave the app (share links, clipboard text, IdP return_to, the
 * system-browser bridge).
 *
 * window.location.origin is only a usable web origin when the document is
 * served over http(s). Desktop shells load over file://, where Chromium
 * reports the literal strings "file://" (Electron 26) or "null" (older
 * specs / jsdom) — both truthy, neither a real origin, and both produced
 * broken outgoing URLs when concatenated (file:///d/x, null/d/x,
 * https://host/null/d/x). This allowlist — NOT a denylist of known-bad
 * values — decides: a non-http(s) document origin falls back to the API
 * origin, which IS a real web origin on every deployment.
 *
 * Pure on purpose (no APIClient import): callers inject their own apiURL
 * source (docLink uses the APIClient singleton; MeInfo/vm uses
 * WKApp.apiClient, which keeps axios side effects out of its unit-test
 * import chain), and tests inject both sides directly.
 *
 * Returns "" only when neither is resolvable; callers must treat "" as
 * "no absolute origin" and degrade (root-relative URL, raw fallback).
 */
export function resolveWebOrigin(
  documentOrigin: string | undefined,
  apiURL: string | undefined,
): string {
  if (documentOrigin) {
    try {
      const protocol = new URL(documentOrigin).protocol;
      if (protocol === "http:" || protocol === "https:") return documentOrigin;
    } catch {
      // not a parseable origin — fall through to the API origin
    }
  }
  if (apiURL) {
    try {
      return new URL(apiURL).origin;
    } catch {
      // malformed apiURL — fall through
    }
  }
  return "";
}

/** Is the given string an http(s) origin (the only document origins we treat as web origins)? */
export function isHttpOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const protocol = new URL(origin).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
