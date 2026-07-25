import { getPinyin } from "@octo/base/src/Utils/pinYin";
import { toSimplized } from "@octo/base/src/Utils/t2s";
import type {
  ContactsSearchBot,
  ContactsSearchIndex,
  ContactsSearchResult,
  ContactsSearchSource,
} from "./types";

export type ContactsPinyinConverter = (value: string) => string;

function normalizeName(value?: string): string {
  return (value || "").replace(/\*\*/g, "").toLowerCase();
}

function defaultPinyinConverter(value: string): string {
  return getPinyin(toSimplized(value)).toLowerCase();
}

function buildSearchText(
  value: string | undefined,
  toPinyin: ContactsPinyinConverter
): { pinyin: string; searchText: string } {
  const normalizedName = normalizeName(value);
  const pinyin = toPinyin(normalizedName).toLowerCase();
  return {
    pinyin,
    searchText: `${normalizedName}\n${pinyin}`,
  };
}

export function buildContactsSearchIndex(
  source: ContactsSearchSource,
  toPinyin: ContactsPinyinConverter = defaultPinyinConverter
): ContactsSearchIndex {
  const memberUids = new Set(source.spaceMembers.map((member) => member.uid));
  const pinyinByUid = new Map<string, string>();

  const people = source.spaceMembers
    .filter((member) => member.uid !== source.currentUid)
    .map((member) => {
      const text = buildSearchText(member.name, toPinyin);
      pinyinByUid.set(member.uid, text.pinyin);
      return { item: member, searchText: text.searchText };
    });

  const extraBots = source.spaceBots
    .filter((bot) => bot.uid !== source.currentUid && !memberUids.has(bot.uid))
    .map((bot) => {
      const item: ContactsSearchBot = { ...bot, robot: 1 };
      const text = buildSearchText(bot.name, toPinyin);
      pinyinByUid.set(bot.uid, text.pinyin);
      return { item, searchText: text.searchText };
    });

  const groups = source.myGroups.map((group) => ({
    item: group,
    searchText: buildSearchText(group.name, toPinyin).searchText,
  }));

  return { people: [...people, ...extraBots], groups, pinyinByUid };
}

export function createEmptyContactsSearchIndex(): ContactsSearchIndex {
  return { people: [], groups: [], pinyinByUid: new Map() };
}

export function searchContacts(
  keyword: string,
  index: ContactsSearchIndex
): ContactsSearchResult {
  const normalizedKeyword = keyword.trim().toLowerCase();
  return {
    contacts: index.people
      .filter((entry) => entry.searchText.includes(normalizedKeyword))
      .map((entry) => entry.item),
    groups: index.groups
      .filter((entry) => entry.searchText.includes(normalizedKeyword))
      .map((entry) => entry.item),
  };
}
