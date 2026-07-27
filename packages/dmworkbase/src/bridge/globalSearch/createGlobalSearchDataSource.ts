import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { ContactsStatus } from "../../Service/DataSource/DataSource";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import { getCurrentImConversationsDirectly } from "../../im-runtime/currentConversationRuntime";
import type { ChannelSearchSender } from "../../Service/SearchTypes";
import SearchService from "../../Service/SearchService";
import { createSearchAssetResolver } from "../search/createSearchAssetResolver";
import { activeGlobalSearchFilterCount } from "./filterState";
import type {
  GlobalSearchChannelOption,
  GlobalSearchDataSource,
  GlobalSearchFileTypeCategory,
  GlobalSearchQuery,
} from "../../Service/SearchTypes";
import {
  createNamedPinyinSearchIndex,
  extendNamedPinyinSearchIndex,
  searchNamedPinyinIndex,
} from "./globalSearchPinyin";

const PAGE_SIZE_SENDERS = 50;

function selfSender(): ChannelSearchSender {
  const uid = WKApp.loginInfo.uid || "";
  return {
    uid,
    name: WKApp.loginInfo.selfDisplayName?.() || WKApp.loginInfo.name || uid,
    avatarUrl: uid ? WKApp.shared.avatarUser(uid) : undefined,
    isCurrentMember: true,
  };
}

// Best-effort candidate list of channels the user can already read. We hydrate
// from the local conversation cache plus the "my groups" list — both are the
// same data sources the backend allowlist builds from (§6.2). The server also
// intersects with the authoritative allowlist, so a stale local cache is safe.
//
// YUJ-30 bug 2: private conversations (channelType=1, DM) are excluded from
// the candidate pool. The picker is now labeled 「所在群聊或子区」 and only
// groups (channelType=2) + threads (channelType=5) belong there — a DM row
// in this list was misleading and had no matching backend filter path.
//
// v1 scope (YUJ-15) note: threads that happen to appear in a recent
// conversation get their own row in the pool (the conversation branch below
// accepts ChannelTypeCommunityTopic). We still do NOT enumerate all threads
// of the user's groups — a full group-scoped thread picker is deferred. Thread
// hits from a picked *group* now expand to «group + all its threads» server-
// side under the YUJ-30 unified rule (see 01-backend-search-global.md §3/§6).
async function loadReadableChannelOptions(): Promise<
  GlobalSearchChannelOption[]
