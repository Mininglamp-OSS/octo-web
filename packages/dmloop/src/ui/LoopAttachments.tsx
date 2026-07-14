import React, { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Attachment } from "../api/types";
import { fetchAttachmentBlob } from "../api/attachmentApi";
import { loadObjectUrl } from "./objectUrl";

/**
 * Attachment renderer for the loop timeline. Loads bytes through the
 * authenticated loop client instead of setting a native src to `download_url`.
 *
 * Why not `<img src={download_url}>`: that endpoint is auth-only and, under
 * octo-web, the document origin proxies `/api/*` to a different backend than
 * the loop API — so a native element request (which can't carry the loop
 * `token`/`X-Space-Id` headers) 404s and the image breaks. Fetching the Blob
 * via the client and wrapping it in an object URL loads it with auth against
 * the correct backend. The object URL is revoked on unmount / id change so a
 * long timeline doesn't leak blobs (lifecycle isolated in loadObjectUrl).
 */
function AuthedImage({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    // loadObjectUrl returns the disposer; running it on cleanup revokes the URL
    // (or drops a still-pending load) so unmount / id change can't leak blobs.
    return loadObjectUrl(att.id, {
      onLoad: setUrl,
      onError: () => setFailed(true),
    }, { fetchBlob: fetchAttachmentBlob });
  }, [att.id]);

  if (failed) {
    // Fall back to a plain download link so the attachment is still reachable.
    return <AuthedDownload att={att} />;
  }
  if (!url) {
    // Visible placeholder while bytes load (not loop-att--img, which zeroes
    // out box styling and would render an invisible 0×0 span).
    return <span className="loop-att loop-att--loading" aria-label={att.filename} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="loop-att loop-att--img">
      <img src={url} alt={att.filename} />
    </a>
  );
}

/**
 * Non-image attachment: an icon + filename that downloads on click. Same auth
 * reasoning as AuthedImage — we can't point an <a href> at the auth-only
 * endpoint, so we fetch the Blob on click, then trigger a download from an
 * object URL and revoke it.
 */
function AuthedDownload({ att }: { att: Attachment }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const blob = await fetchAttachmentBlob(att.id);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the click has had a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
    } catch {
      /* swallowed: a failed download shows no toast here to stay unobtrusive */
    } finally {
      setBusy(false);
    }
  };

  return (
    <a
      href={att.download_url}
      onClick={onClick}
      className="loop-att"
      aria-busy={busy}
      aria-label={t("loop.attach.download", { values: { name: att.filename } })}
    >
      <Paperclip size={12} />
      <span>{att.filename}</span>
    </a>
  );
}

/** Renders a list of attachments (shared between issue-level and comment-level). */
export default function LoopAttachments({
  attachments,
}: {
  attachments: Attachment[] | null | undefined;
}) {
  if (!attachments?.length) return null;
  return (
    <div className="loop-atts">
      {attachments.map((a) =>
        a.content_type.startsWith("image/") ? (
          <AuthedImage key={a.id} att={a} />
        ) : (
          <AuthedDownload key={a.id} att={a} />
        ),
      )}
    </div>
  );
}
