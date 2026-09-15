import {
  AttachmentError,
  type HtmlAttachment,
  type AttachmentSession,
} from "../../features/html-attachment/types";
import { attachmentFilename } from "../../features/html-attachment/references";
import {
  currentAttachmentSession,
  assertAttachmentSession,
  requiresAttachmentSession,
  subscribeAttachmentSession,
} from "../../features/html-attachment/runtime";
import {
  HTML_BYTE_LIMIT,
  loadHtmlAttachment,
  signedAttachmentLink,
} from "./readAttachment";

function clickDownload(url: string, filename: string, external = false) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  if (external) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function saveBytes(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" })
  );
  // Keep the URL alive long enough for Safari/Firefox to begin reading it.
  const cleanup = () => {
    URL.revokeObjectURL(url);
    clearTimeout(timer);
    window.removeEventListener("pagehide", cleanup);
  };
  const timer = setTimeout(cleanup, 60_000);
  window.addEventListener("pagehide", cleanup, { once: true });
  try {
    clickDownload(url, name);
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function downloadHtmlAttachment(
  file: HtmlAttachment,
  signal: AbortSignal,
  existingBytes?: Uint8Array<ArrayBuffer>
) {
  const session = currentAttachmentSession();
  if (!session && requiresAttachmentSession())
    throw new AttachmentError("expired");
  const controller = new AbortController();
  let expired = false;
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const unsubscribe = subscribeAttachmentSession(() => {
    if (!session) return;
    try {
      assertAttachmentSession(session);
    } catch {
      expired = true;
      controller.abort();
    }
  });
  try {
    await downloadCurrentAttachment(
      file,
      session,
      controller.signal,
      existingBytes
    );
  } catch (error) {
    if (expired) throw new AttachmentError("expired");
    throw error;
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", abort);
  }
}

async function downloadCurrentAttachment(
  file: HtmlAttachment,
  session: AttachmentSession | null,
  signal: AbortSignal,
  existingBytes?: Uint8Array<ArrayBuffer>
) {
  const check = () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (session) assertAttachmentSession(session);
  };
  check();
  let bytes = existingBytes;
  if (!bytes && (file.size || 0) <= HTML_BYTE_LIMIT) {
    try {
      bytes = await loadHtmlAttachment(file, session, signal);
    } catch (error) {
      check();
      // A rejected signing request must not be retried by the fallback in the
      // same click. A new user attempt can sign again with the live session.
      if (
        error instanceof AttachmentError &&
        ["expired", "downloadFailed"].includes(error.code)
      )
        throw error;
    }
  }
  check();
  if (bytes && bytes.byteLength <= HTML_BYTE_LIMIT) {
    saveBytes(bytes, attachmentFilename(file.name));
    return;
  }
  if (!session) throw new AttachmentError("downloadFailed");
  const url = await signedAttachmentLink(file, session, signal);
  check();
  clickDownload(url, attachmentFilename(file.name), true);
}
