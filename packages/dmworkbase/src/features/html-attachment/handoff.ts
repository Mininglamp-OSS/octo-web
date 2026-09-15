import {
  AttachmentError,
  isBrowserHtmlAttachment,
  isHtmlAttachment,
  type HtmlAttachment,
} from "./types";
import { currentAttachmentSession, assertAttachmentSession } from "./runtime";
import { httpAttachmentURL } from "./references";

export const HTML_PREVIEW_PATH = "/file-preview";
export const descriptorKey = (id: string) => `octo.html-preview.${id}`;
export interface HtmlPreviewDescriptor {
  version: 1;
  id: string;
  ownerUid: string;
  ownerSessionId: string;
  spaceId: string;
  file: HtmlAttachment;
}

export function readHtmlPreviewDescriptor(): HtmlPreviewDescriptor | null {
  try {
    const id = window.location.hash.slice(1);
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    const raw = sessionStorage.getItem(descriptorKey(id));
    if (!raw || raw.length > 64 * 1024) return null;
    const data = JSON.parse(raw) as HtmlPreviewDescriptor;
    if (
      data.version !== 1 ||
      data.id !== id ||
      typeof data.ownerUid !== "string" ||
      !data.ownerUid ||
      typeof data.ownerSessionId !== "string" ||
      !data.ownerSessionId ||
      typeof data.spaceId !== "string" ||
      !data.file ||
      typeof data.file.name !== "string" ||
      typeof data.file.extension !== "string" ||
      typeof data.file.url !== "string" ||
      !isHtmlAttachment(data.file)
    )
      return null;
    for (const key of ["sourceUrl", "downloadUrl", "previewBaseUrl"] as const) {
      if (data.file[key] !== undefined && typeof data.file[key] !== "string")
        return null;
    }
    if (
      data.file.size !== undefined &&
      (!Number.isFinite(data.file.size) || data.file.size < 0)
    )
      return null;
    httpAttachmentURL(data.file.url);
    if (data.file.previewBaseUrl) {
      const base = new URL(httpAttachmentURL(data.file.previewBaseUrl));
      if (base.origin !== window.location.origin) return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function openHtmlAttachment(file: HtmlAttachment): void {
  if (!isBrowserHtmlAttachment(file)) return;
  const session = currentAttachmentSession();
  if (!session) throw new AttachmentError("expired");
  assertAttachmentSession(session);
  const id = crypto.randomUUID();
  const base = new URL(document.baseURI);
  base.search = "";
  base.hash = "";
  const descriptor: HtmlPreviewDescriptor = {
    version: 1,
    id,
    ownerUid: session.uid,
    ownerSessionId: session.sessionId,
    spaceId: session.spaceId,
    file: {
      url: httpAttachmentURL(file.url),
      name: file.name,
      extension: file.extension,
      size: file.size,
      sourceUrl: file.sourceUrl,
      downloadUrl: file.downloadUrl,
      previewBaseUrl: base.href,
    },
  };
  // Remain in the user-activation stack. Setting noopener in the window features
  // would remove the handle needed for the same-origin storage handoff.
  const opened = window.open("about:blank", "_blank");
  if (!opened) throw new AttachmentError("popupBlocked");
  try {
    opened.opener = null;
    if (opened.opener !== null) throw new AttachmentError("popupBlocked");
    opened.sessionStorage.setItem("octo.session.sid", session.sessionId);
    // Some browsers omit the inherited sessionStorage copy. Copy only this
    // session's required fields, never a token into the descriptor or URL.
    opened.sessionStorage.setItem(`uid${session.sessionId}`, session.uid);
    opened.sessionStorage.setItem(`token${session.sessionId}`, session.token);
    opened.sessionStorage.setItem(
      descriptorKey(id),
      JSON.stringify(descriptor)
    );
    opened.location.replace(
      `${window.location.origin}${HTML_PREVIEW_PATH}#${id}`
    );
  } catch {
    opened.close();
    throw new AttachmentError("popupBlocked");
  }
}
