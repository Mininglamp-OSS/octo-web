import type {
  ChannelSearchItem,
  GlobalSearchFilters,
} from "../../Service/SearchTypes";
import { hasGlobalSearchCriteria } from "../globalSearch/filterState";

export interface GlobalChatSearchConversation {
  key: string;
  channelId: string;
  channelType: number;
  parentGroupNo?: string;
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  matchCount: number;
  isMatchCountApproximate: boolean;
  preview: ChannelSearchItem[];
}

export function canRunGlobalGroupSearch(
  keyword: string,
  filters: GlobalSearchFilters
) {
  return hasGlobalSearchCriteria("messages", keyword, filters);
}

export function drillDownFilters(
  filters: GlobalSearchFilters,
  conversation: Pick<
    GlobalChatSearchConversation,
    "channelId" | "channelType" | "name" | "avatarUrl"
  >
): GlobalSearchFilters {
  return {
    ...filters,
    sort: "time_desc",
    channels: [
      {
        channelId: conversation.channelId,
        channelType: conversation.channelType,
        name: conversation.name,
        avatarUrl: conversation.avatarUrl,
      },
    ],
  };
}
