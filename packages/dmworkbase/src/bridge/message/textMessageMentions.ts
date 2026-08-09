import {
  buildMessageMentions,
  isBroadcastSentinelUid,
  MENTION_LABEL_AIS,
  MENTION_LABEL_HUMANS,
  readMentionFlags,
  type MentionRenderFlags,
  type MentionRenderInfo,
  type MentionRenderPart,
} from "../../Utils/mentionRender";

interface MentionEntity {
  uid: string;
  offset: number;
  length: number;
}

interface MentionSource {
  uids?: string[];
  entities?: MentionEntity[];
}

function getMentionSource(content: unknown): MentionSource | undefined {
  if (!content || typeof content !== "object") return undefined;
  const c = content as {
    mention?: MentionSource;
    contentObj?: { mention?: MentionSource };
  };
  const mention = c.mention;
  const contentObjMention = c.contentObj?.mention;
  if (!mention && !contentObjMention) return undefined;
  return {
    uids: mention?.uids ?? contentObjMention?.uids,
    entities: mention?.entities ?? contentObjMention?.entities,
  };
}

function getText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as { text?: unknown; contentObj?: { content?: unknown } };
  if (typeof c.text === "string") return c.text;
  return typeof c.contentObj?.content === "string" ? c.contentObj.content : "";
}

function isValidEntity(entity: unknown, textLength: number): entity is MentionEntity {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
    return false;
  }
  const e = entity as MentionEntity;
  return (
    typeof e.uid === "string" &&
    typeof e.offset === "number" &&
    typeof e.length === "number" &&
    Number.isFinite(e.offset) &&
    Number.isFinite(e.length) &&
    e.offset >= 0 &&
    e.length > 0 &&
    e.offset + e.length <= textLength
  );
}

function partsFromEntities(
  text: string,
  entities: unknown[] | undefined,
  partMentionType: number,
): MentionRenderPart[] {
  const validEntities = (entities ?? [])
    .filter((entity): entity is MentionEntity => isValidEntity(entity, text.length))
    .sort((a, b) => a.offset - b.offset);

  const result: MentionRenderPart[] = [];
  let lastEnd = 0;
  for (const entity of validEntities) {
    if (entity.offset < lastEnd) {
      continue;
    }
    const entityEnd = entity.offset + entity.length;
    lastEnd = entityEnd;
    if (isBroadcastSentinelUid(entity.uid)) {
      continue;
    }
    const name = text.slice(entity.offset, entity.offset + entity.length);
    if (!name.startsWith("@")) {
      continue;
    }
    result.push({ type: partMentionType, text: name, data: { uid: entity.uid } });
  }
  return result;
}

function hasEmbeddedMentionPrefix(text: string, matchStart: number): boolean {
  if (matchStart <= 0) return false;
  const charBefore = text.charCodeAt(matchStart - 1);
  return (
    (charBefore >= 97 && charBefore <= 122) ||
    (charBefore >= 65 && charBefore <= 90) ||
    (charBefore >= 48 && charBefore <= 57) ||
    charBefore === 95
  );
}

function partsFromLegacyUids(
  text: string,
  uids: unknown[] | undefined,
  flags: MentionRenderFlags | undefined,
  partMentionType: number,
): MentionRenderPart[] {
  if (flags?.ais) return [];

  const uidQueue = (uids ?? []).filter((uid): uid is string => typeof uid === "string");
  if (uidQueue.length === 0) return [];

  const result: MentionRenderPart[] = [];
  const mentionRegex = /@[\w\u4e00-\u9fa5.\-]+/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = mentionRegex.exec(text)) !== null && index < uidQueue.length) {
    const name = match[0];
    const label = name.slice(1);
    if (hasEmbeddedMentionPrefix(text, match.index)) {
      continue;
    }
    if (
      label.toLowerCase() === "all" ||
      label === MENTION_LABEL_HUMANS ||
      label === MENTION_LABEL_AIS
    ) {
      continue;
    }
    result.push({
      type: partMentionType,
      text: name,
      data: { uid: uidQueue[index] },
    });
    index += 1;
  }
  return result;
}

function getMentionParts(args: {
  parts: MentionRenderPart[];
  content: unknown;
  editContent?: unknown;
  flags?: MentionRenderFlags;
  partMentionType: number;
}): MentionRenderPart[] {
  const mentionParts = args.parts.filter(
    (part) => part.type === args.partMentionType && !!part.data?.uid,
  );
  if (mentionParts.length > 0) return mentionParts;

  const effectiveContent = args.editContent ?? args.content;
  const text = getText(effectiveContent);
  const mention = getMentionSource(effectiveContent);
  const entityParts = partsFromEntities(
    text,
    mention?.entities,
    args.partMentionType,
  );
  if (entityParts.length > 0) return entityParts;

  return partsFromLegacyUids(text, mention?.uids, args.flags, args.partMentionType);
}

export function buildTextMessageMentions(args: {
  parts: MentionRenderPart[];
  content: unknown;
  editContent?: unknown;
  partMentionType: number;
}): MentionRenderInfo[] {
  const flags =
    readMentionFlags(args.editContent) ?? readMentionFlags(args.content);
  const parts = getMentionParts({ ...args, flags });

  return buildMessageMentions(parts, flags, args.partMentionType);
}
