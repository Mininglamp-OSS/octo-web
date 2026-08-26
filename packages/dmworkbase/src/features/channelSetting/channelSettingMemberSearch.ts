import { Subscriber } from "wukongimjssdk";

import { getPinyin } from "../../Utils/pinYin";
import { toSimplized } from "../../Utils/t2s";

export type ChannelSettingMemberPinyinConverter = (value: string) => string;

export interface ChannelSettingMemberSearchEntry {
  member: Subscriber;
  searchText: string;
}

export interface ChannelSettingMemberSearchIndex {
  entries: ChannelSettingMemberSearchEntry[];
}

export type ChannelSettingMemberSearch = (keyword: string) => Subscriber[];

function defaultPinyinConverter(value: string): string {
  return getPinyin(toSimplized(value)).toLowerCase();
}

function memberSearchValues(member: Subscriber): string[] {
  return [
    member.uid,
    member.remark,
    member.name,
    member.orgData?.real_name,
  ].filter((value): value is string => typeof value === "string" && !!value);
}

export function buildChannelSettingMemberSearchIndex(
  members: Subscriber[],
  toPinyin: ChannelSettingMemberPinyinConverter = defaultPinyinConverter
): ChannelSettingMemberSearchIndex {
  return {
    entries: members.map((member) => {
      const values = memberSearchValues(member).map((value) =>
        value.trim().toLowerCase()
      );
      const pinyin = values.map(toPinyin);
      return {
        member,
        searchText: [...values, ...pinyin].join("\n"),
      };
    }),
  };
}

export function filterChannelSettingMembers(
  index: ChannelSettingMemberSearchIndex,
  keyword: string
): Subscriber[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return index.entries.map((entry) => entry.member);
  }
  return index.entries
    .filter((entry) => entry.searchText.includes(normalizedKeyword))
    .map((entry) => entry.member);
}

export function createChannelSettingMemberSearch(
  members: Subscriber[],
  filter?: (member: Subscriber) => boolean
): ChannelSettingMemberSearch {
  const source = filter ? members.filter(filter) : members;
  const index = buildChannelSettingMemberSearchIndex(source);
  return (keyword) => filterChannelSettingMembers(index, keyword);
}
