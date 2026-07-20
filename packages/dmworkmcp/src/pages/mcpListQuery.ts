export interface McpListQueryState {
  keyword: string;
  categoriesSelected: string[];
}

export function parseMcpListQuery(search: string): McpListQueryState {
  const q = new URLSearchParams(search);
  return {
    keyword: q.get("keyword") ?? "",
    categoriesSelected: q.getAll("category"),
  };
}

export function serializeMcpListQuery(state: McpListQueryState, current = ""): string {
  const q = new URLSearchParams(current);
  ["keyword", "category"].forEach((key) => q.delete(key));
  if (state.keyword.trim()) q.set("keyword", state.keyword.trim());
  state.categoriesSelected.forEach((value) => q.append("category", value));
  return q.toString();
}
