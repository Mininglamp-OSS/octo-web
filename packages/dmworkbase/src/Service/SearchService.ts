import {
  CombinedSearchHit,
  FileSearchHit,
  MediaSearchHit,
  MessageSearchHit,
  type SearchAssetResolver,
  cleanFilters,
  countChannelSearchKeywordRunes,
  hasEffectiveFilters,
  mapCombinedHit,
  mapFileHit,
  mapMediaHit,
  mapMessageHit,
  normalizeItems,
  SearchPagination,
} from "./SearchResultMapper";
import APIClient from "./APIClient";
import type {
  ChannelSearchItem,
  ChannelSearchQuery,
  ChannelSearchResponse,
  ChannelSearchTab,
  GlobalContentTab,
  GlobalSearchFileTypeCategory,
  GlobalSearchFilters,
  GlobalSearchQuery,
  GlobalSearchResponse,
} from "./SearchTypes";

export const CHANNEL_SEARCH_KEYWORD_MAX_RUNES = 64;

export function truncateChannelSearchKeyword(keyword: string) {
  return Array.from(keyword)
    .slice(0, CHANNEL_SEARCH_KEYWORD_MAX_RUNES)
    .join("");
}

export function channelSearchEndpoint(tab: ChannelSearchTab) {
  if (tab === "all") return "messages/_search_all";
  if (tab === "message") return "messages/_search";
  if (tab === "media") return "messages/_search_media";
  return "messages/_search_files";
}

export function shouldRunChannelSearch(
  query: Pick<ChannelSearchQuery, "keyword" | "filters" | "tab">
) {
  if (query.tab !== "all" && query.tab !== "message") return true;
  return query.keyword.trim().length > 0 || hasEffectiveFilters(query.filters);
}

export function toChannelSearchRequestBody(query: ChannelSearchQuery) {
  const body: Record<string, unknown> = {
    channel_type: query.channelType,
    channel_id: query.channelId,
    filters: cleanFilters(query.filters),
    sort: query.filters.sort,
    page_size: query.limit,
    cursor: query.cursor || "",
  };
  const keyword = truncateChannelSearchKeyword(query.keyword.trim());
  if (query.tab === "all" || query.tab === "message") body.keyword = keyword;
  else if (query.tab === "file" && keyword) body.keyword = keyword;
  return body;
}

// Server always parses `sent_at` day boundaries in Asia/Shanghai (see backend
// §7.3). `secondsToDateOnly` on ChannelSearch uses the browser's local
// timezone, which would be off-by-one on non-CN browsers → we ship our own
// CN-tz day formatter for GlobalSearch. See §11.
const CN_TZ = "Asia/Shanghai";

// Split a Date into CN-tz Y/M/D (numeric). Extracted so both the wire
// serializer and the datePreset boundary math share one code path.
function cnCalendarParts(
  date: Date
): { y: number; m: number; d: number } | undefined {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const ys = parts.find((p) => p.type === "year")?.value;
  const ms = parts.find((p) => p.type === "month")?.value;
  const ds = parts.find((p) => p.type === "day")?.value;
  if (!ys || !ms || !ds) return undefined;
  return { y: Number(ys), m: Number(ms), d: Number(ds) };
}

export function secondsToDateOnlyCN(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  const parts = cnCalendarParts(new Date(seconds * 1000));
  if (!parts) return undefined;
  const mm = String(parts.m).padStart(2, "0");
  const dd = String(parts.d).padStart(2, "0");
  return `${parts.y}-${mm}-${dd}`;
}

// datePreset day-boundary math must run in Asia/Shanghai (§11). Doing it in
// the browser tz lets a non-CN user's "today" straddle two CN calendar days,
// which — after secondsToDateOnlyCN serialization — becomes
// sent_at_from=D, sent_at_to=D+1 on the wire. We instead take the CN
// calendar day the given instant falls on, subtract N-1 days in CN calendar
// arithmetic (via UTC midnight of that CN date, which is safe because the
// CN offset is a fixed +08:00), then convert back to epoch seconds anchored
// at the CN midnight of the resulting day.
function cnMidnightUtcMs(y: number, m: number, d: number): number {
  // 00:00:00 in +08:00 == (day 16:00 UTC of previous calendar day).
  return Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
}

