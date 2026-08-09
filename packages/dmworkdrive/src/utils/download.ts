/**
 * Trigger a browser download for a (already fetched) signed GET URL.
 *
 * Uses a transient anchor click rather than navigating the page. The `download`
 * hint applies to same-origin URLs; for cross-origin object-storage URLs the
 * filename comes from the server's Content-Disposition, so we still pass it as
 * a best-effort hint.
 */
export function triggerBrowserDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
