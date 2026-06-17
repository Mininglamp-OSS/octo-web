import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import type {
  ChannelSearchDataSource,
  ChannelSearchFileInfo,
  ChannelSearchFilters,
  ChannelSearchItem,
  ChannelSearchMediaInfo,
  ChannelSearchQuery,
  ChannelSearchResponse,
  ChannelSearchSender,
  ChannelSearchTab,
} from "./types";

type SearchPagination = {
  has_more?: boolean;
  next_cursor?: string;
};

type SearchEnvelope<T> = {
  data?: T[];
  pagination?: SearchPagination;
};

type MessageSearchHit = {
  message_id?: string;
  message_seq?: number;
  message_kind?: "text" | "forward" | "quote";
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
  channel_id?: string;
  channel_type?: number;
};

type MediaSearchHit = {
  message_id?: string;
  message_seq?: number;
  media_kind?: "image" | "video";
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

type FileSearchHit = {
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

type CombinedSearchHit = {
  result_type?: "message" | "file" | "media";
  sorted_at?: string;
  message?: MessageSearchHit;
  file?: FileSearchHit;
  media?: MediaSearchHit;
};

const PAGE_SIZE_SENDERS = 50;

function searchEndpoint(tab: ChannelSearchTab) {
  if (tab === "all") return "messages/_search_all";
  if (tab === "message") return "messages/_search";
  if (tab === "media") return "messages/_search_media";
  return "messages/_search_files";
}

function sentAtToSeconds(value?: string) {
  if (!value) return Math.floor(Date.now() / 1000);
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return Math.floor(Date.now() / 1000);
  return Math.floor(time / 1000);
}

function normalizeImageUrl(path?: string) {
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

function secondsToDateOnly(seconds?: number) {
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthBucketFromSentAt(sentAt?: string) {
  const date = sentAt ? new Date(sentAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function normalizeItems<T>(resp: SearchEnvelope<T> | T[] | undefined): {
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

function cleanFilters(filters: ChannelSearchFilters) {
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

function hasEffectiveFilters(filters: ChannelSearchFilters) {
  return Object.keys(cleanFilters(filters)).length > 0;
}

// Decide whether a search request should actually be sent. Only the keyword-
// optional endpoints `_search` (message tab) and `_search_all` (all tab) carry
// the backend empty-search guard (validateSearchNotEmpty): with an empty keyword
// AND no effective filter they fail-fast with 400. Mirror that guard here so an
// empty panel never fires a request that is guaranteed to 400 — it falls back to
// the empty-state view instead. The media (`_search_media`) and file
// (`_search_files`) tabs have no such backend guard and legitimately browse
// without a keyword, so they always run.
export function shouldRunSearch(
  query: Pick<ChannelSearchQuery, "keyword" | "filters" | "tab">
) {
  if (query.tab !== "all" && query.tab !== "message") {
    return true;
  }
  return query.keyword.trim().length > 0 || hasEffectiveFilters(query.filters);
}

function toRequestBody(query: ChannelSearchQuery) {
  const body: Record<string, unknown> = {
    channel_type: query.channelType,
    channel_id: query.channelId,
    filters: cleanFilters(query.filters),
    sort: query.filters.sort,
    page_size: query.limit,
    cursor: query.cursor || "",
  };

  const keyword = query.keyword.trim();
  if (query.tab === "all" || query.tab === "message") {
    body.keyword = keyword;
  } else if (query.tab === "file" && keyword) {
    body.keyword = keyword;
  }

  return body;
}

function senderFromHit(hit: {
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

function channelFromHit(
  hit: { channel_id?: string; channel_type?: number },
  query: ChannelSearchQuery
) {
  return {
    channelId: hit.channel_id || query.channelId,
    channelType:
      typeof hit.channel_type === "number"
        ? hit.channel_type
        : query.channelType,
  };
}

function mapMessageHit(
  hit: MessageSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, query);
  const sentAt = hit.sent_at || "";
  const messageKind = hit.message_kind || "text";
  const kind =
    messageKind === "forward"
      ? "merge_forward"
      : messageKind === "quote"
      ? "quote"
      : "text";

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
    text: hit.snippet || "",
    matchReason: hit.snippet,
    forward:
      messageKind === "forward"
        ? {
            title: hit.outer_preview?.title || "",
            snippets: [],
            childCount: hit.outer_preview?.child_count,
          }
        : undefined,
  };
}

function mapFileHit(
  hit: FileSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, query);
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

function mapMediaHit(
  hit: MediaSearchHit,
  query: ChannelSearchQuery
): ChannelSearchItem {
  const sender = senderFromHit(hit);
  const hitChannel = channelFromHit(hit, query);
  const media: ChannelSearchMediaInfo = {
    thumbUrl: hit.thumb_url,
    duration: hit.duration_ms,
    width: hit.width,
    height: hit.height,
    monthBucket: hit.month_bucket || monthBucketFromSentAt(hit.sent_at),
    tone: hit.media_kind === "video" ? "purple" : "cool",
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
    kind: hit.media_kind === "video" ? "video" : "image",
    media,
  };
}

function mapCombinedHit(
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

function parentGroupChannel(channel: Channel) {
  if (channel.channelType !== ChannelTypeCommunityTopic) return channel;
  const parsed = parseThreadChannelId(channel.channelID);
  return parsed ? new Channel(parsed.groupNo, ChannelTypeGroup) : channel;
}

export function createChannelSearchApiDataSource(
  channel: Channel
): ChannelSearchDataSource {
  const senderCache = new Map<string, ChannelSearchSender>();

  const rememberSender = (sender?: ChannelSearchSender) => {
    if (!sender?.uid) return;
    senderCache.set(sender.uid, sender);
  };

  return {
    getSenders: () => Array.from(senderCache.values()),
    getSender: (uid) =>
      senderCache.get(uid) || {
        uid,
        name: uid,
      },
    searchSenders: async (keyword) => {
      if (channel.channelType === ChannelTypePerson) {
        const selfUid = WKApp.loginInfo.uid || "";
        const self: ChannelSearchSender = {
          uid: selfUid,
          name:
            WKApp.loginInfo.selfDisplayName?.() ||
            WKApp.loginInfo.name ||
            selfUid,
          avatarUrl: selfUid ? WKApp.shared.avatarUser(selfUid) : undefined,
          isCurrentMember: true,
        };
        const peerInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
        const peer: ChannelSearchSender = {
          uid: channel.channelID,
          name: peerInfo?.title || channel.channelID,
          avatarUrl: WKApp.shared.avatarUser(channel.channelID),
          isCurrentMember: true,
        };
        [self, peer].forEach(rememberSender);
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [self, peer].filter((sender) =>
          `${sender.name}${sender.uid}`
            .toLowerCase()
            .includes(normalizedKeyword)
        );
      }

      const lookupChannel = parentGroupChannel(channel);
      if (lookupChannel.channelType !== ChannelTypeGroup) {
        return Array.from(senderCache.values());
      }

      const subscribers = await WKApp.dataSource.channelDataSource.subscribers(
        lookupChannel,
        {
          keyword: keyword.trim(),
          page: 1,
          limit: PAGE_SIZE_SENDERS,
        }
      );
      const senders = subscribers.map((subscriber) => ({
        uid: subscriber.uid,
        name: subscriber.remark || subscriber.name || subscriber.uid,
        avatarUrl: subscriber.avatar || WKApp.shared.avatarUser(subscriber.uid),
        isCurrentMember: true,
      }));
      senders.forEach(rememberSender);
      return senders;
    },
    searchMessages: async (query) => {
      const resp = await WKApp.apiClient.post(
        searchEndpoint(query.tab),
        toRequestBody(query)
      );

      let items: ChannelSearchItem[] = [];
      let pagination: SearchPagination | undefined;

      if (query.tab === "all") {
        const normalized = normalizeItems<CombinedSearchHit>(resp);
        pagination = normalized.pagination;
        items = normalized.items
          .map((hit) => mapCombinedHit(hit, query))
          .filter((item): item is ChannelSearchItem => !!item);
      } else if (query.tab === "media") {
        const normalized = normalizeItems<MediaSearchHit>(resp);
        pagination = normalized.pagination;
        items = normalized.items.map((hit) => mapMediaHit(hit, query));
      } else if (query.tab === "file") {
        const normalized = normalizeItems<FileSearchHit>(resp);
        pagination = normalized.pagination;
        items = normalized.items.map((hit) => mapFileHit(hit, query));
      } else {
        const normalized = normalizeItems<MessageSearchHit>(resp);
        pagination = normalized.pagination;
        items = normalized.items.map((hit) => mapMessageHit(hit, query));
      }

      items.forEach((item) => rememberSender(item.sender));
      return {
        items,
        nextCursor: pagination?.next_cursor || undefined,
        hasMore: !!pagination?.has_more,
      };
    },
  };
}

export const channelSearchApiAdapterTestUtils = {
  searchEndpoint,
  sentAtToSeconds,
  secondsToDateOnly,
  monthBucketFromSentAt,
  normalizeItems,
  cleanFilters,
  hasEffectiveFilters,
  shouldRunSearch,
  toRequestBody,
  mapMessageHit,
  mapFileHit,
  mapMediaHit,
  mapCombinedHit,
  parentGroupChannel,
};