> {
  const out = new Map<string, GlobalSearchChannelOption>();
  const push = (option: GlobalSearchChannelOption) => {
    const key = `${option.channelType}:${option.channelId}`;
    if (!out.has(key)) out.set(key, option);
  };

  const conversations = getCurrentImConversationsDirectly();
  for (const conv of conversations) {
    const channel = conv.channel;
    if (!channel?.channelID) continue;
    // Bug 2: only groups (2) + threads (5). DMs (ChannelTypePerson=1) are
    // filtered out here so the picker never surfaces them.
    if (
      channel.channelType !== ChannelTypeGroup &&
      channel.channelType !== ChannelTypeCommunityTopic
    ) {
      continue;
    }
    const info = getCurrentImChannelInfo(channel);
    const name =
      info?.orgData?.displayName || (info as any)?.title || channel.channelID;
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

  const options = Array.from(out.values());
  return options;
}

function localContactSenders(): ChannelSearchSender[] {
  const list: any[] = (WKApp.dataSource as any)?.contactsList ?? [];
  return list.flatMap((contact) => {
    const uid = contact?.uid;
    if (!uid || contact?.status === ContactsStatus.Blacklist) return [];
    return [
      {
        uid,
        name: contact?.remark || contact?.name || uid,
        avatarUrl: contact?.avatar || WKApp.shared.avatarUser(uid),
        isCurrentMember: true,
      },
    ];
  });
}

// RC #554 blocker (Jerry-Xin + OctoBoooot @ 2026-07-09): the previous
// implementation called `(WKApp.dataSource as any).contactsDataSource?.search`
// — that member does not exist on the real `DataSource` (grep is clean), so
// the `as any` silently suppressed the type error and this function always
// returned []. Effect: the sender/member filter never surfaced any candidate
// unless one had already been cached from a prior search-result row.
//
// The real contacts surface is `commonDataSource.searchFriends(keyword)` (see
// `Service/DataSource/DataSource.ts:201` + `ForwardModal/useForwardModal.ts:312`
// for the canonical call site). It returns `ChannelInfo[]` where each
// `channel.channelID` is the friend's uid and `orgData` carries `displayName`
// / `remark` / `avatar`. When it isn't available (some deployments still
// haven't wired it, or the network call fails) we fall back to the already-
// synced `WKApp.dataSource.contactsList` snapshot so the filter panel is
// never empty in a normal signed-in session.
async function loadSenderCandidates(
  keyword: string
): Promise<ChannelSearchSender[]> {
  const kw = keyword.trim();
  const out: ChannelSearchSender[] = [];
  const seen = new Set<string>();
  const push = (sender: ChannelSearchSender) => {
    if (!sender.uid || seen.has(sender.uid)) return;
    seen.add(sender.uid);
    out.push(sender);
  };

  // 1) Primary: server-side friend search (keyword-aware, up to PAGE_SIZE).
  try {
    const commonDS: any = (WKApp.dataSource as any)?.commonDataSource;
    if (commonDS && typeof commonDS.searchFriends === "function") {
      const friends = (await commonDS.searchFriends(kw)) ?? [];
      if (Array.isArray(friends)) {
        for (const info of friends) {
          const uid = info?.channel?.channelID;
          if (!uid) continue;
          const org = info?.orgData ?? {};
          push({
            uid,
            name: org.remark || org.displayName || org.name || uid,
            avatarUrl: org.avatar || WKApp.shared.avatarUser(uid),
            isCurrentMember: true,
          });
          if (out.length >= PAGE_SIZE_SENDERS) return out;
        }
      }
    }
  } catch (_) {
    // fall through to the local contacts snapshot
  }

  // 2) Fallback: the already-synced local contacts list. `contactsSync`
  //    populates this on login (see DataSource.contactsSync), so a signed-in
  //    user always has *some* candidates even when the friend-search endpoint
  //    is missing / offline. Do local case-insensitive filtering on
  //    name/remark/uid so an empty-keyword call still returns everyone.
  try {
    const list: any[] = (WKApp.dataSource as any)?.contactsList ?? [];
    const kwLower = kw.toLowerCase();
    for (const c of list) {
      const uid = c?.uid;
      if (!uid || c?.status === ContactsStatus.Blacklist) continue;
      const name = c?.remark || c?.name || uid;
      if (kwLower && !`${name}${uid}`.toLowerCase().includes(kwLower)) {
        continue;
      }
      push({
        uid,
        name,
        avatarUrl: c?.avatar || WKApp.shared.avatarUser(uid),
        isCurrentMember: true,
      });
      if (out.length >= PAGE_SIZE_SENDERS) return out;
    }
  } catch (_) {
    // ignore — worst case we return whatever we already gathered
  }

  return out;
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
  const senderPinyinIndex = createNamedPinyinSearchIndex<ChannelSearchSender>();
  let channelPinyinIndex =
    createNamedPinyinSearchIndex<GlobalSearchChannelOption>();
  let channelCandidateSignature = "";
  let indexedSpaceId = WKApp.shared.currentSpaceId;
  let senderCandidateSignature = "";
  const rememberSender = (sender?: ChannelSearchSender) => {
    if (!sender?.uid) return;
    senderCache.set(sender.uid, sender);
  };
  // Seed with self so the "包含成员" candidate list can filter it out reliably
  // (and the "发送人" chip always resolves self's display name).
  rememberSender(selfSender());

  const resetScopedPinyinIndexes = () => {
    const currentSpaceId = WKApp.shared.currentSpaceId;
    const nextSenderCandidateSignature = localContactSenders()
      .map((sender) => `${sender.uid}:${sender.name}`)
      .sort()
      .join("\n");
    const spaceChanged = currentSpaceId !== indexedSpaceId;
    const senderPoolChanged =
      nextSenderCandidateSignature !== senderCandidateSignature;
    if (!spaceChanged && !senderPoolChanged) return;
    indexedSpaceId = currentSpaceId;
    senderCandidateSignature = nextSenderCandidateSignature;
    senderCache.clear();
    senderPinyinIndex.entries.clear();
    if (spaceChanged) {
      channelPinyinIndex =
        createNamedPinyinSearchIndex<GlobalSearchChannelOption>();
      channelCandidateSignature = "";
    }
    rememberSender(selfSender());
  };

  return {
    getSenders: () => {
      resetScopedPinyinIndexes();
      return Array.from(senderCache.values());
    },
    getSender: (uid) =>
      senderCache.get(uid) || {
        uid,
        name: uid,
      },
    getSelfUid: () => WKApp.loginInfo.uid || "",
    searchSenders: async (keyword: string) => {
      resetScopedPinyinIndexes();
      const remote = await loadSenderCandidates(keyword);
      // The local snapshot is authoritative for explicit blacklist state even
      // if a lagging server search still returns that uid.
      const blacklistedUids = new Set(
        (((WKApp.dataSource as any)?.contactsList ?? []) as any[])
          .filter((contact) => contact?.status === ContactsStatus.Blacklist)
          .map((contact) => contact?.uid)
          .filter(Boolean)
      );
      resetScopedPinyinIndexes();
      [...localContactSenders(), ...remote]
        .filter((sender) => !blacklistedUids.has(sender.uid))
        .forEach(rememberSender);
      const combined = Array.from(senderCache.values());
      extendNamedPinyinSearchIndex(
        senderPinyinIndex,
        combined,
        (sender) => sender.uid,
        (sender) => [sender.name, sender.uid]
      );
      return searchNamedPinyinIndex(keyword, senderPinyinIndex).slice(
        0,
        PAGE_SIZE_SENDERS
      );
    },
    searchChannels: async (keyword: string) => {
      resetScopedPinyinIndexes();
      const options = await loadReadableChannelOptions();
      const nextSignature = options
        .map(
          (option) => `${option.channelType}:${option.channelId}:${option.name}`
        )
        .sort()
        .join("\n");
      if (nextSignature !== channelCandidateSignature) {
        channelCandidateSignature = nextSignature;
        channelPinyinIndex =
          createNamedPinyinSearchIndex<GlobalSearchChannelOption>();
        extendNamedPinyinSearchIndex(
          channelPinyinIndex,
          options,
          (option) => `${option.channelType}:${option.channelId}`,
          (option) => [option.name, option.channelId]
        );
      }
      return searchNamedPinyinIndex(keyword, channelPinyinIndex).slice(0, 60);
    },
    getFileTypeCategories: async () => {
      const cache = options.fileTypeCategoriesCache;
      const hit = cache?.get() ?? moduleFileTypeCategoriesCache.value;
      if (hit) return hit;
      if (moduleFileTypeCategoriesCache.inFlight) {
        return moduleFileTypeCategoriesCache.inFlight;
      }
      const promise = SearchService.getGlobalFileTypes()
        .then((list) => {
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
      const result = await SearchService.searchGlobalMessages(
        query,
        WKApp.loginInfo.uid || "",
        createSearchAssetResolver()
      );
      result.items.forEach((item) => rememberSender(item.sender));
      return result;
    },
  };
}

// Re-export the derived counter to give panels a single import surface.
export { activeGlobalSearchFilterCount };
