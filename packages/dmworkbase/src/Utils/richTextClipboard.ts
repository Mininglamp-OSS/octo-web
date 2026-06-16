import {
  RichTextBlock,
  RichTextBlockType,
  RichTextContent,
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
} from "../Messages/RichText/RichTextContent";

export const OCTO_RICHTEXT_CLIPBOARD_ATTR = "data-octo-richtext";

export interface OctoRichTextClipboardMention {
  uid: string;
  offset: number;
  length: number;
}

export type OctoRichTextClipboardBlock =
  | {
      type: "text";
      text: string;
      mentions?: OctoRichTextClipboardMention[];
    }
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
      name?: string;
    };

export interface OctoRichTextClipboardPayload {
  version: 1;
  blocks: OctoRichTextClipboardBlock[];
  plain?: string;
}

interface RichTextMentionEntity {
  uid: string;
  offset: number;
  length: number;
}

const MAX_BLOCKS = 100;
const MAX_TEXT_LENGTH = 20_000;
const MAX_IMAGES = 20;
const MAX_IMAGE_URL_LENGTH = 4096;
const MAX_ENCODED_PAYLOAD_LENGTH = 256_000;

function getMentionEntities(content: RichTextContent): RichTextMentionEntity[] {
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

function getTextBlockMentions(
  text: string,
  plainOffset: number,
  entities: RichTextMentionEntity[]
): OctoRichTextClipboardMention[] {
  const end = plainOffset + text.length;
  return entities
    .filter(
      (entity) =>
        entity.offset >= plainOffset && entity.offset + entity.length <= end
    )
    .map((entity) => ({
      uid: entity.uid,
      offset: entity.offset - plainOffset,
      length: entity.length,
    }));
}

export function buildOctoRichTextClipboardPayload(
  content: RichTextContent
): OctoRichTextClipboardPayload {
  const entities = getMentionEntities(content);
  let plainOffset = 0;
  const blocks: OctoRichTextClipboardBlock[] = [];

  for (const block of content.content || []) {
    if (blocks.length >= MAX_BLOCKS) break;

    if (block.type === RichTextBlockType.image && block.url) {
      blocks.push({
        type: "image",
        url: block.url,
        width: block.width,
        height: block.height,
        size: block.size,
        name: block.name,
        mime: block.mime,
      });
      plainOffset += getBlockPlainLength(block);
      continue;
    }

    if (block.type === RichTextBlockType.file) {
      blocks.push({ type: "file", name: block.name });
      plainOffset += getBlockPlainLength(block);
      continue;
    }

    const text = block.text || "";
    if (block.type === RichTextBlockType.text || text) {
      const mentions = getTextBlockMentions(text, plainOffset, entities);
      blocks.push({
        type: "text",
        text,
        mentions: mentions.length > 0 ? mentions : undefined,
      });
    }
    plainOffset += getBlockPlainLength(block);
  }

  return {
    version: 1,
    blocks,
    plain: content.plain || undefined,
  };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeOctoRichTextClipboardPayload(
  payload: OctoRichTextClipboardPayload
): string {
  return encodeBase64Url(JSON.stringify(payload));
}

function normalizeMention(
  mention: any,
  textLength: number
): OctoRichTextClipboardMention | null {
  if (
    !mention ||
    typeof mention.uid !== "string" ||
    !Number.isFinite(mention.offset) ||
    !Number.isFinite(mention.length)
  ) {
    return null;
  }
  const offset = Math.floor(mention.offset);
  const length = Math.floor(mention.length);
  if (offset < 0 || length <= 0 || offset + length > textLength) {
    return null;
  }
  return { uid: mention.uid, offset, length };
}

function normalizePayload(raw: any): OctoRichTextClipboardPayload | null {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.blocks)) {
    return null;
  }

  let totalTextLength = 0;
  let imageCount = 0;
  const blocks: OctoRichTextClipboardBlock[] = [];

  for (const block of raw.blocks.slice(0, MAX_BLOCKS)) {
    if (!block || typeof block.type !== "string") continue;

    if (block.type === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      if (!text) continue;
      const remaining = MAX_TEXT_LENGTH - totalTextLength;
      if (remaining <= 0) break;
      const safeText = text.slice(0, remaining);
      totalTextLength += safeText.length;
      const mentions = Array.isArray(block.mentions)
        ? block.mentions
            .map((mention: any) => normalizeMention(mention, safeText.length))
            .filter(
              (
                mention: OctoRichTextClipboardMention | null
              ): mention is OctoRichTextClipboardMention => mention !== null
            )
        : [];
      blocks.push({
        type: "text",
        text: safeText,
        mentions: mentions.length > 0 ? mentions : undefined,
      });
      continue;
    }

    if (block.type === "image") {
      if (imageCount >= MAX_IMAGES || typeof block.url !== "string") continue;
      const url = block.url.slice(0, MAX_IMAGE_URL_LENGTH);
      if (!url) continue;
      imageCount += 1;
      blocks.push({
        type: "image",
        url,
        width: Number.isFinite(block.width) ? block.width : undefined,
        height: Number.isFinite(block.height) ? block.height : undefined,
        size: Number.isFinite(block.size) ? block.size : undefined,
        name: typeof block.name === "string" ? block.name : undefined,
        mime: typeof block.mime === "string" ? block.mime : undefined,
      });
      continue;
    }

    if (block.type === "file") {
      blocks.push({
        type: "file",
        name: typeof block.name === "string" ? block.name : undefined,
      });
    }
  }

  return {
    version: 1,
    blocks,
    plain: typeof raw.plain === "string" ? raw.plain : undefined,
  };
}

export function decodeOctoRichTextClipboardPayload(
  encoded: string
): OctoRichTextClipboardPayload | null {
  if (!encoded || encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) return null;
  try {
    return normalizePayload(JSON.parse(decodeBase64Url(encoded)));
  } catch {
    return null;
  }
}

const octoRichTextAttrPattern =
  /(?:^|[\s<])data-octo-richtext\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function extractOctoRichTextMarker(html: string): string {
  const match = html.match(octoRichTextAttrPattern);
  const encoded = match?.[1] || match?.[2] || match?.[3] || "";
  if (!encoded || !base64UrlPattern.test(encoded)) return "";
  return encoded;
}

export function extractOctoRichTextClipboardPayloadFromHtml(
  html: string
): OctoRichTextClipboardPayload | null {
  if (!html) return null;
  return decodeOctoRichTextClipboardPayload(extractOctoRichTextMarker(html));
}
