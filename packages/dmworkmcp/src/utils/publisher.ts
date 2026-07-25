import type { McpListItem } from "../types/mcp";

export function isOfficialMcp(item: Pick<McpListItem, "visibility">): boolean {
  return item.visibility === "system";
}
