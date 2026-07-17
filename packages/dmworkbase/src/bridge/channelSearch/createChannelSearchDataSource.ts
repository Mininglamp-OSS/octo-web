import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import { createSearchAssetResolver } from "../search/createSearchAssetResolver";
import {
  cleanFilters,
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
} from "../../Service/SearchResultMapper";
import SearchService, {
  CHANNEL_SEARCH_KEYWORD_MAX_RUNES,
  channelSearchEndpoint,
  countChannelSearchKeywordRunes,
  shouldRunChannelSearch,
  toChannelSearchRequestBody,
  truncateChannelSearchKeyword,
} from "../../Service/SearchService";
import type {
  ChannelSearchDataSource,
  ChannelSearchSender,
} from "../../Service/SearchTypes";

const PAGE_SIZE_SENDERS = 50;

export {
  CHANNEL_SEARCH_KEYWORD_MAX_RUNES,
  countChannelSearchKeywordRunes,
  truncateChannelSearchKeyword,
};

export const shouldRunSearch = shouldRunChannelSearch;

export function createChannelSearchApiDataSource(
  channel: Channel
): ChannelSearchDataSource {
  const senderCache = new Map<string, ChannelSearchSender>();
  const rememberSender = (sender?: ChannelSearchSender) => {
    if (sender?.uid) senderCache.set(sender.uid, sender);
  };

  return {
    getSenders: () => Array.from(senderCache.values()),
    getSender: (uid) => senderCache.get(uid) || { uid, name: uid },
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
        { keyword: keyword.trim(), page: 1, limit: PAGE_SIZE_SENDERS }
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
      const result = await SearchService.searchChannelMessages(
        query,
        createSearchAssetResolver()
      );
      result.items.forEach((item) => rememberSender(item.sender));
      return result;
    },
  };
}

const assets = () => createSearchAssetResolver();

export const channelSearchApiAdapterTestUtils = {
  searchEndpoint: channelSearchEndpoint,
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
  toRequestBody: toChannelSearchRequestBody,
  mapForwardInnerMessage,
  normalizeRichText,
  mapMessageMediaHit: (
    hit: Parameters<typeof mapMessageMediaHit>[0],
    query: Parameters<typeof mapMessageMediaHit>[1],
    kind: Parameters<typeof mapMessageMediaHit>[2]
  ) => mapMessageMediaHit(hit, query, kind, assets()),
  mapMessageHit: (
    hit: Parameters<typeof mapMessageHit>[0],
    query: Parameters<typeof mapMessageHit>[1]
  ) => mapMessageHit(hit, query, assets()),
  mapFileHit: (
    hit: Parameters<typeof mapFileHit>[0],
    query: Parameters<typeof mapFileHit>[1]
  ) => mapFileHit(hit, query, assets()),
  mapMediaHit: (
    hit: Parameters<typeof mapMediaHit>[0],
    query: Parameters<typeof mapMediaHit>[1]
  ) => mapMediaHit(hit, query, assets()),
  mapCombinedHit: (
    hit: Parameters<typeof mapCombinedHit>[0],
    query: Parameters<typeof mapCombinedHit>[1]
  ) => mapCombinedHit(hit, query, assets()),
  parentGroupChannel,
};
