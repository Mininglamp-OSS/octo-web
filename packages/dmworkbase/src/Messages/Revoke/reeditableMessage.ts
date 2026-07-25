import type { JSONContent } from "@tiptap/react";
import { MessageContentType, type MessageText } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageWrap, PartType } from "../../Service/Model";
import {
  MENTION_LABEL_AIS,
  MENTION_LABEL_HUMANS,
  MENTION_UID_AIS,
  MENTION_UID_HUMANS,
  MENTION_UID_LEGACY_ALL,
  isBroadcastSentinelUid,
  readMentionFlags,
} from "../../Utils/mentionRender";
import type { FileContent } from "../File/FileContent";
import type { ImageContent } from "../Image";
import {
  RichTextBlockType,
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
} from "../RichText/RichTextContent";
import type { RichTextContent } from "../RichText/RichTextContent";

export type ReeditBlock =
  | { type: "content"; content: JSONContent[] }
  | {
      type: "image";
      url: string;
      width?: number;
      height?: number;
      size?: number;
      name?: string;
      mime?: string;
    }
  | {
      type: "file";
      url: string;
      name: string;
      size?: number;
      mime?: string;
    };

interface ReeditBlockRestoreHandlers {
  restoreBlock(block: ReeditBlock): void | Promise<void>;
  onBlockError(block: ReeditBlock, error: unknown): void;
  onComplete(): void;
}

interface MentionEntity {
  uid: string;
  offset: number;
  length: number;
}

interface MessageMention {
  all?: boolean | number;
  humans?: number;
  ais?: number;
  uids?: string[];
  entities?: MentionEntity[];
}

export const MAX_REEDIT_FILE_BYTES = 100 * 1024 * 1024;

export async function restoreReeditableMessageBlocks(
  blocks: ReeditBlock[],
  handlers: ReeditBlockRestoreHandlers
): Promise<void> {
  try {
    for (const block of blocks) {
      try {
        await handlers.restoreBlock(block);
      } catch (error) {
        handlers.onBlockError(block, error);
      }
    }
  } finally {
    handlers.onComplete();
  }
}

export function canReeditRevokedMessage(
  message: MessageWrap,
  myUid: string | null | undefined
): boolean {
  if (!myUid || !message.revoke) return false;
  const revoker = message.revoker || message.fromUID;
  if (revoker !== myUid || message.fromUID !== myUid) return false;
  return getReeditableMessageBlocks(message).length > 0;
}

export function getReeditableMessageBlocks(
  message: MessageWrap
): ReeditBlock[] {
  if (message.contentType === MessageContentType.image) {
    const image = message.content as ImageContent;
    const url = image.url || image.remoteUrl || "";
    if (!url) return [];
    return [
      {
        type: "image",
        url,
        width: image.width,
        height: image.height,
        name: image.name || "image.png",
      },
    ];
  }

  if (message.contentType === MessageContentTypeConst.file) {
    const file = message.content as FileContent;
    const url = file.url || file.remoteUrl || "";
    if (!url) return [];
    return [
      {
        type: "file",
        url,
        name: file.name || "file",
        size: file.size,
        mime: file.extension ? `application/${file.extension}` : undefined,
      },
    ];
  }

  if (message.contentType === MessageContentTypeConst.richText) {
    return getReeditableRichTextBlocks(message);
  }

  if (message.contentType !== MessageContentType.text) return [];
  const text = (message.content as MessageText).text || "";
  if (text.trim() === "") return [];
  return [
    { type: "content", content: getTextMessageInlineContent(message, text) },
  ];
}

