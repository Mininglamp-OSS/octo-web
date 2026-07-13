import {
  Channel,
  ChannelTypeGroup,
} from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import type {
  ChannelSearchFileInfo,
  ChannelSearchFilters,
  ChannelSearchForwardInnerMessage,
  ChannelSearchItem,
  ChannelSearchMediaInfo,
  ChannelSearchQuery,
  ChannelSearchRichTextInfo,
  ChannelSearchRichTextMention,
  ChannelSearchSender,
} from "./types";

export type SearchPagination = {
  has_more?: boolean;
  next_cursor?: string;
};

export type SearchEnvelope<T> = {
  data?: T[];
  pagination?: SearchPagination;
};

export type MessageSearchHit = {
  message_id?: string;
  message_seq?: number;
  message_kind?: "text" | "forward" | "quote" | "image" | "video";
  snippet?: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar_url?: string;
  sent_at?: string;
  outer_preview?: {
    title?: string;
    child_count?: number;
    quoted?: {
      sender_name?: string;
      text?: string;
      placeholder?: string;
    };
  };
  inner_messages?: ForwardInnerMessageHit[];
  channel_id?: string;
  channel_type?: number;
  thumb_url?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  rich_text?: RichTextSearchHit;
};

export type ForwardInnerMessageHit = {
  message_id?: string;
  type?: number;
  search_text?: string;
  sender_id?: string;
  sender_name?: string;
  sent_at?: string;
};

export type RichTextSearchBlock = {
  type?: string;
  text?: string;
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  name?: string;
  extension?: string;
  mime?: string;
  caption?: string;
};

export type RichTextSearchMentionEntity = {
  uid?: string;
  offset?: number;
  length?: number;
};

export type RichTextSearchHit = {
  content?: RichTextSearchBlock[];
  plain?: string;
  mention?: {
    entities?: RichTextSearchMentionEntity[];
    all?: number;
    humans?: number;
    ais?: number;
  };
};

export type MediaSearchHit = {
  message_id?: string;
  message_seq?: number;
  media_kind?: "image" | "video";
  url?: string;
  media_url?: string;
  file_url?: string;
  image_url?: string;
  video_url?: string;
  download_url?: string;
  preview_url?: string | null;
  thumb_url?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  sender_id?: string;
  sender_name?: string;
  sender_avatar_url?: string;
  sent_at?: string;
  month_bucket?: string;
  channel_id?: string;
  channel_type?: number;
};

export type FileSearchHit = {
  message_id?: string;
  message_seq?: number;
  file_name?: string;
  file_size_bytes?: number;
  file_ext?: string;
  download_url?: string;
  preview_url?: string | null;
  sender_id?: string;
  sender_name?: string;
  sender_avatar_url?: string;
  sent_at?: string;
  channel_id?: string;
  channel_type?: number;
};

export type CombinedSearchHit = {
  result_type?: "message" | "file" | "media";
  sorted_at?: string;
  message?: MessageSearchHit;
  file?: FileSearchHit;
  media?: MediaSearchHit;
};

export function countChannelSearchKeywordRunes(keyword: string) {
  return Array.from(keyword).length;
}

export function sentAtToSeconds(value?: string) {
  if (!value) return Math.floor(Date.now() / 1000);
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return Math.floor(Date.now() / 1000);
  return Math.floor(time / 1000);
}

export function optionalSentAtToSeconds(value?: string) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return undefined;
  return Math.floor(time / 1000);
}

export function normalizeImageUrl(path?: string) {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const normalizedPath = path.replace(/^\/+/, "");
  const commonDataSource = WKApp.dataSource?.commonDataSource;
  if (commonDataSource?.getImageURL) {
    return commonDataSource.getImageURL(normalizedPath);
  }
  const baseURL = WKApp.apiClient.config.apiURL || "";
  return `${baseURL}${normalizedPath}`;
}

export function normalizeFileUrl(path?: string | null) {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const normalizedPath = path.replace(/^\/+/, "");
  const commonDataSource = WKApp.dataSource?.commonDataSource;
  if (commonDataSource?.getFileURL) {
    return commonDataSource.getFileURL(normalizedPath);
  }
  const baseURL = WKApp.apiClient.config.apiURL || "";
  return `${baseURL}${normalizedPath}`;
}

export function normalizeMediaUrl(
  path: string | null | undefined,
  mediaKind?: "image" | "video"
) {
  return mediaKind === "image"
    ? normalizeImageUrl(path || undefined)
    : normalizeFileUrl(path);
}

