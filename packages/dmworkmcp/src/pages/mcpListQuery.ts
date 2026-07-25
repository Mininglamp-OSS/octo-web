export interface McpListQueryState {
  keyword: string;
  categoriesSelected: string[];
  tagsSelected: string[];
}

export function parseMcpListQuery(search: string): McpListQueryState {
  const q = new URLSearchParams(search);
  return {
    keyword: q.get("keyword") ?? "",
    categoriesSelected: q.getAll("category"),
    tagsSelected: q.getAll("tag"),
  };
}

export function serializeMcpListQuery(state: McpListQueryState, current = ""): string {
  const q = new URLSearchParams(current);
  // `created_by_type` scrubbed too — legacy bookmarks land silently on
  // the unfiltered list rather than carrying a filter no UI can toggle.
  ["keyword", "category", "tag", "created_by_type"].forEach((key) => q.delete(key));
  if (state.keyword.trim()) q.set("keyword", state.keyword.trim());
  state.categoriesSelected.forEach((value) => q.append("category", value));
  state.tagsSelected.forEach((value) => q.append("tag", value));
  return q.toString();
}
