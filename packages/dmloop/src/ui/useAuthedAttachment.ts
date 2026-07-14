import { useEffect, useState } from "react";
import { fetchAttachmentBlob } from "../api/attachmentApi";
import { loadObjectUrl } from "./objectUrl";
import { canPreviewInline } from "./attachmentPreview";
import { downloadAttachmentById, domSaveBlob } from "./downloadAttachment";

/**
 * Load an attachment as an authenticated object URL for inline <img> display.
 * Shared by the attachment card (AuthedImage) and the inline markdown image so
 * the two render paths cannot drift. Returns `{ url, failed }`:
 *   - url === null && !failed → still loading
 *   - failed === true         → not inline-safe (e.g. SVG) or fetch failed;
 *                               caller should show a download affordance instead
 *   - url set                 → object URL ready for <img src>
 *
 * The object URL is revoked on unmount / id change (lifecycle in loadObjectUrl),
 * and inline-unsafe MIME types are refused before any URL is created.
 */
export function useAuthedAttachmentUrl(id: string): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    return loadObjectUrl(
      id,
      { onLoad: setUrl, onError: () => setFailed(true) },
      { fetchBlob: fetchAttachmentBlob, isInlineSafe: canPreviewInline },
    );
  }, [id]);

  return { url, failed };
}

/**
 * Fetch an attachment through the authenticated client and trigger a browser
 * download. Used wherever a download affordance points at the auth-only
 * endpoint — a native <a href> there would 404/401 under octo-web (the exact
 * bug this module works around), so both the attachment card and the inline
 * markdown fallback route clicks through here.
 *
 * Returns true if the download was started, false if the fetch failed.
 */
export function triggerAuthedDownload(id: string, filename: string): Promise<boolean> {
  return downloadAttachmentById(id, filename, {
    fetchBlob: fetchAttachmentBlob,
    saveBlob: domSaveBlob,
  });
}