// Start (inclusive) of CN-day containing `at`, expressed as epoch seconds.
export function startOfCnDaySeconds(at: Date): number | undefined {
  const parts = cnCalendarParts(at);
  if (!parts) return undefined;
  return Math.floor(cnMidnightUtcMs(parts.y, parts.m, parts.d) / 1000);
}

// Exclusive end (== next-day CN midnight) minus 1 second, matching the
// existing sent_at_to inclusive-day convention.
export function endOfCnDaySeconds(at: Date): number | undefined {
  const parts = cnCalendarParts(at);
  if (!parts) return undefined;
  return Math.floor(cnMidnightUtcMs(parts.y, parts.m, parts.d + 1) / 1000) - 1;
}

// Compute [startAt, endAt] epoch seconds for a datePreset, anchored to CN.
// `nDays`: 1 for "today", 7 for "last_7_days", 30 for "last_30_days".
// The window ends at end-of-CN-today and starts at start-of-CN-(today-(N-1)).
export function cnDatePresetRange(
  nDays: number,
  now: Date = new Date()
): { startAt?: number; endAt?: number } {
  const todayParts = cnCalendarParts(now);
  if (!todayParts) return {};
  const startMs = cnMidnightUtcMs(
    todayParts.y,
    todayParts.m,
    todayParts.d - (nDays - 1)
  );
  const endMs =
    cnMidnightUtcMs(todayParts.y, todayParts.m, todayParts.d + 1) - 1000;
  return {
    startAt: Math.floor(startMs / 1000),
    endAt: Math.floor(endMs / 1000),
  };
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
  // member_uids: drop self (§6.4 no-op) and dedup. Empty array → omit the
  // field entirely so the server sees «no member filter» rather than an
  // explicit empty list. Wire field is `member_uids` (plural), replacing the
  // legacy single-value `member_uid` under YUJ-30 bug 5.
  const memberUids = Array.from(
    new Set(filters.memberUids.filter((uid) => uid && uid !== selfUid))
  );
  if (memberUids.length > 0) {
    next.member_uids = memberUids;
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
    filters.memberUids.length > 0 ||
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

// Both tabs now fire even without a keyword / filter (bug 3, YUJ-30). The
// backend `_search_global_messages` accepts empty keyword — aligning with the
// per-channel `_search_all` browse behavior — and the batched-allowlist path
// (§6.2) keeps browse-mode cost bounded (ms-level per user's allowlist). Do
// NOT reuse ChannelSearch's shouldRunSearch: it inspects `tab !== "all" &&
// tab !== "message"` and our tab name is "messages" (plural), so it would
// short-circuit the wrong branch.
export function shouldRunGlobalSearch(
  _tab: GlobalContentTab,
  _keyword: string,
  _filters: GlobalSearchFilters
) {
  return true;
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
  query: GlobalSearchQuery,
  assets?: SearchAssetResolver
): { items: ChannelSearchItem[]; pagination?: SearchPagination } {
  const normalized = normalizeItems<CombinedSearchHit>(
    resp as { data?: CombinedSearchHit[]; pagination?: SearchPagination }
  );
  const synth = synthChannelQuery(query);
  const items = normalized.items
    .map((hit) => mapCombinedHit(hit, synth, assets))
    .filter((item): item is ChannelSearchItem => !!item);
  return { items, pagination: normalized.pagination };
}

export function mapFilesResponse(
  resp: unknown,
  query: GlobalSearchQuery,
  assets?: SearchAssetResolver
): { items: ChannelSearchItem[]; pagination?: SearchPagination } {
  const normalized = normalizeItems<FileSearchHit>(
    resp as { data?: FileSearchHit[]; pagination?: SearchPagination }
  );
  const synth = synthChannelQuery(query);
  const items = normalized.items.map((hit) => mapFileHit(hit, synth, assets));
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

export interface LegacyGlobalSearchRequest {
  keyword: string;
  page: number;
  limit: number;
  contentTypes: number[];
  channelId?: string;
  channelType?: number;
  onlyMessage?: boolean;
  spaceId?: string;
}

export interface LegacyGlobalSearchContact {
  channel_id: string;
  channel_type: number;
  channel_name?: string;
  channel_remark?: string;
  [key: string]: unknown;
}

export interface LegacyGlobalSearchMessage {
  from_uid?: string;
  message_seq?: number;
  payload?: Record<string, unknown> & { type?: number };
  channel: LegacyGlobalSearchContact;
  content?: unknown;
  [key: string]: unknown;
}

export interface LegacyGlobalSearchResponse {
  friends?: LegacyGlobalSearchContact[];
  groups?: LegacyGlobalSearchContact[];
  messages: LegacyGlobalSearchMessage[];
}

const SearchService = {
  async searchChannelMessages(
    query: ChannelSearchQuery,
    assets?: SearchAssetResolver
  ): Promise<ChannelSearchResponse> {
    const resp = await APIClient.shared.post(
      channelSearchEndpoint(query.tab),
      toChannelSearchRequestBody(query)
    );

    let items: ChannelSearchItem[] = [];
    let pagination: SearchPagination | undefined;
    if (query.tab === "all") {
      const normalized = normalizeItems<CombinedSearchHit>(resp);
      pagination = normalized.pagination;
      items = normalized.items
        .map((hit) => mapCombinedHit(hit, query, assets))
        .filter((item): item is ChannelSearchItem => !!item);
    } else if (query.tab === "media") {
      const normalized = normalizeItems<MediaSearchHit>(resp);
      pagination = normalized.pagination;
      items = normalized.items.map((hit) => mapMediaHit(hit, query, assets));
    } else if (query.tab === "file") {
      const normalized = normalizeItems<FileSearchHit>(resp);
      pagination = normalized.pagination;
      items = normalized.items.map((hit) => mapFileHit(hit, query, assets));
    } else {
      const normalized = normalizeItems<MessageSearchHit>(resp);
      pagination = normalized.pagination;
      items = normalized.items.map((hit) => mapMessageHit(hit, query, assets));
    }
    return foldResponse(items, pagination);
  },

  async searchGlobalMessages(
    query: GlobalSearchQuery,
    selfUid?: string,
    assets?: SearchAssetResolver
  ): Promise<GlobalSearchResponse> {
    const resp = await APIClient.shared.post(
      globalSearchEndpoint(query.tab),
      toGlobalRequestBody(query, selfUid),
      { signal: query.signal }
    );
    const { items, pagination } =
      query.tab === "files"
        ? mapFilesResponse(resp, query, assets)
        : mapMessagesResponse(resp, query, assets);
    return foldResponse(items, pagination);
  },

  async getGlobalFileTypes(
    signal?: AbortSignal
  ): Promise<GlobalSearchFileTypeCategory[]> {
    const response = await APIClient.shared.get<unknown>(
      GLOBAL_SEARCH_FILE_TYPES_ENDPOINT,
      { signal }
    );
    if (Array.isArray(response)) {
      return response as GlobalSearchFileTypeCategory[];
    }
    if (
      response &&
      typeof response === "object" &&
      "data" in response &&
      Array.isArray((response as { data?: unknown }).data)
    ) {
      return (response as { data: GlobalSearchFileTypeCategory[] }).data;
    }
    return [];
  },

  async searchLegacyGlobal(
    request: LegacyGlobalSearchRequest
  ): Promise<LegacyGlobalSearchResponse> {
    const body: Record<string, unknown> = {
      keyword: request.keyword || "",
      page: request.page,
      limit: request.limit,
      content_type: request.contentTypes,
    };
    if (request.channelId) {
      body.channel_id = request.channelId;
      body.channel_type = request.channelType;
    }
    if (request.onlyMessage) body.only_message = 1;
    const endpoint = request.spaceId
      ? `/search/global?space_id=${encodeURIComponent(request.spaceId)}`
      : "/search/global";
    const response = await APIClient.shared.post(endpoint, body);
    return {
      ...response,
      friends: Array.isArray(response?.friends) ? response.friends : [],
      groups: Array.isArray(response?.groups) ? response.groups : [],
      messages: Array.isArray(response?.messages) ? response.messages : [],
    };
  },
};

export { countChannelSearchKeywordRunes };
export default SearchService;
