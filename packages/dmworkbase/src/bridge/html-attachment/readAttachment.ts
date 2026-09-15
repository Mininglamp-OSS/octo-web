import AttachmentFileService from "../../Service/AttachmentFileService";
import {
  AttachmentError,
  type AttachmentSession,
  type HtmlAttachment,
} from "../../features/html-attachment/types";
import {
  attachmentFilename,
  attachmentObjectReference,
  httpAttachmentURL,
} from "../../features/html-attachment/references";
import {
  assertAttachmentSession,
  requiresAttachmentSession,
} from "../../features/html-attachment/runtime";

export const HTML_BYTE_LIMIT = 20 * 1024 * 1024;
export const HTML_READ_TIMEOUT = 30_000;

export async function signedAttachmentLink(
  file: HtmlAttachment,
  session: AttachmentSession,
  signal: AbortSignal
) {
  assertAttachmentSession(session);
  try {
    const url = await AttachmentFileService.getDownloadLink(
      attachmentObjectReference(file, session.apiURL),
      attachmentFilename(file.name),
      session.spaceId,
      signal
    );
    assertAttachmentSession(session);
    return url;
  } catch (error) {
    // A signing endpoint rejection does not establish a tab-wide logout.
    // Re-check real session ownership, then leave this operation retryable.
    assertAttachmentSession(session);
    if ((error as { status?: number })?.status === 401) {
      throw new AttachmentError("downloadFailed");
    }
    throw error;
  }
}

/** Read decoded transfer bytes, never unbounded arrayBuffer(). Content-Length
 * is only an early check; the stream counter is authoritative (also for gzip). */
export async function readBoundedHtml(
  url: string,
  signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, HTML_READ_TIMEOUT);
  try {
    const response = await fetch(httpAttachmentURL(url), {
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) throw new AttachmentError("loadFailed");
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > HTML_BYTE_LIMIT) {
      void response.body?.cancel();
      throw new AttachmentError("tooLarge");
    }
    if (!response.body) throw new AttachmentError("loadFailed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > HTML_BYTE_LIMIT) throw new AttachmentError("tooLarge");
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw error instanceof AttachmentError
      ? error
      : new AttachmentError("loadFailed");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export async function loadHtmlAttachment(
  file: HtmlAttachment,
  session: AttachmentSession | null,
  signal: AbortSignal
) {
  if (!session && requiresAttachmentSession())
    throw new AttachmentError("expired");
  if ((file.size || 0) > HTML_BYTE_LIMIT) throw new AttachmentError("tooLarge");
  // Known application proxy paths may otherwise hit the SPA fallback with HTTP
  // 200. Resolve those through the signer before reading any response body.
  const direct = new URL(httpAttachmentURL(file.url));
  if (
    session &&
    (direct.origin === window.location.origin ||
      direct.origin ===
        new URL(session.apiURL, window.location.origin).origin) &&
    /\/file\/(?:preview\/)?chat\//.test(direct.pathname)
  ) {
    return readBoundedHtml(
      await signedAttachmentLink(file, session, signal),
      signal
    );
  }
  try {
    const bytes = await readBoundedHtml(file.url, signal);
    if (session) assertAttachmentSession(session);
    return bytes;
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof AttachmentError &&
        ["tooLarge", "expired"].includes(error.code)) ||
      !session
    )
      throw error;
    // One refresh of an expired storage link. No inline policy is required for fetch.
    return readBoundedHtml(
      await signedAttachmentLink(file, session, signal),
      signal
    );
  }
}
