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
  iconUrl?: string;
  url?: string;
  downloadUrl?: string;
  previewUrl?: string | null;
}

export interface ChannelSearchMediaInfo {
  name?: string;
  thumbUrl?: string;
  inlineThumbUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  monthBucket?: string;
  tone: "warm" | "cool" | "green" | "purple" | "orange";
}

export interface ChannelSearchForwardInfo {
  title: string;
  snippets: string[];
  childCount?: number;
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