export function secondsToDateOnly(seconds?: number) {
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthBucketFromSentAt(sentAt?: string) {
  const date = sentAt ? new Date(sentAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

export function normalizeItems<T>(resp: SearchEnvelope<T> | T[] | undefined): {
  items: T[];
  pagination?: SearchPagination;
} {
  if (Array.isArray(resp)) {
    return { items: resp };
  }
  return {
    items: Array.isArray(resp?.data) ? resp.data : [],
    pagination: resp?.pagination,
  };
}

export function cleanFilters(filters: ChannelSearchFilters) {
  const next: Record<string, unknown> = {};
  if (filters.senderUids.length > 0) {
    next.sender_ids = filters.senderUids.slice(0, 50);
  }
  const sentAtFrom = secondsToDateOnly(filters.startAt);
  const sentAtTo = secondsToDateOnly(filters.endAt);
  if (sentAtFrom) next.sent_at_from = sentAtFrom;
  if (sentAtTo) next.sent_at_to = sentAtTo;
  return next;
}

export function hasEffectiveFilters(filters: ChannelSearchFilters) {
  return Object.keys(cleanFilters(filters)).length > 0;
}

export function senderFromHit(hit: {
  sender_id?: string;
  sender_name?: string;
  sender_avatar_url?: string;
}): ChannelSearchSender {
  const uid = hit.sender_id || "";
  return {
    uid,
    name: hit.sender_name || uid,
    avatarUrl: normalizeImageUrl(hit.sender_avatar_url),
  };
}

export function channelFromHit(
  hit: { channel_id?: string; channel_type?: number },
  fallback: { channelId: string; channelType: number }
) {
  return {
    channelId: hit.channel_id || fallback.channelId,
    channelType:
      typeof hit.channel_type === "number"
        ? hit.channel_type
        : fallback.channelType,
  };
}

export function mapForwardInnerMessage(
  hit: ForwardInnerMessageHit
): ChannelSearchForwardInnerMessage {
  return {
    messageId: hit.message_id || "",
    type: typeof hit.type === "number" ? hit.type : 0,
    text: hit.search_text || "",
    senderUid: hit.sender_id || undefined,
    senderName: hit.sender_name || undefined,
    timestamp: optionalSentAtToSeconds(hit.sent_at),
  };
}

export function normalizeRichTextMention(
  mention?: RichTextSearchHit["mention"]
): ChannelSearchRichTextMention | undefined {
  if (!mention) return undefined;
  const entities = Array.isArray(mention.entities)
    ? mention.entities
        .filter(
          (entity): entity is Required<RichTextSearchMentionEntity> =>
            typeof entity?.uid === "string" &&
            Number.isFinite(entity.offset) &&
            Number.isFinite(entity.length) &&
            (entity.offset || 0) >= 0 &&
            (entity.length || 0) > 0
        )
        .map((entity) => ({
          uid: entity.uid,
          offset: entity.offset,
          length: entity.length,
        }))
    : undefined;

  return {
    entities,
    all: mention.all,
    humans: mention.humans,
    ais: mention.ais,
  };
}

export function normalizeRichText(
  richText?: RichTextSearchHit
): ChannelSearchRichTextInfo | undefined {
  if (!richText) return undefined;
  const content = Array.isArray(richText.content)
    ? richText.content
        .filter(
          (block): block is RichTextSearchBlock & { type: string } =>
            typeof block?.type === "string" && block.type.length > 0
        )
        .map((block) => ({
          type: block.type,
          text: block.text,
          url: block.url,
          width: block.width,
          height: block.height,
          size: block.size,
          name: block.name,
          extension: block.extension,
          mime: block.mime,
          caption: block.caption,
        }))
    : [];

  if (content.length === 0 && !richText.plain) {
    return undefined;
  }

  return {
    content,
    plain: richText.plain,
    mention: normalizeRichTextMention(richText.mention),
  };
}

export function mapMessageMediaHit(
  hit: MessageSearchHit,
  query: ChannelSearchQuery,
  mediaKind: "image" | "video"
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, {
    channelId: query.channelId,
    channelType: query.channelType,
  });
  const sentAt = hit.sent_at || "";
  const thumbUrl = normalizeImageUrl(hit.thumb_url);
  const media: ChannelSearchMediaInfo = {
    url: mediaKind === "image" ? thumbUrl : undefined,
    previewUrl: mediaKind === "image" ? thumbUrl : undefined,
    thumbUrl,
    duration:
      typeof hit.duration_ms === "number"
        ? Math.round(hit.duration_ms / 1000)
        : undefined,
    width: hit.width,
    height: hit.height,
    monthBucket: monthBucketFromSentAt(sentAt),
    tone: mediaKind === "video" ? "purple" : "cool",
  };

  return {
    id: hit.message_id || `${hit.message_seq || 0}`,
    messageId: hit.message_id || "",
    messageSeq: hit.message_seq || 0,
    channelId: hitChannel.channelId,
    channelType: hitChannel.channelType,
    senderUid: sender.uid,
    sender,
    timestamp: sentAtToSeconds(sentAt),
    kind: mediaKind,
    text: hit.snippet || "",
    matchReason: hit.snippet,
    media,
  };
}

export function mapMessageHit(
  hit: MessageSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, {
    channelId: query.channelId,
    channelType: query.channelType,
  });
  const sentAt = hit.sent_at || "";
  const messageKind = hit.message_kind || "text";
  if (messageKind === "image" || messageKind === "video") {
    return mapMessageMediaHit(hit, query, messageKind);
  }

  const richText = normalizeRichText(hit.rich_text);
  const kind =
    messageKind === "forward"
      ? "merge_forward"
      : messageKind === "quote"
      ? "quote"
      : "text";
  const text = hit.snippet || richText?.plain || "";

  return {
    id: hit.message_id || `${hit.message_seq || 0}`,
    messageId: hit.message_id || "",
    messageSeq: hit.message_seq || 0,
    channelId: hitChannel.channelId,
    channelType: hitChannel.channelType,
    senderUid: sender.uid,
    sender,
    timestamp: sentAtToSeconds(sentAt),
    kind,
    text,
    matchReason: hit.snippet || richText?.plain,
    richText,
    forward:
      messageKind === "forward"
        ? {
            title: hit.outer_preview?.title || "",
            snippets: [],
            innerMessages: Array.isArray(hit.inner_messages)
              ? hit.inner_messages.map(mapForwardInnerMessage)
              : undefined,
            childCount: hit.outer_preview?.child_count,
          }
        : undefined,
  };
}

export function mapFileHit(
  hit: FileSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, {
    channelId: query.channelId,
    channelType: query.channelType,
  });
  const file: ChannelSearchFileInfo = {
    name: hit.file_name || "",
    size: hit.file_size_bytes || 0,
    extension: hit.file_ext,
    url: hit.preview_url || hit.download_url || "",
    downloadUrl: hit.download_url,
    previewUrl: hit.preview_url,
  };
  return {
    id: hit.message_id || `${hit.message_seq || 0}`,
    messageId: hit.message_id || "",
    messageSeq: hit.message_seq || 0,
    channelId: hitChannel.channelId,
    channelType: hitChannel.channelType,
    senderUid: sender.uid,
    sender,
    timestamp: sentAtToSeconds(hit.sent_at),
    kind: "file",
    file,
  };
}

