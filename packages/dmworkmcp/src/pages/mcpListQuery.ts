import type { McpCreatedByType } from "../types/mcp";

export interface McpListQueryState {
  keyword: string;
  categoriesSelected: string[];
  /** Provenance filter (issue #894). Single-select — undefined = 全部来源.
   *  Only `human` and `bot` round-trip today because those are the only
   *  segmented-control pills the toolbar renders; `import` from the wire
   *  enum is intentionally dropped on parse so we can't end up with an
   *  active filter that no pill can display or clear (a shared URL with
   *  ?created_by_type=import would otherwise render every pill inactive
   *  while the list is silently filtered). When #867 lands and the toolbar
   *  gains an "Imported" pill, add `import` to the allowlist below. */
  createdByType?: McpCreatedByType;
}

export function parseMcpListQuery(search: string): McpListQueryState {
  const q = new URLSearchParams(search);
  const raw = q.get("created_by_type");
  const createdByType: McpCreatedByType | undefined =
    raw === "human" || raw === "bot" ? raw : undefined;
  return {
    keyword: q.get("keyword") ?? "",
    categoriesSelected: q.getAll("category"),
    createdByType,
  };
}

export function serializeMcpListQuery(state: McpListQueryState, current = ""): string {
  const q = new URLSearchParams(current);
  ["keyword", "category", "created_by_type"].forEach((key) => q.delete(key));
  if (state.keyword.trim()) q.set("keyword", state.keyword.trim());
  state.categoriesSelected.forEach((value) => q.append("category", value));
  if (state.createdByType) q.set("created_by_type", state.createdByType);
  return q.toString();
}
