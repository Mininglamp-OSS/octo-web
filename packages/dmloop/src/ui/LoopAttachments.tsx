import React, { useState } from "react";
import { Paperclip } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Attachment } from "../api/types";
import { canPreviewInline } from "./attachmentPreview";
import { isPublicAbsoluteUrl } from "./attachmentSrc";
import { useAuthedAttachmentUrl, triggerAuthedDownload } from "./useAuthedAttachment";

/**
 * Attachment renderer for the loop timeline. Loads bytes through the
 * authenticated loop client instead of setting a native src to `download_url`.
 *
 * Why not `<img src={download_url}>`: that endpoint is auth-only and, under
 * octo-web, the document origin proxies `/api/*` to a different backend than
 * the loop API — so a native element request (which can't carry the loop
 * `token`/`X-Space-Id` headers) 404s and the image breaks. Fetching the Blob
 * via the client and wrapping it in an object URL loads it with auth against
 * the correct backend (lifecycle isolated in useAuthedAttachmentUrl).
 */
function AuthedImage({ att }: { att: Attachment }) {
  const { url, failed } = useAuthedAttachmentUrl(att.id);

  if (failed) {
    // Fall back to a click-to-download link so the attachment is still reachable.
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
 * A public (cross-origin absolute) download_url is a signed CDN link — publicly
 * readable, so load it as a native <img src>: no auth is needed, and a
 * cross-origin blob XHR would hit CORS. Only reached when the backend serves
 * signed CDN URLs; the default site-relative (auth-only) download_url keeps the
 * AuthedImage blob path.
 */
function NativeImage({ att }: { att: Attachment }) {
  return (
    <a href={att.download_url} target="_blank" rel="noreferrer" className="loop-att loop-att--img">
      <img src={att.download_url} alt={att.filename} />
    </a>
  );
}

/**
 * Non-image attachment: an icon + filename that downloads on click. Same auth
 * reasoning as AuthedImage — we can't point an <a href> at the auth-only
 * endpoint, so we fetch the Blob on click (triggerAuthedDownload) and trigger a
 * download from an object URL.
 */
function AuthedDownload({ att }: { att: Attachment }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await triggerAuthedDownload(att.id, att.filename);
    setBusy(false);
  };

  return (
    <a
      href="#"
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
        !canPreviewInline(a.content_type) ? (
          <AuthedDownload key={a.id} att={a} />
        ) : isPublicAbsoluteUrl(a.download_url) ? (
          <NativeImage key={a.id} att={a} />
        ) : (
          <AuthedImage key={a.id} att={a} />
        ),
      )}
    </div>
  );
}
