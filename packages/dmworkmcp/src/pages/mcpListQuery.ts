export interface McpListQueryState {
  keyword: string; categoriesSelected: string[]; transports: string[];
  visibilities: string[]; sources: string[]; verificationStatuses: string[];
  tags: string[]; sort: "relevance" | "updated" | "verified";
}

export function parseMcpListQuery(search: string): McpListQueryState {
  const q = new URLSearchParams(search);
  return { keyword: q.get("keyword") ?? "", categoriesSelected: q.getAll("category"), transports: q.getAll("transport"), visibilities: q.getAll("visibility"), sources: q.getAll("source"), verificationStatuses: q.getAll("verification_status"), tags: q.getAll("tag"), sort: (q.get("sort") as McpListQueryState["sort"]) || "relevance" };
}

export function serializeMcpListQuery(state: McpListQueryState, current = ""): string {
  const q = new URLSearchParams(current); ["keyword","category","transport","visibility","source","verification_status","tag","sort"].forEach((key) => q.delete(key));
  if (state.keyword.trim()) q.set("keyword", state.keyword.trim());
  const add = (key: string, values: string[]) => values.forEach((value) => q.append(key, value));
  add("category", state.categoriesSelected); add("transport", state.transports); add("visibility", state.visibilities); add("source", state.sources); add("verification_status", state.verificationStatuses); add("tag", state.tags);
  if (state.sort !== "relevance") q.set("sort", state.sort); return q.toString();
}
