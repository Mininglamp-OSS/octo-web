import { AttachmentError, type HtmlAttachment } from "./types";

export function httpAttachmentURL(
  value: string,
  base = window.location.href
): string {
  const url = new URL(value, base);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new AttachmentError("loadFailed");
  return url.href;
}

/** Strip only known Octo proxy routes. Keep storage URLs intact for the server's
 * configured bucket/prefix parser; never remove arbitrary external path segments. */
export function attachmentObjectReference(
  file: HtmlAttachment,
  apiURL: string
): string {
  const value = file.sourceUrl || file.downloadUrl || file.url;
  if (/^(?:\/?file\/preview\/)?chat\//.test(value)) {
    return value.replace(/^\/?file\/preview\//, "");
  }
  const url = new URL(httpAttachmentURL(value));
  const api = new URL(apiURL, window.location.origin);
  if (url.origin === window.location.origin || url.origin === api.origin) {
    const prefixes = [
      "/file/preview/",
      "/file/",
      `${api.pathname.replace(/\/$/, "")}/file/preview/`,
    ];
    const prefix = prefixes.find((item) =>
      url.pathname.startsWith(`${item}chat/`)
    );
    if (prefix) return decodeURIComponent(url.pathname.slice(prefix.length));
  }
  // Chat object paths carry /chat/. Other external files can still be fetched
  // directly, but must not be reinterpreted as objects in our storage account.
  if (/\/chat\//.test(url.pathname)) return url.href;
  throw new AttachmentError("downloadFailed");
}

export function attachmentFilename(name: string): string {
  // Preserve Unicode, spaces and extension; strip path/control characters.
  return (
    name
      .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || "file.html"
  );
}
