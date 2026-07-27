import type { ChannelInfo } from "wukongimjssdk";
import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { pinyin } from "pinyin-pro";
import type { Contacts } from "../../Service/DataSource/DataSource";
import { ContactsStatus } from "../../Service/DataSource/DataSource";
import type {
  LegacyGlobalSearchContact,
  LegacyGlobalSearchResponse,
} from "../../Service/SearchService";
import { toSimplized } from "../../Utils/t2s";

export type GlobalSearchPinyinConverter = (value: string) => string;

interface NamedPinyinSearchEntry<T> {
  item: T;
  sourceText: string;
  searchText: string;
}

export interface NamedPinyinSearchIndex<T> {
  entries: Map<string, NamedPinyinSearchEntry<T>>;
}

interface GlobalSearchPinyinEntry {
  item: LegacyGlobalSearchContact;
  sourceText: string;
  searchText: string;
}

export interface GlobalSearchPinyinIndex {
  friends: GlobalSearchPinyinEntry[];
  groups: GlobalSearchPinyinEntry[];
}

function displayName(item: LegacyGlobalSearchContact): string {
  return item.channel_remark || item.channel_name || item.channel_id || "";
}

function defaultPinyinConverter(value: string): string {
  const simplified = toSimplized(value);
  return pinyin(simplified, {
    toneType: "none",
    type: "array",
  })
    .join("")
    .toLowerCase();
}

function namedSearchText(
  normalized: string[],
  toPinyin: GlobalSearchPinyinConverter
): string {
  return [
    normalized.join("\n"),
    ...normalized.map((value) => toPinyin(value).toLowerCase()),
  ].join("\n");
}

export function createNamedPinyinSearchIndex<T>(): NamedPinyinSearchIndex<T> {
  return { entries: new Map() };
}

export function extendNamedPinyinSearchIndex<T>(
  index: NamedPinyinSearchIndex<T>,
  items: T[],
  getKey: (item: T) => string,
  getValues: (item: T) => string[],
  toPinyin: GlobalSearchPinyinConverter = defaultPinyinConverter
): NamedPinyinSearchIndex<T> {
  items.forEach((item) => {
    const key = getKey(item);
    if (!key) return;
    const normalized = getValues(item)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const sourceText = normalized.join("\n");
    const current = index.entries.get(key);
    if (current?.sourceText === sourceText) {
      current.item = item;
      return;
    }
    index.entries.set(key, {
      item,
      sourceText,
      searchText: namedSearchText(normalized, toPinyin),
    });
  });
  return index;
}

export function searchNamedPinyinIndex<T>(
  keyword: string,
  index: NamedPinyinSearchIndex<T>
): T[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return Array.from(index.entries.values(), (entry) => entry.item);
  }
  return Array.from(index.entries.values())
    .filter((entry) => entry.searchText.includes(normalizedKeyword))
    .map((entry) => entry.item);
}

function searchText(
  name: string,
  toPinyin: GlobalSearchPinyinConverter
): string {
  return `${name}\n${toPinyin(name).toLowerCase()}`;
}

function globalSearchEntry(
  item: LegacyGlobalSearchContact,
  toPinyin: GlobalSearchPinyinConverter
): GlobalSearchPinyinEntry {
  const sourceText = displayName(item).replace(/\*\*/g, "").toLowerCase();
  return {
    item,
    sourceText,
    searchText: searchText(sourceText, toPinyin),
  };
}

