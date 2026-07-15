// Attachment inline-preview policy. Kept dependency-free (no React / UI imports)
// so the SVG-must-not-inline guarantee can be unit tested in a plain node env.

// Raster image types safe to preview inline as an authenticated blob <img>.
// Deliberately NOT `image/*`: SVG (image/svg+xml) is XML that can carry
// <script>/<foreignObject>/onload= and executes in the document origin when
// rendered inline. The backend forces Content-Disposition: attachment + a
// strict attachment CSP for SVG to prevent stored XSS; turning any image into a
// same-origin blob strips those headers and would reinstate the hole. So only
// these known-safe raster formats get the inline blob preview — everything else
// (SVG, unknown image/*, non-images) downloads.
const INLINE_PREVIEW_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/**
 * Whether an attachment may be previewed inline. Only the known-safe raster
 * formats above qualify; SVG and any other type must download instead.
 */
export function canPreviewInline(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  // Strip any `; charset=…` / parameters and normalize before matching.
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return INLINE_PREVIEW_TYPES.has(base);
}
