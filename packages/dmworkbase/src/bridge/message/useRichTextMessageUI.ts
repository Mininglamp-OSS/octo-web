import { useMemo } from "react";
import WKApp from "../../App";
import type { MessageWrap } from "../../Service/Model";
import {
  RichTextBlockType,
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
} from "../../Messages/RichText/RichTextContent";
import type {
  RichTextBlock,
  RichTextContent,
} from "../../Messages/RichText/RichTextContent";
import type {
  EmojiInfo,
  MentionInfo,
} from "../../Messages/Text/MarkdownContent";
import {
  formatFileSize,
  getExtension,
  getFileIconInfo,
} from "../../Messages/File";
import { t } from "../../i18n";
import { isSafeUrl } from "../../Utils/security";
import {
  buildMessageMentions,
  MENTION_UID_AIS,
  MENTION_UID_HUMANS,
  MENTION_UID_LEGACY_ALL,
  readMentionFlags,
} from "../../Utils/mentionRender";
import type {
  MixedContentBlock,
  MixedContentFileTone,
} from "../../ui/message/MixedContent";
import { getMessageRow } from "./useMessageRow";
import type { MessageRowSelectionState } from "./useMessageRow";

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

interface RichTextMentionEntity {
  uid: string;
  offset: number;
  length: number;
}

interface RichTextTextRenderContext {
  entities: RichTextMentionEntity[];
  syntheticMentions: MentionInfo[];
}

function getRichTextMentionEntities(
  content: RichTextContent
): RichTextMentionEntity[] {
  const mentionAny = (content as any).mention;
  const contentObjMention = (content as any).contentObj?.mention;
  const entities = Array.isArray(mentionAny?.entities)
    ? mentionAny.entities
    : Array.isArray(contentObjMention?.entities)
    ? contentObjMention.entities
    : [];
  return entities.filter(
    (entity: any): entity is RichTextMentionEntity =>
      entity &&
      typeof entity.uid === "string" &&
      Number.isFinite(entity.offset) &&
      Number.isFinite(entity.length) &&
      entity.offset >= 0 &&
      entity.length > 0
  );
}

function getRichTextSyntheticMentions(content: RichTextContent): MentionInfo[] {
  return buildMessageMentions(
    [],
    readMentionFlags(content),
    -1
  ) as MentionInfo[];
}

function getTextBlockMentions(
  text: string,
  plainOffset: number,
  context?: RichTextTextRenderContext
): MentionInfo[] {
  if (!context) return [];
  const end = plainOffset + text.length;
  const entityMentions = context.entities
    .filter(
      (entity) =>
        entity.offset >= plainOffset &&
        entity.offset + entity.length <= end &&
        entity.uid !== MENTION_UID_LEGACY_ALL &&
        entity.uid !== MENTION_UID_HUMANS &&
        entity.uid !== MENTION_UID_AIS
    )
    .map((entity) => {
      const localOffset = entity.offset - plainOffset;
      return {
        name: text.slice(localOffset, localOffset + entity.length),
        uid: entity.uid,
      };
    })
    .filter((mention) => mention.name.startsWith("@"));

  const mentions = [...entityMentions];
  const seen = new Set(mentions.map((mention) => mention.name));
  for (const synthetic of context.syntheticMentions) {
    if (!seen.has(synthetic.name)) {
      mentions.push(synthetic);
      seen.add(synthetic.name);
    }
  }
  return mentions;
}

function getTextBlockEmojis(text: string): EmojiInfo[] {
  const emojis: EmojiInfo[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = rest.match(WKApp.emojiService.emojiRegExp());
    if (!match || match.index === undefined || match.index < 0) break;
    const key = match[0];
    const url = WKApp.emojiService.getImage(key);
    if (url && !emojis.find((emoji) => emoji.key === key)) {
      emojis.push({ key, url });
    }
    rest = rest.slice(match.index + key.length);
  }
  return emojis;
}

function getBlockPlainLength(block: RichTextBlock): number {
  if (block.type === RichTextBlockType.image) {
    return RichTextImagePlaceholder.length;
  }
  if (block.type === RichTextBlockType.file) {
    return block.name
      ? `${RichTextFilePlaceholder} ${block.name}`.length
      : RichTextFilePlaceholder.length;
  }
  return (block.text || "").length;
}

export function getRichTextBlocksUI(
  blocks: RichTextBlock[],
  textContext?: RichTextTextRenderContext
): MixedContentBlock[] {
  let plainOffset = 0;
  return blocks.reduce<MixedContentBlock[]>((acc, block, index) => {
    const id = `richtext-${index}`;
    if (block.type === RichTextBlockType.image) {
      if (block.url) {
        acc.push({
          id,
          type: "image",
          src: block.url,
          alt: block.name,
        });
      }
      plainOffset += getBlockPlainLength(block);
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
      plainOffset += getBlockPlainLength(block);
      return acc;
    }

    const text = block.text || "";
    if (block.type === RichTextBlockType.text || text) {
      acc.push({
        id,
        type: "text",
        content: text,
        mentions: getTextBlockMentions(text, plainOffset, textContext),
        emojis: getTextBlockEmojis(text),
      });
    }
    plainOffset += getBlockPlainLength(block);
    return acc;
  }, []);
}

export function getRichTextMessageUI(
  message: MessageWrap,
  selection?: MessageRowSelectionState
) {
  const content = message.content as RichTextContent;
  return {
    row: getMessageRow(message, selection),
    content: {
      blocks: getRichTextBlocksUI(content.content || [], {
        entities: getRichTextMentionEntities(content),
        syntheticMentions: getRichTextSyntheticMentions(content),
      }),
    },
  };
}

export function useRichTextMessageUI(message: MessageWrap) {
  return useMemo(() => getRichTextMessageUI(message), [message]);
}
