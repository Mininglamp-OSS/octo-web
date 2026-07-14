// Recognize markdown image URLs that point at a loop attachment download
// endpoint so inline images can be loaded through the authenticated client
// (same as attachment cards) instead of a native <img src> that carries no
// auth. Kept dependency-free so it is unit-testable in a plain node env.
//
// The backend's `markdown_url` for a private attachment is either site-relative
// (`/api/attachments/<id>/download`) or absolute against the public origin
// (`https://host/api/attachments/<id>/download`). Both are matched. A publicly
// readable storage URL (a different shape, e.g. a signed CDN link) is NOT
// matched and is left to load natively.
const ATTACHMENT_PATH_RE = /\/api\/attachments\/([0-9a-fA-F-]{36})\/download(?:$|[?#])/;

/**
 * If `src` is a loop attachment download URL, return its attachment id;
 * otherwise null (external URL, data:, or a non-attachment path — load natively).
 */
export function attachmentIdFromSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const m = ATTACHMENT_PATH_RE.exec(src);
  return m ? m[1]! : null;
}

/**
 * Whether `src` is a public, cross-origin absolute URL. The backend only emits
 * an absolute `download_url` when it is a signed public CDN link (CFSigner is
 * configured); such a URL is publicly readable and loads natively — no auth
 * blob fetch is needed, and a cross-origin XHR blob fetch would hit CORS. A
 * site-relative `download_url` (the default, auth-only endpoint) is same-origin
 * → false, so the current deployment always takes the authed blob path.
 *
 * Only `http:`/`https:` count: a `javascript:` / `data:` / `blob:` URL is
 * rejected so a hostile `download_url` can never become a native `<a href>` /
 * `<img src>` (defense in depth — download_url is backend-issued, not user text).
 *
 * `appOrigin` is injectable for tests; it defaults to the current window origin
 * and returns false when the origin can't be determined (safe: keep authed path).
 */
export function isPublicAbsoluteUrl(
  src: string | null | undefined,
  appOrigin: string = typeof window !== "undefined" ? window.location.origin : "",
): boolean {
  if (!src || !appOrigin) return false;
  try {
    const u = new URL(src, appOrigin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return u.origin !== appOrigin;
  } catch {
    return false;
  }
}
