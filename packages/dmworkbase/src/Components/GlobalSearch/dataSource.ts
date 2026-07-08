import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import type { ChannelSearchSender } from "../ChannelSearch/types";
import {
  foldResponse,
  globalSearchEndpoint,
  GLOBAL_SEARCH_FILE_TYPES_ENDPOINT,
  mapFilesResponse,
  mapMessagesResponse,
  toGlobalRequestBody,
} from "./apiAdapter";
import { activeGlobalSearchFilterCount } from "./filterState";
import type {
  GlobalSearchChannelOption,
  GlobalSearchDataSource,
  GlobalSearchFileTypeCategory,
  GlobalSearchQuery,
} from "./types";

const PAGE_SIZE_SENDERS = 50;

function selfSender(): ChannelSearchSender {
  const uid = WKApp.loginInfo.uid || "";
  return {
    uid,
    name:
      WKApp.loginInfo.selfDisplayName?.() ||
      WKApp.loginInfo.name ||
      uid,
    avatarUrl: uid ? WKApp.shared.avatarUser(uid) : undefined,
    isCurrentMember: true,
  };
}

// Best-effort candidate list of channels the user can already read. We hydrate
// from the local conversation cache plus the "my groups" list — both are the
// same data sources the backend allowlist builds from (§6.2). The server also
// intersects with the authoritative allowlist, so a stale local cache is safe.
async function loadReadableChannelOptions(
  keyword: string
): Promise<GlobalSearchChannelOption[]> {
  const out = new Map<string, GlobalSearchChannelOption>();
  const push = (option: GlobalSearchChannelOption) => {
    const key = `${option.channelType}:${option.channelId}`;
    if (!out.has(key)) out.set(key, option);
  };

  const conversations =
    WKSDK.shared().conversationManager.conversations ?? [];
  for (const conv of conversations) {
    const channel = conv.channel;
    if (!channel?.channelID) continue;
    if (
      channel.channelType !== ChannelTypePerson &&
      channel.channelType !== ChannelTypeGroup &&
      channel.channelType !== ChannelTypeCommunityTopic
    ) {
      continue;
    }
    const info = WKSDK.shared().channelManager.getChannelInfo(channel);
    const name =
      info?.orgData?.displayName ||
      (info as any)?.title ||
      channel.channelID;
    push({
      channelId: channel.channelID,
      channelType: channel.channelType,
      name,
      avatarUrl: WKApp.shared.avatarChannel(channel),
    });
  }

  try {
    const myGroups =
      (await WKApp.dataSource.channelDataSource.groupSaveList?.()) ?? [];
    for (const g of myGroups as Array<any>) {
      const channelId = g?.channel?.channelID || g?.channelID || g?.group_no;
      const channelType = g?.channel?.channelType ?? ChannelTypeGroup;
      if (!channelId) continue;
      push({
        channelId,
        channelType,
        name: g?.displayName || g?.name || channelId,
        avatarUrl: WKApp.shared.avatarChannel(
          new Channel(channelId, channelType)
        ),
      });
    }
  } catch (_) {
    // Failing to load "my groups" is non-fatal — we still return recents.
  }

  const kw = keyword.trim().toLowerCase();
  const options = Array.from(out.values());
  if (!kw) return options.slice(0, 60);
  return options
    .filter((o) => o.name.toLowerCase().includes(kw))
    .slice(0, 60);
}

async function loadSenderCandidates(
  keyword: string
): Promise<ChannelSearchSender[]> {
  // Try contacts / friends via a generic contacts endpoint if it exists, else
  // fall back to whoever we've cached from search results. Keep this
  // resilient — errors are swallowed so the filter panel stays usable.
  try {
    const searchDS = (WKApp.dataSource as any).contactsDataSource?.search;
    if (typeof searchDS === "function") {
      const list = await searchDS(keyword.trim(), {
        page: 1,
        limit: PAGE_SIZE_SENDERS,
      });
      if (Array.isArray(list)) {
        return list.map((u: any) => ({
          uid: u.uid || u.id || "",
          name: u.remark || u.name || u.uid || u.id || "",
          avatarUrl:
            u.avatar ||
            (u.uid ? WKApp.shared.avatarUser(u.uid) : undefined),
          isCurrentMember: true,
        }));
      }
    }
  } catch (_) {
    // fall through
  }
  return [];
}

