import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import WKApp from "../../App";
import GlobalMessageSearchService, {
  type GlobalMessageGroupWire,
  type GlobalMessageGroupsResponseWire,
} from "../../Service/GlobalMessageSearchService";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { createSearchAssetResolver } from "../search/createSearchAssetResolver";
import {
  cleanGlobalFilters,
  truncateChannelSearchKeyword,
} from "../../Service/SearchService";
import {
  mapCombinedHit,
  mapMessageHit,
  type CombinedSearchHit,
  type MessageSearchHit,
} from "../../Service/SearchResultMapper";
import type {
  ChannelSearchItem,
  ChannelSearchQuery,
} from "../../Service/SearchTypes";
import type {
  GlobalSearchDataSource,
  GlobalSearchFilters,
} from "../../Service/SearchTypes";
import {
  canRunGlobalGroupSearch,
  drillDownFilters,
  type GlobalChatSearchConversation,
} from "./model";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

interface OverviewState {
  status: "idle" | "loading" | "ready" | "error";
  conversations: GlobalChatSearchConversation[];
  total: number;
  isTotalApproximate: boolean;
  isTruncated: boolean;
}

interface ResultState {
  status: "idle" | "loading" | "ready" | "error";
  items: ChannelSearchItem[];
  hasMore: boolean;
  nextCursor?: string;
  isLoadingMore: boolean;
}

interface UseGlobalChatSearchOptions {
  keyword: string;
  filters: GlobalSearchFilters;
  dataSource: GlobalSearchDataSource;
  isActive: boolean;
}

const idleOverview: OverviewState = {
  status: "idle",
  conversations: [],
  total: 0,
  isTotalApproximate: true,
  isTruncated: false,
};

const idleResult: ResultState = {
  status: "idle",
  items: [],
  hasMore: false,
  isLoadingMore: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCombinedSearchHit(value: unknown): value is CombinedSearchHit {
  if (!isRecord(value)) return false;
  return (
    value.result_type === "message" ||
    value.result_type === "file" ||
    value.result_type === "media"
  );
}

function isMessageSearchHit(value: unknown): value is MessageSearchHit {
  if (!isRecord(value)) return false;
  return (
    typeof value.message_id === "string" ||
    typeof value.message_seq === "number"
  );
}

function isCancelledRequest(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "ERR_CANCELED" || error.name === "CanceledError")
    return true;
  return "error" in error && isCancelledRequest(error.error);
}

function previewQuery(
  keyword: string,
  filters: GlobalSearchFilters
): ChannelSearchQuery {
  return {
    channelId: "",
    channelType: 0,
    keyword,
    tab: "all",
    filters: {
      senderUids: filters.senderUids,
      sort: "time_desc",
      datePreset: filters.datePreset,
      startAt: filters.startAt,
      endAt: filters.endAt,
    },
    limit: PAGE_SIZE,
  };
}

function mapPreview(
  preview: unknown[] | undefined,
  group: GlobalMessageGroupWire,
  keyword: string,
  filters: GlobalSearchFilters
) {
  const query = previewQuery(keyword, filters);
  const assets = createSearchAssetResolver();
  return (preview ?? [])
    .map((hit) => {
      if (isCombinedSearchHit(hit)) {
        return mapCombinedHit(
          {
            ...hit,
            message: hit.message
              ? {
                  ...hit.message,
                  channel_id: hit.message.channel_id || group.channel_id,
                  channel_type: hit.message.channel_type ?? group.channel_type,
                }
              : undefined,
            file: hit.file
              ? {
                  ...hit.file,
                  channel_id: hit.file.channel_id || group.channel_id,
                  channel_type: hit.file.channel_type ?? group.channel_type,
                }
              : undefined,
            media: hit.media
              ? {
                  ...hit.media,
                  channel_id: hit.media.channel_id || group.channel_id,
                  channel_type: hit.media.channel_type ?? group.channel_type,
                }
              : undefined,
          },
          query,
          assets
        );
      }
      if (isMessageSearchHit(hit)) {
        return mapMessageHit(
          {
            ...hit,
            channel_id: hit.channel_id || group.channel_id,
            channel_type: hit.channel_type ?? group.channel_type,
          },
          query,
          assets
        );
      }
      return undefined;
    })
    .filter((item): item is ChannelSearchItem => Boolean(item));
}

function conversationPresentation(
  group: GlobalMessageGroupWire,
  dataSource: GlobalSearchDataSource
) {
  const channelId = group.channel_id || "";
  const channelType = group.channel_type ?? 0;
  const isThread = channelType === ChannelTypeCommunityTopic;
  const isDM = channelType === ChannelTypePerson;
  const avatarChannelId = isThread
    ? group.parent_group_no || channelId
    : channelId;
  const avatarChannelType = isThread ? ChannelTypeGroup : channelType;
  const fallbackName = isDM ? dataSource.getSender(channelId).name : channelId;
  return {
    name: (isThread ? group.thread_name : group.group_name) || fallbackName,
    subtitle: isThread ? group.group_name : undefined,
    avatarUrl: isDM
      ? dataSource.getSender(channelId).avatarUrl ||
        WKApp.shared.avatarUser(channelId)
      : WKApp.shared.avatarChannel(
          new Channel(avatarChannelId, avatarChannelType)
        ),
  };
}

