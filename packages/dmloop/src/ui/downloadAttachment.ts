// Authenticated attachment download, dependency-free so the "download goes
// through the authed client by id, never the raw attachment URL" behavior is
// unit-testable in a plain node env. `fetchBlob` (and the DOM save step) are
// injected; the React component supplies the real implementations.
//
// Why this exists: the attachment download endpoint is auth-only. A native
// <a href="/api/attachments/<id>/download" download> dead-links under octo-web
// (that path proxies to a different backend and can't carry the loop auth
// headers) — the exact bug the PR fixes. So every download affordance must
// fetch the bytes by id through the authed client and save the resulting blob.

export type SaveBlob = (blob: Blob, filename: string) => void;

/**
 * Fetch an attachment by id through the authed client and save it. Returns true
 * if the download started, false if the fetch failed. Never references the raw
 * attachment URL — only the server-scoped id.
 */
export async function downloadAttachmentById(
  id: string,
  filename: string,
  deps: { fetchBlob: (id: string) => Promise<Blob>; saveBlob: SaveBlob },
): Promise<boolean> {
  try {
    const blob = await deps.fetchBlob(id);
    deps.saveBlob(blob, filename);
    return true;
  } catch {
    return false;
  }
}

/** Default DOM-based blob saver (anchor click + delayed revoke). */
export function domSaveBlob(blob: Blob, filename: string): void {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
}
