export interface SearchRichTextBlock {
  type: string;
  text?: string;
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  name?: string;
  extension?: string;
  mime?: string;
  caption?: string;
}

export type ChannelSearchTab = "all" | "message" | "media" | "file";

export type ChannelSearchItemKind =
  | "text"
  | "image"
  | "video"
  | "file"
  | "merge_forward"
  | "quote";

export interface ChannelSearchSender {
  uid: string;
  name: string;
  avatarUrl?: string;
  isCurrentMember?: boolean;
}

export interface ChannelSearchFilters {
  senderUids: string[];
  sort: "time_desc" | "time_asc";
  datePreset?: "today" | "last_7_days" | "last_30_days";
  startAt?: number;
  endAt?: number;
}

export interface ChannelSearchQuery {
  channelId: string;
  channelType: number;
  keyword: string;
  tab: ChannelSearchTab;
  filters: ChannelSearchFilters;
  cursor?: string;
  limit: number;
}

export interface ChannelSearchFileInfo {
  name: string;
  size: number;
  extension?: string;
  url?: string;
  downloadUrl?: string;
  previewUrl?: string | null;
}

export interface ChannelSearchMediaInfo {
  name?: string;
  url?: string;
  downloadUrl?: string;
  previewUrl?: string | null;
  thumbUrl?: string;
  inlineThumbUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  monthBucket?: string;
  tone: "warm" | "cool" | "green" | "purple" | "orange";
}

export interface ChannelSearchForwardInnerMessage {
  messageId: string;
  type: number;
  text: string;
  senderUid?: string;
  senderName?: string;
  timestamp?: number;
}

export interface ChannelSearchForwardInfo {
  title: string;
  snippets: string[];
  innerMessages?: ChannelSearchForwardInnerMessage[];
  childCount?: number;
}

export interface ChannelSearchRichTextMentionEntity {
  uid: string;
  offset: number;
  length: number;
}

export interface ChannelSearchRichTextMention {
  entities?: ChannelSearchRichTextMentionEntity[];
  all?: number;
  humans?: number;
  ais?: number;
}

export interface ChannelSearchRichTextInfo {
  content: SearchRichTextBlock[];
  plain?: string;
  mention?: ChannelSearchRichTextMention;
}

export interface ChannelSearchItem {
  id: string;
  messageId: string;
  messageSeq: number;
  channelId?: string;
  channelType?: number;
  senderUid: string;
  sender?: ChannelSearchSender;
  timestamp: number;
  kind: ChannelSearchItemKind;
  text?: string;
  matchReason?: string;
  file?: ChannelSearchFileInfo;
  media?: ChannelSearchMediaInfo;
  forward?: ChannelSearchForwardInfo;
  richText?: ChannelSearchRichTextInfo;
}