function mapOverviewResponse(
  response: GlobalMessageGroupsResponseWire,
  keyword: string,
  filters: GlobalSearchFilters,
  dataSource: GlobalSearchDataSource
): OverviewState {
  const groups = Array.isArray(response.data?.groups)
    ? response.data.groups
    : [];
  const conversations = groups
    .filter(
      (group) =>
        Boolean(group.channel_id) && typeof group.channel_type === "number"
    )
    .map((group) => {
      const channelId = group.channel_id || "";
      const channelType = group.channel_type ?? 0;
      const presentation = conversationPresentation(group, dataSource);
      return {
        key: `${channelType}:${channelId}`,
        channelId,
        channelType,
        parentGroupNo: group.parent_group_no,
        ...presentation,
        matchCount: Math.max(0, group.match_count ?? 0),
        isMatchCountApproximate: group.match_count_approx !== false,
        preview: mapPreview(group.preview, group, keyword, filters),
      };
    });

  return {
    status: "ready",
    conversations,
    total: Math.max(0, response.data?.total_groups ?? conversations.length),
    isTotalApproximate: response.data?.total_groups_approx !== false,
    isTruncated: Boolean(response.pagination?.has_more),
  };
}

export function useGlobalChatSearch({
  keyword,
  filters,
  dataSource,
  isActive,
}: UseGlobalChatSearchOptions) {
  const [overview, setOverview] = useState<OverviewState>(idleOverview);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [result, setResult] = useState<ResultState>(idleResult);
  const sequenceRef = useRef(0);
  const overviewAbortRef = useRef<AbortController>();
  const resultAbortRef = useRef<AbortController>();
  const loadingMoreRef = useRef(false);

  const selectedConversation = useMemo(
    () => overview.conversations.find((item) => item.key === selectedKey),
    [overview.conversations, selectedKey]
  );

  useEffect(() => {
    overviewAbortRef.current?.abort();
    resultAbortRef.current?.abort();
    setSelectedKey(undefined);
    setResult(idleResult);

    if (!isActive || !canRunGlobalGroupSearch(keyword, filters)) {
      setOverview(idleOverview);
      return;
    }

    setOverview({ ...idleOverview, status: "loading" });
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const timer = window.setTimeout(async () => {
      try {
        const response = await GlobalMessageSearchService.searchGroups(
          {
            keyword: truncateChannelSearchKeyword(keyword.trim()),
            sequence,
            filters: cleanGlobalFilters(
              filters,
              "messages",
              keyword,
              dataSource.getSelfUid()
            ),
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (
          typeof response.data?.sequence === "number" &&
          response.data.sequence !== sequence
        ) {
          return;
        }
        const next = mapOverviewResponse(
          response,
          keyword,
          filters,
          dataSource
        );
        setOverview(next);
        setSelectedKey(next.conversations[0]?.key);
      } catch (error) {
        if (!controller.signal.aborted && !isCancelledRequest(error)) {
          setOverview({ ...idleOverview, status: "error" });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dataSource, filters, isActive, keyword]);

  useEffect(() => {
    resultAbortRef.current?.abort();
    loadingMoreRef.current = false;
    if (!isActive || !selectedConversation) {
      setResult(idleResult);
      return;
    }

    const controller = new AbortController();
    resultAbortRef.current = controller;
    setResult({
      status: "loading",
      items: selectedConversation.preview,
      hasMore: false,
      isLoadingMore: false,
    });

    void dataSource
      .searchMessages({
        tab: "messages",
        keyword,
        filters: drillDownFilters(filters, selectedConversation),
        limit: PAGE_SIZE,
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        setResult({
          status: "ready",
          items: response.items,
          hasMore: response.hasMore,
          nextCursor: response.nextCursor,
          isLoadingMore: false,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || isCancelledRequest(error)) return;
        setResult((current) => ({
          ...current,
          status: current.items.length > 0 ? "ready" : "error",
          isLoadingMore: false,
        }));
      });

    return () => controller.abort();
  }, [dataSource, filters, isActive, keyword, selectedConversation]);

  const loadMore = useCallback(async () => {
    if (
      !selectedConversation ||
      !result.hasMore ||
      !result.nextCursor ||
      loadingMoreRef.current
    ) {
      return;
    }
    const controller = resultAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    loadingMoreRef.current = true;
    setResult((current) => ({ ...current, isLoadingMore: true }));
    try {
      const response = await dataSource.searchMessages({
        tab: "messages",
        keyword,
        filters: drillDownFilters(filters, selectedConversation),
        cursor: result.nextCursor,
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
      if (controller.signal.aborted || resultAbortRef.current !== controller) {
        return;
      }
      setResult((current) => ({
        status: "ready",
        items: [...current.items, ...response.items],
        hasMore: response.hasMore,
        nextCursor: response.nextCursor,
        isLoadingMore: false,
      }));
    } catch (error) {
      if (
        !controller.signal.aborted &&
        resultAbortRef.current === controller &&
        !isCancelledRequest(error)
      ) {
        setResult((current) => ({ ...current, isLoadingMore: false }));
      }
    } finally {
      if (resultAbortRef.current === controller) {
        loadingMoreRef.current = false;
      }
    }
  }, [
    dataSource,
    filters,
    keyword,
    result.hasMore,
    result.nextCursor,
    selectedConversation,
  ]);

  return {
    overview,
    selectedKey,
    selectedConversation,
    result,
    selectConversation: setSelectedKey,
    loadMore,
  };
}

export default useGlobalChatSearch;
