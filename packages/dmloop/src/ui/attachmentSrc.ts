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
