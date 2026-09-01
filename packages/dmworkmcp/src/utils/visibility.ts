import type { McpVisibility } from "../types/mcp";

/** Normalize an untyped wire visibility string to a known McpVisibility so the
 *  card chip always resolves a real i18n label instead of interpolating a raw
 *  backend value into `mcp.visibility.<whatever>`. Mirrors mcpService.mapVisibility:
 *  each recognized scope is preserved (system/space/private/public) and an
 *  unmodeled value degrades to "space" (org-scoped) — the least-surprising,
 *  non-permissive bucket — rather than the platform-public one. */
export function normalizeVisibility(
  v: string | undefined | null
): McpVisibility {
  if (v === "system") return "system";
  if (v === "private") return "private";
  if (v === "public") return "public";
  if (v === "space") return "space";
  return "space";
}
