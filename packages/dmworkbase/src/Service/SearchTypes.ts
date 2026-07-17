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
