import type { OctoRichTextClipboardPayload } from "../../Utils/richTextClipboard";
import { extractOctoRichTextClipboardPayloadFromHtml } from "../../Utils/richTextClipboard";
import { detectPastedSecret } from "./secretPasteDetect";

export interface ComposerClipboardSnapshot {
  plainText: string;
  html: string;
  files: readonly File[];
}

export type ComposerPasteDecision =
  | { kind: "block-secret"; value: string }
  | { kind: "octo-rich-text"; payload: OctoRichTextClipboardPayload }
  | { kind: "files"; files: File[] }
  | { kind: "default" };

export interface ClipboardDataLike {
  getData: (type: string) => string;
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{
    kind: string;
    getAsFile: () => File | null;
  }> | null;
}

export function snapshotComposerClipboard(
  clipboardData: ClipboardDataLike,
): ComposerClipboardSnapshot {
  const files = clipboardData.files ? Array.from(clipboardData.files) : [];
  if (files.length === 0 && clipboardData.items) {
    Array.from(clipboardData.items).forEach((item) => {
      if (item.kind !== "file") return;
      const file = item.getAsFile();
      if (file) files.push(file);
    });
  }
  return {
    plainText: clipboardData.getData("text/plain") || "",
    html: clipboardData.getData("text/html") || "",
    files,
  };
}

/** Security and product precedence for every editor paste entry point. */
export function decideComposerPaste(
  snapshot: ComposerClipboardSnapshot,
): ComposerPasteDecision {
  const secret =
    detectPastedSecret(snapshot.plainText) ??
    detectPastedSecret(snapshot.html);
  if (secret) return { kind: "block-secret", value: secret.value };

  const richText = extractOctoRichTextClipboardPayloadFromHtml(snapshot.html);
  if (richText) return { kind: "octo-rich-text", payload: richText };

  // Preserve the browser's established HTML/plain precedence for mixed pastes.
  if (snapshot.html || snapshot.plainText) return { kind: "default" };

  if (snapshot.files.length > 0) {
    return { kind: "files", files: [...snapshot.files] };
  }

  return { kind: "default" };
}