export interface ChannelSearchResponse {
  items: ChannelSearchItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ChannelSearchDataSource {
  getSenders: () => ChannelSearchSender[];
  getSender: (uid: string) => ChannelSearchSender;
  searchSenders?: (keyword: string) => Promise<ChannelSearchSender[]>;
  searchMessages: (query: ChannelSearchQuery) => Promise<ChannelSearchResponse>;
}

export interface ChannelSearchPanelState {
  activeTab?: ChannelSearchTab;
  filterOpen?: boolean;
  filters?: ChannelSearchFilters;
  keyword?: string;
}

export const defaultChannelSearchFilters = (): ChannelSearchFilters => ({
  senderUids: [],
  sort: "time_desc",
});

export type GlobalContentTab = "messages" | "files";

export interface GlobalSearchChannelRef {
  channelId: string;
  channelType: number;
  name?: string;
  avatarUrl?: string;
}

export interface GlobalSearchFilters {
  senderUids: string[];
  memberUids: string[];
  channels: GlobalSearchChannelRef[];
  channelTypes: number[];
  contentTypes: number[];
  fileExts: string[];
  fileSizeMin?: number;
  fileSizeMax?: number;
  sort: "time_desc" | "time_asc" | "relevance";
  datePreset?: "today" | "last_7_days" | "last_30_days";
  startAt?: number;
  endAt?: number;
}

export interface GlobalSearchQuery {
  tab: GlobalContentTab;
  keyword: string;
  filters: GlobalSearchFilters;
  cursor?: string;
  limit: number;
  signal?: AbortSignal;
}

export type GlobalSearchResponse = ChannelSearchResponse;

export interface GlobalSearchFileTypeCategory {
  key: string;
  label: string;
  exts: string[];
}

export interface GlobalSearchDataSource {
  getSenders: () => ChannelSearchSender[];
  getSender: (uid: string) => ChannelSearchSender;
  searchSenders?: (keyword: string) => Promise<ChannelSearchSender[]>;
  searchChannels?: (keyword: string) => Promise<GlobalSearchChannelOption[]>;
  getSelfUid: () => string;
  searchMessages: (query: GlobalSearchQuery) => Promise<GlobalSearchResponse>;
  getFileTypeCategories: () => Promise<GlobalSearchFileTypeCategory[]>;
  // Cloud-docs full-text search (octo-docs-backend POST /api/v1/docs/search).
  // Optional so existing DataSource fakes/tests stay valid; the docs tab is
  // only rendered where a real API data source provides it.
  searchDocs?: (query: DocSearchQuery) => Promise<DocSearchResponse>;
}

// --- Cloud-docs search (octo-docs-backend) -------------------------------
// doc_type enum as returned/accepted by the backend search endpoint.
export type DocSearchDocType = "doc" | "sheet" | "board" | "html";

export interface DocSearchItem {
  docId: string;
  title: string;
  docType: DocSearchDocType;
  /**
   * updated_at as epoch millis, or null (backend `updatedAt` is
   * `number | null` — doc_meta.updated_at NOW(3), null when unset).
   * SearchService coerces stray values to positive-millis-or-null.
   */
  updatedAt: number | null;
  /**
   * The doc's real space id (backend `spaceId`), passed to buildDocLink's
   * `?sp=` so the standalone preflight addresses the doc's own space. The
   * backend returns it on every item (search is single-space scoped, space_id
   * injected by the gateway); optional only so DataSource fakes/tests may omit it.
   */
  spaceId?: string;
  /**
   * OpenSearch-generated highlight fragment (may contain <em></em>).
   * MUST be rendered with an <em>-only allowlist (escape everything else)
   * to avoid XSS — never dangerouslySetInnerHTML the raw value.
   */
  highlight?: string;
}

export interface DocSearchQuery {
  keyword: string;
  // Opaque keyset cursor (backend search_after token). Omitted on the first
  // page; set to the previous response's nextCursor to fetch the next page.
  cursor?: string;
  pageSize: number;
}

export interface DocSearchResponse {
  total: number;
  items: DocSearchItem[];
  // Opaque keyset cursor for the NEXT page (backend `nextCursor`). Present only
  // while a further page exists; absent => no more results, so the pager stops
  // on `!nextCursor` rather than any offset/total arithmetic.
  nextCursor?: string;
}

export interface GlobalSearchChannelOption {
  channelId: string;
  channelType: number;
  name: string;
  avatarUrl?: string;
}

export const defaultGlobalSearchFilters = (): GlobalSearchFilters => ({
  senderUids: [],
  memberUids: [],
  channels: [],
  channelTypes: [],
  contentTypes: [],
  fileExts: [],
  sort: "time_desc",
});

export const GLOBAL_CONTENT_TYPES_KEYWORD = [1, 14, 8, 11] as const;
export const GLOBAL_CONTENT_TYPES_BROWSE_EXTRA = [2, 5] as const;
export const GLOBAL_CHANNEL_TYPES_DM = [1] as const;
export const GLOBAL_CHANNEL_TYPES_GROUP = [2, 5] as const;
export type CompatChannelSearchFilters = ChannelSearchFilters;
