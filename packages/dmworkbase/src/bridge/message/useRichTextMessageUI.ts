import { useMemo } from "react";
import WKApp from "../../App";
import type { MessageWrap } from "../../Service/Model";
import { PartType } from "../../Service/Model";
import { RichTextBlockType } from "../../Messages/RichText/RichTextContent";
import type {
  RichTextBlock,
  RichTextContent,
} from "../../Messages/RichText/RichTextContent";
import {
  formatFileSize,
  getExtension,
  getFileIconInfo,
} from "../../Messages/File";
import { t } from "../../i18n";
import { isSafeUrl } from "../../Utils/security";
import type {
  MixedContentBlock,
  MixedContentFileTone,
} from "../../ui/message/MixedContent";
import { getMessageRow } from "./useMessageRow";
import type { MessageRowSelectionState } from "./useMessageRow";
import { buildTextMessageMentions } from "./textMessageMentions";
import type { MentionInfo, EmojiInfo } from "../../Messages/Text/MarkdownContent";

function resolveFileUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  let fileUrl = WKApp.dataSource.commonDataSource.getFileURL(rawUrl);
  if (!fileUrl) return "";
  if (!fileUrl.startsWith("http")) {
    if (typeof window === "undefined") return "";
    fileUrl = `${window.location.origin}/${fileUrl.replace(/^\//, "")}`;
  }
  return isSafeUrl(fileUrl) ? fileUrl : "";
}

function getFileIconTone(extension: string): MixedContentFileTone {
  switch (extension) {
    case "pdf":
      return "pdf";
    case "doc":
    case "docx":
      return "doc";
    case "xls":
    case "xlsx":
      return "sheet";
    case "ppt":
    case "pptx":
      return "slide";
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return "archive";
    case "mp3":
    case "wav":
    case "flac":
    case "aac":
      return "audio";
    case "mp4":
    case "avi":
    case "mov":
    case "mkv":
      return "video";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "bmp":
    case "webp":
      return "image";
    case "txt":
    case "md":
      return "text";
    default:
      return "default";
  }
}

export function getRichTextBlocksUI(
  blocks: RichTextBlock[]
): MixedContentBlock[] {
  return blocks.reduce<MixedContentBlock[]>((acc, block, index) => {
    const id = `richtext-${index}`;
    if (block.type === RichTextBlockType.image) {
      if (!block.url) return acc;
      acc.push({
        id,
        type: "image",
        src: block.url,
        alt: block.name,
      });
      return acc;
    }

    if (block.type === RichTextBlockType.file) {
      const extension = getExtension(block.extension || "", block.name);
      const iconInfo = getFileIconInfo(extension, block.name);
      acc.push({
        id,
        type: "file",
        name: block.name || t("base.messageFile.unknownFile"),
        size: formatFileSize(block.size || 0),
        extension: extension.toUpperCase(),
        iconTone: getFileIconTone(extension),
        iconLabel: iconInfo.label,
        url: resolveFileUrl(block.url),
        caption: block.caption,
      });
      return acc;
    }

    const text = block.text || "";
    if (block.type === RichTextBlockType.text || text) {
      acc.push({
        id,
        type: "text",
        content: text,
      });
    }
    return acc;
  }, []);
}

export function getRichTextMessageUI(
  message: MessageWrap,
  selection?: MessageRowSelectionState
) {
  const content = message.content as RichTextContent;
  const parts = message.parts || [];

  const mentions: MentionInfo[] = buildTextMessageMentions({
    parts: parts as any,
    content: message.content,
    partMentionType: PartType.mention as unknown as number,
  }) as MentionInfo[];

  const emojis: EmojiInfo[] = parts
    .filter((p: any) => p.type === PartType.emoji)
    .reduce((acc: EmojiInfo[], p: any) => {
      const url = WKApp.emojiService.getImage(p.text);
      if (url && !acc.find((e) => e.key === p.text)) {
        acc.push({ key: p.text, url });
      }
      return acc;
    }, []);

  return {
    row: getMessageRow(message, selection),
    content: {
      blocks: getRichTextBlocksUI(content.content || []),
      mentions,
      emojis,
    },
  };
}

export function useRichTextMessageUI(message: MessageWrap) {
  return useMemo(() => getRichTextMessageUI(message), [message]);
}
