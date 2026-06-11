export type ChannelSearchTab = "all" | "message" | "media" | "file";

export type ChannelSearchItemKind =
  | "text"
  | "image"
  | "video"
  | "file"
  | "merge_forward";

export interface ChannelSearchSender {
  uid: string;
  name: string;
  avatarUrl?: string;
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
  iconUrl?: string;
  url?: string;
}

export interface ChannelSearchMediaInfo {
  name: string;
  thumbLabel: string;
  thumbUrl?: string;
  inlineThumbUrl?: string;
  duration?: number;
  tone: "warm" | "cool" | "green" | "purple" | "orange";
}

export interface ChannelSearchForwardInfo {
  title: string;
  snippets: string[];
}

export interface ChannelSearchItem {
  id: string;
  messageId: string;
  messageSeq: number;
  senderUid: string;
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
  searchMessages: (query: ChannelSearchQuery) => Promise<ChannelSearchResponse>;
}

export const defaultChannelSearchFilters = (): ChannelSearchFilters => ({
  senderUids: [],
  sort: "time_desc",
});
