import {
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
} from "../../Messages/RichText/RichTextContent";
import type {
  OctoRichTextClipboardBlock,
  OctoRichTextClipboardMention,
  OctoRichTextClipboardPayload,
} from "../../Utils/richTextClipboard";
import { isSafeUrl } from "../../Utils/security";

type EditorLike = {
  chain: () => {
    focus: () => {
      insertContent: (content: any) => {
        run: () => void;
      };
    };
  };
};

type AddAttachment = (
  files: File[],
  source: "paste"
) => boolean | void | Promise<boolean | void>;
type GetImageUrl = (
  url: string,
  opts?: { width: number; height: number }
) => string;

export const MAX_PASTE_IMAGE_BYTES = 20 * 1024 * 1024;

export interface RestoreOctoRichTextPasteDeps {
  imageBlockToFile?: (
    block: Extract<OctoRichTextClipboardBlock, { type: "image" }>
  ) => Promise<File | null>;
}

function appendPlainText(nodes: any[], text: string) {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line) {
      nodes.push({ type: "text", text: line });
    }
    if (index < lines.length - 1) {
      nodes.push({ type: "hardBreak" });
    }
  });
}

export function buildInlineContentForRichTextPaste(
  text: string,
  mentions?: OctoRichTextClipboardMention[]
): any[] {
  const nodes: any[] = [];
  const sortedMentions = (mentions || [])
    .filter(
      (mention) =>
        mention.offset >= 0 &&
        mention.length > 0 &&
        mention.offset + mention.length <= text.length
    )
    .sort((a, b) => a.offset - b.offset);

  let cursor = 0;
  for (const mention of sortedMentions) {
    if (mention.offset < cursor) continue;
    appendPlainText(nodes, text.slice(cursor, mention.offset));
    const name = text.slice(mention.offset, mention.offset + mention.length);
    if (name.startsWith("@")) {
      nodes.push({
        type: "mention",
        attrs: {
          id: mention.uid,
          label: name.slice(1),
        },
      });
    } else {
      appendPlainText(nodes, name);
    }
    cursor = mention.offset + mention.length;
  }

  appendPlainText(nodes, text.slice(cursor));
  return nodes;
}

function insertInlineContent(editor: EditorLike, content: any[]) {
  if (content.length === 0) return;
  editor.chain().focus().insertContent(content).run();
}

function safeImageFileName(name?: string, mime?: string): string {
  const fallbackExt = mime?.split("/").pop() || "png";
  const fallback = `image.${fallbackExt}`;
  const raw = (name || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  return raw || fallback;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function normalizeMime(value: string | null | undefined): string {
  return (value || "").split(";")[0].trim().toLowerCase();
}

async function responseToCappedImageBlob(
  response: Response
): Promise<Blob | null> {
  const contentLength = parseContentLength(
    response.headers.get("Content-Length")
  );
  if (contentLength !== null && contentLength > MAX_PASTE_IMAGE_BYTES) {
    return null;
  }

  const contentType = normalizeMime(response.headers.get("Content-Type"));

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_PASTE_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
    return new Blob(chunks, { type: contentType });
  }

  const blob = await response.blob();
  if (blob.size > MAX_PASTE_IMAGE_BYTES) {
    return null;
  }
  return blob;
}

export async function imageBlockToPasteFile(
  block: Extract<OctoRichTextClipboardBlock, { type: "image" }>,
  getImageURL: GetImageUrl
): Promise<File | null> {
  const src = getImageURL(block.url, {
    width: block.width || 0,
    height: block.height || 0,
  });
  if (!isSafeUrl(src)) return null;

  try {
    const response = await fetch(src, {
      mode: "cors",
      // Clipboard payloads are user-controlled HTML. Do not attach cookies when
      // fetching image blocks; add an explicit allowlist if private same-origin
      // image endpoints need to be restored in the future.
      credentials: "omit",
    });
    if (!response.ok) return null;
    const blob = await responseToCappedImageBlob(response);
    if (!blob) return null;
    const type = normalizeMime(
      blob.type || response.headers.get("Content-Type")
    );
    if (!type.startsWith("image/")) return null;
    return new File([blob], safeImageFileName(block.name, type), {
      type,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

export async function restoreOctoRichTextClipboardToEditor(
  payload: OctoRichTextClipboardPayload,
  editor: EditorLike,
  addAttachment: AddAttachment,
  deps: RestoreOctoRichTextPasteDeps = {}
): Promise<void> {
  const resolveImageFile =
    deps.imageBlockToFile || (() => Promise.resolve(null));

  for (const block of payload.blocks) {
    if (block.type === "text") {
      insertInlineContent(
        editor,
        buildInlineContentForRichTextPaste(block.text, block.mentions)
      );
      continue;
    }

    if (block.type === "image") {
      const file = await resolveImageFile(block);
      if (file) {
        const accepted = await addAttachment([file], "paste");
        if (accepted !== false) continue;
        insertInlineContent(editor, [
          { type: "text", text: RichTextImagePlaceholder },
        ]);
      } else {
        insertInlineContent(editor, [
          { type: "text", text: RichTextImagePlaceholder },
        ]);
      }
      continue;
    }

    if (block.type === "file") {
      const label = block.name
        ? `${RichTextFilePlaceholder} ${block.name}`
        : RichTextFilePlaceholder;
      insertInlineContent(editor, [{ type: "text", text: label }]);
    }
  }
}
