import {
  CombinedSearchHit,
  FileSearchHit,
  mapCombinedHit,
  mapFileHit,
  normalizeItems,
  SearchPagination,
} from "../ChannelSearch/internal";
import { truncateChannelSearchKeyword } from "../ChannelSearch/apiAdapter";
import type {
  ChannelSearchItem,
  ChannelSearchQuery,
} from "../ChannelSearch/types";
import type {
  GlobalContentTab,
  GlobalSearchFilters,
  GlobalSearchQuery,
  GlobalSearchResponse,
} from "./types";

// Server always parses `sent_at` day boundaries in Asia/Shanghai (see backend
// §7.3). `secondsToDateOnly` on ChannelSearch uses the browser's local
// timezone, which would be off-by-one on non-CN browsers → we ship our own
// CN-tz day formatter for GlobalSearch. See §11.
const CN_TZ = "Asia/Shanghai";

export function secondsToDateOnlyCN(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(seconds * 1000));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return undefined;
  return `${y}-${m}-${d}`;
}

export function globalSearchEndpoint(tab: GlobalContentTab): string {
  return tab === "files"
    ? "messages/_search_global_files"
    : "messages/_search_global_messages";
}

export const GLOBAL_SEARCH_FILE_TYPES_ENDPOINT = "messages/_search_file_types";

function normalizeContentTypes(
  keyword: string,
  contentTypes: number[]
): number[] {
  // Image (2) / video (5) can only match in browse-mode. When there is a
  // keyword we drop them so we don't send an "impossible" filter. Empty list
  // → let server apply the default white list (§7.1).
  const trimmed = keyword.trim().length > 0;
  const cleaned = contentTypes.filter((type) => {
    if (!Number.isFinite(type)) return false;
    if (trimmed && (type === 2 || type === 5)) return false;
    return true;
  });
  return cleaned;
}

export function cleanGlobalFilters(
  filters: GlobalSearchFilters,
  tab: GlobalContentTab,
  keyword: string,
  selfUid?: string
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  if (filters.senderUids.length > 0) {
    next.sender_ids = filters.senderUids.slice(0, 50);
  }
  // member_uid = self is a no-op per §6.4. UI already hides self, but tolerate
  // callers that leak self by dropping the field here.
  if (filters.memberUid && filters.memberUid !== selfUid) {
    next.member_uid = filters.memberUid;
  }
  if (filters.channels.length > 0) {
    next.channel_ids = filters.channels.map((c) => ({
      channel_id: c.channelId,
      channel_type: c.channelType,
    }));
  }
  if (filters.channelTypes.length > 0) {
    next.channel_types = Array.from(new Set(filters.channelTypes));
  }
  const from = secondsToDateOnlyCN(filters.startAt);
  const to = secondsToDateOnlyCN(filters.endAt);
  if (from) next.sent_at_from = from;
  if (to) next.sent_at_to = to;

  if (tab === "messages") {
    const contentTypes = normalizeContentTypes(keyword, filters.contentTypes);
    if (contentTypes.length > 0) next.content_types = contentTypes;
  } else {
    if (filters.fileExts.length > 0) {
      next.file_exts = filters.fileExts.map((ext) =>
        ext.trim().toLowerCase().replace(/^\./, "")
      );
    }
    if (typeof filters.fileSizeMin === "number" && filters.fileSizeMin > 0) {
      next.file_size_min = Math.floor(filters.fileSizeMin);
    }
    if (typeof filters.fileSizeMax === "number" && filters.fileSizeMax > 0) {
      next.file_size_max = Math.floor(filters.fileSizeMax);
    }
  }

  return next;
}

export function hasEffectiveGlobalFilters(filters: GlobalSearchFilters) {
  return (
    filters.senderUids.length > 0 ||
    !!filters.memberUid ||
    filters.channels.length > 0 ||
    filters.channelTypes.length > 0 ||
    filters.contentTypes.length > 0 ||
    filters.fileExts.length > 0 ||
    (typeof filters.fileSizeMin === "number" && filters.fileSizeMin > 0) ||
    (typeof filters.fileSizeMax === "number" && filters.fileSizeMax > 0) ||
    !!filters.datePreset ||
    !!filters.startAt ||
    !!filters.endAt
  );
}

// Messages tab needs keyword or a real filter (backend rejects fully-empty
// searches). Files tab supports empty-keyword browse. Do NOT reuse
// ChannelSearch's shouldRunSearch: it inspects `tab !== "all" && tab !==
// "message"` and our tab name is "messages" (plural) → it would let empty
// searches through and get a 400.
export function shouldRunGlobalSearch(
  tab: GlobalContentTab,
  keyword: string,
  filters: GlobalSearchFilters
) {
  if (tab === "files") return true;
  return keyword.trim().length > 0 || hasEffectiveGlobalFilters(filters);
}

export function toGlobalRequestBody(
  query: GlobalSearchQuery,
  selfUid?: string
): Record<string, unknown> {
  const keyword = truncateChannelSearchKeyword(query.keyword.trim());
  const body: Record<string, unknown> = {
    keyword,
    sort: query.filters.sort,
    page_size: query.limit,
    cursor: query.cursor || "",
    filters: cleanGlobalFilters(
      query.filters,
      query.tab,
      query.keyword,
      selfUid
    ),
  };
  return body;
}

// Build a synthetic ChannelSearchQuery to feed the reused ChannelSearch
// mappers (mapCombinedHit / mapFileHit). Only channel context matters —
// mappers use it as a fallback when a hit omits its own channel; global
// backend always fills channel_id/channel_type so the fallback is unused,
// but the parameter is required by the ChannelSearch shape.
function synthChannelQuery(query: GlobalSearchQuery): ChannelSearchQuery {
  return {
    channelId: "",
    channelType: 0,
    keyword: query.keyword,
    tab: query.tab === "files" ? "file" : "all",
    filters: {
      senderUids: query.filters.senderUids,
      sort:
        query.filters.sort === "relevance" ? "time_desc" : query.filters.sort,
      datePreset: query.filters.datePreset,
      startAt: query.filters.startAt,
      endAt: query.filters.endAt,
    },
    cursor: query.cursor,
    limit: query.limit,
  };
}

export function mapMessagesResponse(
  resp: unknown,
  query: GlobalSearchQuery
): { items: ChannelSearchItem[]; pagination?: SearchPagination } {
  const normalized = normalizeItems<CombinedSearchHit>(
    resp as { data?: CombinedSearchHit[]; pagination?: SearchPagination }
  );
  const synth = synthChannelQuery(query);
  const items = normalized.items
    .map((hit) => mapCombinedHit(hit, synth))
    .filter((item): item is ChannelSearchItem => !!item);
  return { items, pagination: normalized.pagination };
}

export function mapFilesResponse(
  resp: unknown,
  query: GlobalSearchQuery
): { items: ChannelSearchItem[]; pagination?: SearchPagination } {
  const normalized = normalizeItems<FileSearchHit>(
    resp as { data?: FileSearchHit[]; pagination?: SearchPagination }
  );
  const synth = synthChannelQuery(query);
  const items = normalized.items.map((hit) => mapFileHit(hit, synth));
  return { items, pagination: normalized.pagination };
}

export function foldResponse(
  items: ChannelSearchItem[],
  pagination?: SearchPagination
): GlobalSearchResponse {
  return {
    items,
    nextCursor: pagination?.next_cursor || undefined,
    hasMore: !!pagination?.has_more,
  };
}
