import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import {
  CombinedSearchHit,
  FileSearchHit,
  MediaSearchHit,
  MessageSearchHit,
  cleanFilters,
  countChannelSearchKeywordRunes as internalCountChannelSearchKeywordRunes,
  hasEffectiveFilters,
  mapCombinedHit,
  mapFileHit,
  mapForwardInnerMessage,
  mapMediaHit,
  mapMessageHit,
  mapMessageMediaHit,
  monthBucketFromSentAt,
  normalizeItems,
  normalizeRichText,
  optionalSentAtToSeconds,
  parentGroupChannel,
  secondsToDateOnly,
  sentAtToSeconds,
} from "./internal";
import type {
  ChannelSearchDataSource,
  ChannelSearchItem,
  ChannelSearchQuery,
  ChannelSearchSender,
  ChannelSearchTab,
} from "./types";

const PAGE_SIZE_SENDERS = 50;
export const CHANNEL_SEARCH_KEYWORD_MAX_RUNES = 64;

export function countChannelSearchKeywordRunes(keyword: string) {
  return internalCountChannelSearchKeywordRunes(keyword);
}

export function truncateChannelSearchKeyword(keyword: string) {
  return Array.from(keyword)
    .slice(0, CHANNEL_SEARCH_KEYWORD_MAX_RUNES)
    .join("");
}

function searchEndpoint(tab: ChannelSearchTab) {
  if (tab === "all") return "messages/_search_all";
  if (tab === "message") return "messages/_search";
  if (tab === "media") return "messages/_search_media";
  return "messages/_search_files";
}

// Only send empty-keyword requests to all/message tabs when a real filter is
// present. Media/file tabs support browse mode directly.
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

  const keyword = truncateChannelSearchKeyword(query.keyword.trim());
  if (query.tab === "all" || query.tab === "message") {
    body.keyword = keyword;
  } else if (query.tab === "file" && keyword) {
    body.keyword = keyword;
  }

  return body;
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
      let pagination;

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
  optionalSentAtToSeconds,
  secondsToDateOnly,
  monthBucketFromSentAt,
  normalizeItems,
  cleanFilters,
  countChannelSearchKeywordRunes,
  hasEffectiveFilters,
  shouldRunSearch,
  truncateChannelSearchKeyword,
  toRequestBody,
  mapForwardInnerMessage,
  normalizeRichText,
  mapMessageMediaHit,
  mapMessageHit,
  mapFileHit,
  mapMediaHit,
  mapCombinedHit,
  parentGroupChannel,
};
