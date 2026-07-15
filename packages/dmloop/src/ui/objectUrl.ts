/**
 * Load an attachment as an object URL and hand back a disposer, isolating the
 * fetch → createObjectURL → revoke lifecycle from React so it can be unit
 * tested without a DOM. This is the part most prone to leaking: the URL must be
 * revoked exactly once when the consumer unmounts or switches to another
 * attachment, and a load that resolves after cancellation must revoke the URL
 * it just created instead of handing back a live one.
 *
 * `fetchBlob` is injected (not imported) so this module stays free of the API
 * client's transitive UI deps and remains unit-testable in a plain node env.
 *
 * `isInlineSafe` gates object-URL creation on the fetched blob's actual MIME
 * type: a blob whose type is not inline-safe (e.g. image/svg+xml, which can run
 * script in the document origin) is treated as a load failure — onError fires,
 * no object URL is created — so callers fall back to a download link. This is
 * the last line of defense for the inline-image path, which only has a URL and
 * cannot pre-filter by declared content type the way the attachment card can.
 *
 * Returns a `cancel` function. Call it on unmount / id change:
 *   - before onLoad fired  → the pending load is dropped; if it later resolves,
 *     the freshly created URL is revoked immediately (no leak, no callback).
 *   - after onLoad fired   → the delivered URL is revoked.
 * `cancel` is idempotent.
 */
export function loadObjectUrl(
  attachmentId: string,
  handlers: { onLoad: (url: string) => void; onError: () => void },
  deps: {
    fetchBlob: (id: string) => Promise<Blob>;
    isInlineSafe?: (mimeType: string) => boolean;
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  },
): () => void {
  const { fetchBlob, isInlineSafe } = deps;
  const createObjectURL =
    deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeObjectURL =
    deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));

  let cancelled = false;
  let liveUrl: string | null = null;

  fetchBlob(attachmentId)
    .then((blob) => {
      // Reject unsafe MIME before ever creating an object URL: an SVG blob
      // inlined as <img> would execute in the document origin (stored XSS).
      if (isInlineSafe && !isInlineSafe(blob.type)) {
        if (!cancelled) handlers.onError();
        return;
      }
      const url = createObjectURL(blob);
      if (cancelled) {
        // Resolved after cancel: revoke the URL we just made, deliver nothing.
        revokeObjectURL(url);
        return;
      }
      liveUrl = url;
      handlers.onLoad(url);
    })
    .catch(() => {
      if (!cancelled) handlers.onError();
    });

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (liveUrl) {
      revokeObjectURL(liveUrl);
      liveUrl = null;
    }
  };
}
