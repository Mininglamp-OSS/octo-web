import type { McpListItem } from "../types/mcp";

export function isOfficialMcp(item: Pick<McpListItem, "visibility">): boolean {
  return item.visibility === "system";
}

/** An expert/squad published by the platform (visibility=system) — same rule
 *  as isOfficialMcp, kept separate so the two entity types stay decoupled. */
export function isOfficialExpert(item: { visibility?: string }): boolean {
  return item.visibility === "system";
}