export interface CreateGlobalSearchApiDataSourceOptions {
  fileTypeCategoriesCache?: {
    get: () => GlobalSearchFileTypeCategory[] | undefined;
    set: (categories: GlobalSearchFileTypeCategory[]) => void;
  };
}

const moduleFileTypeCategoriesCache: {
  value?: GlobalSearchFileTypeCategory[];
  inFlight?: Promise<GlobalSearchFileTypeCategory[]>;
} = {};

export function createGlobalSearchApiDataSource(
  options: CreateGlobalSearchApiDataSourceOptions = {}
): GlobalSearchDataSource {
  const senderCache = new Map<string, ChannelSearchSender>();
  const rememberSender = (sender?: ChannelSearchSender) => {
    if (!sender?.uid) return;
    senderCache.set(sender.uid, sender);
  };
  // Seed with self so the "包含成员" candidate list can filter it out reliably
  // (and the "发送人" chip always resolves self's display name).
  rememberSender(selfSender());

  return {
    getSenders: () => Array.from(senderCache.values()),
    getSender: (uid) =>
      senderCache.get(uid) || {
        uid,
        name: uid,
      },
    getSelfUid: () => WKApp.loginInfo.uid || "",
    searchSenders: async (keyword: string) => {
      const remote = await loadSenderCandidates(keyword);
      remote.forEach(rememberSender);
      const kw = keyword.trim().toLowerCase();
      const combined = Array.from(senderCache.values());
      if (!kw) return combined.slice(0, PAGE_SIZE_SENDERS);
      return combined
        .filter((s) => `${s.name}${s.uid}`.toLowerCase().includes(kw))
        .slice(0, PAGE_SIZE_SENDERS);
    },
    searchChannels: async (keyword: string) => {
      return loadReadableChannelOptions(keyword);
    },
    getFileTypeCategories: async () => {
      const cache = options.fileTypeCategoriesCache;
      const hit = cache?.get() ?? moduleFileTypeCategoriesCache.value;
      if (hit) return hit;
      if (moduleFileTypeCategoriesCache.inFlight) {
        return moduleFileTypeCategoriesCache.inFlight;
      }
      const promise = WKApp.apiClient
        .get<GlobalSearchFileTypeCategory[]>(GLOBAL_SEARCH_FILE_TYPES_ENDPOINT)
        .then((resp) => {
          const list: GlobalSearchFileTypeCategory[] = Array.isArray(resp)
            ? (resp as any)
            : (resp as any)?.data ?? [];
          moduleFileTypeCategoriesCache.value = list;
          cache?.set(list);
          return list;
        })
        .catch(() => {
          moduleFileTypeCategoriesCache.inFlight = undefined;
          return [] as GlobalSearchFileTypeCategory[];
        })
        .finally(() => {
          moduleFileTypeCategoriesCache.inFlight = undefined;
        });
      moduleFileTypeCategoriesCache.inFlight = promise;
      return promise;
    },
    searchMessages: async (query: GlobalSearchQuery) => {
      const body = toGlobalRequestBody(query, WKApp.loginInfo.uid || "");
      const resp = await WKApp.apiClient.post(
        globalSearchEndpoint(query.tab),
        body
      );

      const { items, pagination } =
        query.tab === "files"
          ? mapFilesResponse(resp, query)
          : mapMessagesResponse(resp, query);

      items.forEach((item) => rememberSender(item.sender));
      return foldResponse(items, pagination);
    },
  };
}

// Re-export the derived counter to give panels a single import surface.
export { activeGlobalSearchFilterCount };
