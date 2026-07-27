import { getPinyin } from "../../Utils/pinYin";
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

function defaultPinyinConverter(value: string): string {
  return getPinyin(toSimplized(value)).toLowerCase();
}

function normalizedValues(values: string[]): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function createEntry<T>(
  item: T,
  values: string[],
  toPinyin: GlobalSearchPinyinConverter
): NamedPinyinSearchEntry<T> {
  const normalized = normalizedValues(values);
  return {
    item,
    sourceText: normalized.join("\n"),
    searchText: [
      ...normalized,
      ...normalized.map((value) => toPinyin(value).toLowerCase()),
    ].join("\n"),
  };
}

export function createNamedPinyinSearchIndex<T>(): NamedPinyinSearchIndex<T> {
  return { entries: new Map() };
}

export function rebuildNamedPinyinSearchIndex<T>(
  current: NamedPinyinSearchIndex<T>,
  items: T[],
  getKey: (item: T) => string,
  getValues: (item: T) => string[],
  toPinyin: GlobalSearchPinyinConverter = defaultPinyinConverter
): NamedPinyinSearchIndex<T> {
  const next = createNamedPinyinSearchIndex<T>();
  for (const item of items) {
    const key = getKey(item);
    if (!key || next.entries.has(key)) continue;
    const values = getValues(item);
    const sourceText = normalizedValues(values).join("\n");
    const cached = current.entries.get(key);
    next.entries.set(
      key,
      cached?.sourceText === sourceText
        ? { ...cached, item }
        : createEntry(item, values, toPinyin)
    );
  }
  return next;
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

export function appendUniqueByKey<T>(
  existing: T[] | undefined,
  additions: T[] | undefined,
  getKey: (item: T) => string
): T[] {
  const result = [...(existing || [])];
  const seen = new Set(result.map(getKey));
  for (const item of additions || []) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
