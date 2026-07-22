import { getPinyin } from "@octo/base/src/Utils/pinYin";
import { toSimplized } from "@octo/base/src/Utils/t2s";

import type { GroupCreateCandidateContact } from "./types";

export type GroupCreatePinyinConverter = (value: string) => string;

export interface GroupCreateSearchEntry {
  candidate: GroupCreateCandidateContact;
  searchText: string;
}

export interface GroupCreateSearchIndex {
  entries: GroupCreateSearchEntry[];
}

function defaultPinyinConverter(value: string): string {
  return getPinyin(toSimplized(value)).toLowerCase();
}

export function buildGroupCreateSearchIndex(
  candidates: GroupCreateCandidateContact[],
  toPinyin: GroupCreatePinyinConverter = defaultPinyinConverter
): GroupCreateSearchIndex {
  return {
    entries: candidates.map((candidate) => {
      const normalizedName = candidate.name.toLowerCase();
      const pinyin = toPinyin(normalizedName).toLowerCase();
      return {
        candidate,
        searchText: `${normalizedName}\n${pinyin}`,
      };
    }),
  };
}

export function createEmptyGroupCreateSearchIndex(): GroupCreateSearchIndex {
  return { entries: [] };
}

export function filterGroupCreateCandidates(
  index: GroupCreateSearchIndex,
  keyword: string
): GroupCreateCandidateContact[] {
  const normalizedKeyword = keyword.toLowerCase();
  if (!normalizedKeyword) {
    return index.entries.map((entry) => entry.candidate);
  }
  return index.entries
    .filter((entry) => entry.searchText.includes(normalizedKeyword))
    .map((entry) => entry.candidate);
}