function uniqueByChannel(
  items: LegacyGlobalSearchContact[]
): LegacyGlobalSearchContact[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.channel_type}:${item.channel_id}`;
    if (!item.channel_id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createEmptyGlobalSearchPinyinIndex(): GlobalSearchPinyinIndex {
  return { friends: [], groups: [] };
}

export function buildGlobalSearchPinyinIndex(
  source: Pick<LegacyGlobalSearchResponse, "friends" | "groups">,
  toPinyin: GlobalSearchPinyinConverter = defaultPinyinConverter
): GlobalSearchPinyinIndex {
  const build = (items: LegacyGlobalSearchContact[] | undefined) =>
    uniqueByChannel(items || []).map((item) =>
      globalSearchEntry(item, toPinyin)
    );

  return {
    friends: build(source.friends),
    groups: build(source.groups),
  };
}

export function rebuildGlobalSearchPinyinIndex(
  index: GlobalSearchPinyinIndex,
  source: Pick<LegacyGlobalSearchResponse, "friends" | "groups">,
  toPinyin: GlobalSearchPinyinConverter = defaultPinyinConverter
): GlobalSearchPinyinIndex {
  const rebuild = (
    current: GlobalSearchPinyinEntry[],
    incoming: LegacyGlobalSearchContact[] | undefined
  ) => {
    const currentByKey = new Map(
      current.map((entry) => [
        `${entry.item.channel_type}:${entry.item.channel_id}`,
        entry,
      ])
    );
    return uniqueByChannel(incoming || []).map((item) => {
      const key = `${item.channel_type}:${item.channel_id}`;
      const sourceText = displayName(item).replace(/\*\*/g, "").toLowerCase();
      const cached = currentByKey.get(key);
      if (cached?.sourceText === sourceText) {
        return { ...cached, item };
      }
      return globalSearchEntry(item, toPinyin);
    });
  };

  return {
    friends: rebuild(index.friends, source.friends),
    groups: rebuild(index.groups, source.groups),
  };
}

export function searchGlobalSearchPinyinIndex(
  keyword: string,
  index: GlobalSearchPinyinIndex
): Pick<LegacyGlobalSearchResponse, "friends" | "groups"> {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return { friends: [], groups: [] };

  const search = (entries: GlobalSearchPinyinEntry[]) =>
    entries
      .filter((entry) => entry.searchText.includes(normalizedKeyword))
      .map((entry) => entry.item);

  return {
    friends: search(index.friends),
    groups: search(index.groups),
  };
}

function mergeContacts(
  serverItems: LegacyGlobalSearchContact[] | undefined,
  localItems: LegacyGlobalSearchContact[] | undefined
): LegacyGlobalSearchContact[] {
  return uniqueByChannel([...(serverItems || []), ...(localItems || [])]);
}

export function mergeGlobalSearchPinyinResults(
  serverResult: LegacyGlobalSearchResponse,
  localResult: Pick<LegacyGlobalSearchResponse, "friends" | "groups">
): LegacyGlobalSearchResponse {
  return {
    ...serverResult,
    friends: mergeContacts(serverResult.friends, localResult.friends),
    groups: mergeContacts(serverResult.groups, localResult.groups),
  };
}

export function replaceGlobalSearchPinyinMatches(
  currentResult: LegacyGlobalSearchResponse,
  serverResult: Pick<LegacyGlobalSearchResponse, "friends" | "groups">,
  localResult: Pick<LegacyGlobalSearchResponse, "friends" | "groups">
): LegacyGlobalSearchResponse {
  return mergeGlobalSearchPinyinResults(
    {
      ...currentResult,
      friends: serverResult.friends,
      groups: serverResult.groups,
    },
    localResult
  );
}

export function globalSearchContactsToLegacy(
  contacts: Contacts[]
): LegacyGlobalSearchContact[] {
  return contacts
    .filter((contact) => contact.status !== ContactsStatus.Blacklist)
    .map((contact) => ({
      channel_id: contact.uid,
      channel_type: ChannelTypePerson,
      channel_name: contact.remark || contact.name || contact.uid,
      channel_remark: contact.remark || undefined,
    }));
}

export function globalSearchGroupsToLegacy(
  groups: ChannelInfo[]
): LegacyGlobalSearchContact[] {
  return groups.flatMap((group) => {
    const raw = group as ChannelInfo & {
      displayName?: string;
      name?: string;
      title?: string;
      orgData?: Record<string, unknown>;
    };
    const channelId = raw.channel?.channelID;
    if (!channelId) return [];
    const org = raw.orgData || {};
    const remark = typeof org.remark === "string" ? org.remark : "";
    const name =
      remark ||
      (typeof raw.displayName === "string" ? raw.displayName : "") ||
      (typeof org.displayName === "string" ? org.displayName : "") ||
      (typeof raw.title === "string" ? raw.title : "") ||
      (typeof raw.name === "string" ? raw.name : "") ||
      channelId;
    return [
      {
        channel_id: channelId,
        channel_type: raw.channel.channelType || ChannelTypeGroup,
        channel_name: name,
        channel_remark: remark || undefined,
      },
    ];
  });
}

export function refreshGlobalSearchGroupCandidates(
  current: LegacyGlobalSearchContact[],
  groups: ChannelInfo[] | undefined
): LegacyGlobalSearchContact[] {
  return groups === undefined ? current : globalSearchGroupsToLegacy(groups);
}