export async function remoteReeditFileToFile(input: {
  url: string;
  name: string;
  size?: number;
  mime?: string;
}): Promise<File | null> {
  if (!input.url || (input.size && input.size > MAX_REEDIT_FILE_BYTES)) {
    return null;
  }
  try {
    const response = await fetch(input.url, {
      mode: "cors",
      credentials: "omit",
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("Content-Length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REEDIT_FILE_BYTES
    ) {
      return null;
    }
    const blob = await response.blob();
    if (blob.size > MAX_REEDIT_FILE_BYTES) return null;
    const rawName = (input.name || "file")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 160);
    const contentType = (blob.type || input.mime || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return new File([blob], rawName || "file", {
      type: contentType,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

function getReeditableRichTextBlocks(message: MessageWrap): ReeditBlock[] {
  const richText = message.content as RichTextContent;
  const blocks: ReeditBlock[] = [];
  const mention = readMessageMention(message.content);
  let plainOffset = 0;
  for (const block of richText.content || []) {
    if (block.type === RichTextBlockType.image) {
      if (block.url) {
        blocks.push({
          type: "image",
          url: block.url,
          width: block.width,
          height: block.height,
          size: block.size,
          name: block.name,
          mime: block.mime,
        });
      }
      plainOffset += RichTextImagePlaceholder.length;
      continue;
    }
    if (block.type === RichTextBlockType.file) {
      const label = block.name
        ? `${RichTextFilePlaceholder} ${block.name}`
        : RichTextFilePlaceholder;
      if (block.url) {
        blocks.push({
          type: "file",
          url: block.url,
          name: block.name || "file",
          size: block.size,
          mime:
            block.mime ||
            (block.extension ? `application/${block.extension}` : undefined),
        });
      } else {
        blocks.push({ type: "content", content: textToInlineContent(label) });
      }
      plainOffset += label.length;
      continue;
    }
    const text = block.text || "";
    if (text.trim() !== "") {
      blocks.push({
        type: "content",
        content: buildInlineContent(
          text,
          rebaseMentionEntitiesForBlock(mention, plainOffset, text.length)
        ),
      });
    }
    plainOffset += text.length;
  }
  return blocks;
}

function rebaseMentionEntitiesForBlock(
  mention: MessageMention | undefined,
  blockOffset: number,
  blockLength: number
): MessageMention | undefined {
  if (!mention?.entities?.length) return mention;
  const blockEnd = blockOffset + blockLength;
  return {
    ...mention,
    // Structured entities are authoritative. Do not fall back to assigning
    // whole-message positional uids when this block has no matching entity.
    uids: [],
    entities: mention.entities
      .filter(
        (entity) =>
          entity &&
          typeof entity.uid === "string" &&
          Number.isFinite(entity.offset) &&
          Number.isFinite(entity.length) &&
          entity.offset >= blockOffset &&
          entity.length > 0 &&
          entity.offset + entity.length <= blockEnd
      )
      .map((entity) => ({
        ...entity,
        offset: entity.offset - blockOffset,
      })),
  };
}

function getTextMessageInlineContent(
  message: MessageWrap,
  text: string
): JSONContent[] {
  const parts = message.parts || [];
  if (parts.map((part) => part.text).join("") !== text) {
    return buildInlineContent(text, readMessageMention(message.content));
  }

  const nodes: JSONContent[] = [];
  const flags = readMentionFlags(message.content);
  for (const part of parts) {
    if (
      part.type === PartType.mention &&
      typeof part.data?.uid === "string" &&
      part.data.uid !== "all"
    ) {
      nodes.push({
        type: "mention",
        attrs: {
          id: part.data.uid,
          label: part.text.startsWith("@") ? part.text.slice(1) : part.text,
        },
      });
      continue;
    }
    appendTextWithBroadcastMentions(nodes, part.text, flags);
  }
  return nodes;
}

function readMessageMention(content: unknown): MessageMention | undefined {
  if (!content || typeof content !== "object") return undefined;
  const value = content as {
    mention?: MessageMention;
    contentObj?: { mention?: MessageMention };
  };
  const mention = value.mention;
  const rawMention = value.contentObj?.mention;
  if (!mention && !rawMention) return undefined;
  return {
    all: mention?.all ?? rawMention?.all,
    humans: mention?.humans ?? rawMention?.humans,
    ais: mention?.ais ?? rawMention?.ais,
    uids: mention?.uids ?? rawMention?.uids,
    entities: mention?.entities ?? rawMention?.entities,
  };
}

function buildInlineContent(
  text: string,
  mention?: MessageMention
): JSONContent[] {
  const nodes: JSONContent[] = [];
  const entities = (mention?.entities || [])
    .filter(
      (entity) =>
        entity &&
        typeof entity.uid === "string" &&
        Number.isFinite(entity.offset) &&
        Number.isFinite(entity.length) &&
        entity.offset >= 0 &&
        entity.length > 0 &&
        entity.offset + entity.length <= text.length
    )
    .sort((a, b) => a.offset - b.offset);

  if (entities.length === 0) {
    appendTextWithLegacyMentions(nodes, text, mention);
    return nodes;
  }

  let cursor = 0;
  for (const entity of entities) {
    if (entity.offset < cursor) continue;
    appendTextWithBroadcastMentions(
      nodes,
      text.slice(cursor, entity.offset),
      mention
    );
    const raw = text.slice(entity.offset, entity.offset + entity.length);
    const label = raw.startsWith("@") ? raw.slice(1) : "";
    if (!label) {
      appendText(nodes, raw);
    } else {
      nodes.push({
        type: "mention",
        attrs: {
          id: normalizeMentionUid(entity.uid),
          label,
        },
      });
    }
    cursor = entity.offset + entity.length;
  }
  appendTextWithBroadcastMentions(nodes, text.slice(cursor), mention);
  return nodes;
}

function appendTextWithLegacyMentions(
  nodes: JSONContent[],
  text: string,
  mention?: MessageMention
): void {
  const uids = mention?.ais ? [] : mention?.uids || [];
  if (uids.length === 0) {
    appendTextWithBroadcastMentions(nodes, text, mention);
    return;
  }
  const regex = /@[\w\u4e00-\u9fa5.\-]+/gm;
  let cursor = 0;
  let uidIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null && uidIndex < uids.length) {
    const label = match[0].slice(1);
    if (isBroadcastLabel(label)) continue;
    appendTextWithBroadcastMentions(
      nodes,
      text.slice(cursor, match.index),
      mention
    );
    nodes.push({
      type: "mention",
      attrs: { id: uids[uidIndex++], label },
    });
    cursor = match.index + match[0].length;
  }
  appendTextWithBroadcastMentions(nodes, text.slice(cursor), mention);
}

function appendTextWithBroadcastMentions(
  nodes: JSONContent[],
  text: string,
  flags?: Pick<MessageMention, "all" | "humans" | "ais">
): void {
  const supportsHumans = !!flags?.humans || (!!flags?.all && !flags?.ais);
  const supportsAis = !!flags?.ais;
  if (!supportsHumans && !supportsAis) {
    appendText(nodes, text);
    return;
  }

  const patterns: string[] = [];
  if (supportsHumans) patterns.push(`@${MENTION_LABEL_HUMANS}`, "@all");
  if (supportsAis) patterns.push(`@${MENTION_LABEL_AIS}`);
  const regex = new RegExp(patterns.join("|"), "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    appendText(nodes, text.slice(cursor, match.index));
    const isAis = match[0] === `@${MENTION_LABEL_AIS}`;
    nodes.push({
      type: "mention",
      attrs: {
        id: isAis ? MENTION_UID_AIS : MENTION_UID_HUMANS,
        label: isAis ? MENTION_LABEL_AIS : MENTION_LABEL_HUMANS,
      },
    });
    cursor = match.index + match[0].length;
  }
  appendText(nodes, text.slice(cursor));
}

function appendText(nodes: JSONContent[], text: string): void {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    if (line) nodes.push({ type: "text", text: line });
  });
}

function textToInlineContent(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  appendText(nodes, text);
  return nodes;
}

function normalizeMentionUid(uid: string): string {
  if (uid === MENTION_UID_AIS) return MENTION_UID_AIS;
  if (
    uid === MENTION_UID_LEGACY_ALL ||
    uid === MENTION_UID_HUMANS ||
    uid === "all"
  ) {
    return MENTION_UID_HUMANS;
  }
  return isBroadcastSentinelUid(uid) ? MENTION_UID_HUMANS : uid;
}

function isBroadcastLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    label === MENTION_LABEL_HUMANS ||
    label === MENTION_LABEL_AIS ||
    normalized === "all" ||
    normalized === "everyone"
  );
}
