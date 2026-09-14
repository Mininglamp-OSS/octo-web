export interface HtmlAttachment {
  url: string;
  name: string;
  extension: string;
  size?: number;
  sourceUrl?: string;
  downloadUrl?: string;
  /** Preserve the source document's relative-resource behavior in the new tab. */
  previewBaseUrl?: string;
}

export interface AttachmentSession {
  uid: string;
  sessionId: string;
  token: string;
  spaceId: string;
  apiURL: string;
}

export type AttachmentErrorCode =
  | "loadFailed"
  | "tooLarge"
  | "downloadFailed"
  | "expired"
  | "popupBlocked";

export class AttachmentError extends Error {
  constructor(public readonly code: AttachmentErrorCode) {
    super(code);
  }
}

export function attachmentIdentity(file: HtmlAttachment): string {
  return JSON.stringify([
    file.url,
    file.sourceUrl,
    file.downloadUrl,
    file.name,
    file.extension,
    file.size,
  ]);
}

export function isHtmlAttachment(
  file: Pick<HtmlAttachment, "name" | "extension">
): boolean {
  const dot = file.name.lastIndexOf(".");
  const ext =
    dot > 0 && dot < file.name.length - 1
      ? file.name.slice(dot + 1)
      : file.extension;
  return /^(html|htm)$/i.test(ext || "");
}

export function isBrowserHtmlAttachment(
  file: Pick<HtmlAttachment, "name" | "extension">
): boolean {
  const host = window as Window & {
    __TAURI_IPC__?: unknown;
    __POWERED_EXTENSION__?: unknown;
  };
  return (
    isHtmlAttachment(file) &&
    /^https?:$/.test(window.location.protocol) &&
    !host.__POWERED_ELECTRON__ &&
    !host.octoElectron &&
    !host.__TAURI_IPC__ &&
    !host.__POWERED_EXTENSION__ &&
    import.meta.env.VITE_ELECTRON_BUILD !== "true"
  );
}
