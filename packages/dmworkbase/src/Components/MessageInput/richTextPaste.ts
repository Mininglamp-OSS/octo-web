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

type AddAttachment = (files: File[], source: "paste") => void | Promise<void>;
type GetImageUrl = (
  url: string,
  opts?: { width: number; height: number }
) => string;

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

function getPasteImageFetchCredentials(src: string): RequestCredentials {
  if (typeof window === "undefined") return "omit";
  try {
    return new URL(src, window.location.href).origin === window.location.origin
      ? "same-origin"
      : "omit";
  } catch {
    return "omit";
  }
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
      credentials: getPasteImageFetchCredentials(src),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = blob.type || block.mime || "image/png";
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
        await addAttachment([file], "paste");
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
