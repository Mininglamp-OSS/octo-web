import type {
  ChannelSearchFilters,
  ChannelSearchResponse,
  ChannelSearchSender,
} from "../ChannelSearch/types";

export type GlobalContentTab = "messages" | "files";

export interface GlobalSearchChannelRef {
  channelId: string;
  channelType: number;
}

export interface GlobalSearchFilters {
  senderUids: string[];
  memberUid?: string;
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
  searchChannels?: (
    keyword: string
  ) => Promise<GlobalSearchChannelOption[]>;
  getSelfUid: () => string;
  searchMessages: (query: GlobalSearchQuery) => Promise<GlobalSearchResponse>;
  getFileTypeCategories: () => Promise<GlobalSearchFileTypeCategory[]>;
}

// Options returned by the "所在群聊" candidate source. Restricted to the
// allowlist of channels the current user can read — backend intersects with
// the server-side allowlist as well, but the front-end shouldn't let a user
// even pick something they can't read (see §6).
export interface GlobalSearchChannelOption {
  channelId: string;
  channelType: number;
  name: string;
  avatarUrl?: string;
}

export interface GlobalSearchPanelState {
  filterOpen?: boolean;
  filters?: GlobalSearchFilters;
  keyword?: string;
}

export const defaultGlobalSearchFilters = (): GlobalSearchFilters => ({
  senderUids: [],
  channels: [],
  channelTypes: [],
  contentTypes: [],
  fileExts: [],
  sort: "time_desc",
});

// Message-type white lists mirror backend §7.1 (keyword state vs browse state).
// Image (2) / video (5) only appear in browse-mode (empty keyword). Text (1),
// mixed-image-text (14), file (8), merge-forward (11) are always allowed.
export const GLOBAL_CONTENT_TYPES_KEYWORD = [1, 14, 8, 11] as const;
export const GLOBAL_CONTENT_TYPES_BROWSE_EXTRA = [2, 5] as const;

// Channel-type UI groups: 单聊 -> [1]; 群聊 (含话题) -> [2, 5]. See §6.
// YUJ-15 update: [2,5] now produces real thread (channelType=5) hits from
// the backend fail-open allowlist; earlier v1 stages returned nothing for
// channel_type=5 (fail-closed). Keeping thread folded under 群聊 rather
// than a separate 话题 chip is deliberate — see GlobalSearchFilterPanel
// candidate-pool comment for the v1 rationale.
export const GLOBAL_CHANNEL_TYPES_DM = [1] as const;
export const GLOBAL_CHANNEL_TYPES_GROUP = [2, 5] as const;

// Only used as a bridge when re-projecting for ChannelSearch-shaped helpers.
export type CompatChannelSearchFilters = ChannelSearchFilters;
