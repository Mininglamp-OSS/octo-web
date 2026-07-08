/**
 * Shared URL-safety policy for DOCX export hyperlinks.
 *
 * Kept in one place so inline links (marks.ts) and block/attachment links
 * (nodes.ts) can never diverge. Blocks javascript:, file:, data:, vbscript:,
 * and UNC paths (\\server\share or //server/share, an NTLM credential-leak
 * vector); allows relative URLs and the http(s)/mailto/tel schemes.
 */

/** Allowed URL schemes for DOCX hyperlinks. */
export const SAFE_HREF_SCHEMES = /^(?:https?|mailto|tel):/i

/**
 * Return true if `url` is safe to emit as a DOCX hyperlink target.
 * Relative URLs (no scheme) are allowed; UNC paths and non-whitelisted
 * schemes are rejected.
 */
export function isSafeHref(url: string): boolean {
  // Strip leading whitespace / control chars before the scheme check — prevents
  // a bypass like `\tjavascript:` or `\n  javascript:` that passes otherwise.
  const trimmed = url.replace(/^[\s\x00-\x20]+/, '')
  // Block UNC paths (\\server\share or //server/share) — NTLM credential leak vector.
  if (/^\\\\/.test(trimmed) || /^\/\//.test(trimmed)) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !SAFE_HREF_SCHEMES.test(trimmed)) return false
  return true
}