export function mapMediaHit(
  hit: MediaSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, {
    channelId: query.channelId,
    channelType: query.channelType,
  });
  const mediaKind = hit.media_kind || "image";
  const previewUrl = normalizeMediaUrl(hit.preview_url, mediaKind);
  const downloadUrl = normalizeFileUrl(hit.download_url);
  const mediaUrl =
    previewUrl ||
    normalizeMediaUrl(
      hit.media_url ||
        hit.url ||
        hit.file_url ||
        hit.image_url ||
        hit.video_url,
      mediaKind
    ) ||
    downloadUrl;
  const media: ChannelSearchMediaInfo = {
    url: mediaUrl,
    previewUrl,
    downloadUrl,
    thumbUrl: normalizeImageUrl(hit.thumb_url),
    duration:
      typeof hit.duration_ms === "number"
        ? Math.round(hit.duration_ms / 1000)
        : undefined,
    width: hit.width,
    height: hit.height,
    monthBucket: hit.month_bucket || monthBucketFromSentAt(hit.sent_at),
    tone: mediaKind === "video" ? "purple" : "cool",
  };
  return {
    id: hit.message_id || `${hit.message_seq || 0}`,
    messageId: hit.message_id || "",
    messageSeq: hit.message_seq || 0,
    channelId: hitChannel.channelId,
    channelType: hitChannel.channelType,
    senderUid: sender.uid,
    sender,
    timestamp: sentAtToSeconds(hit.sent_at),
    kind: mediaKind === "video" ? "video" : "image",
    media,
  };
}

export function mapCombinedHit(
  hit: CombinedSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem | undefined {
  if (hit.result_type === "file" && hit.file) {
    const item = mapFileHit(hit.file, query);
    if (hit.sorted_at) item.timestamp = sentAtToSeconds(hit.sorted_at);
    return item;
  }
  if (hit.result_type === "message" && hit.message) {
    const item = mapMessageHit(hit.message, query);
    if (hit.sorted_at) item.timestamp = sentAtToSeconds(hit.sorted_at);
    return item;
  }
  if (hit.result_type === "media" && hit.media) {
    const item = mapMediaHit(hit.media, query);
    if (hit.sorted_at) item.timestamp = sentAtToSeconds(hit.sorted_at);
    return item;
  }
  if (import.meta.env.DEV) {
    console.warn("[ChannelSearch] unknown combined search hit", hit);
  }
  return undefined;
}

export function parentGroupChannel(channel: Channel) {
  if (channel.channelType !== ChannelTypeCommunityTopic) return channel;
  const parsed = parseThreadChannelId(channel.channelID);
  return parsed ? new Channel(parsed.groupNo, ChannelTypeGroup) : channel;
}
