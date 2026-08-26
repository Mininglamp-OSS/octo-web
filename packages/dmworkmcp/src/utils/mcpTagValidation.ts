import { t } from "@octo/base";

/** Max number of tags allowed on a single MCP entry (mirrors dmworkskillmarket
 *  after PR #1026 raised it from 5 to 10). Applied both in the create/edit
 *  form and as a defensive submit-time guard for legacy oversized sets. */
export const MAX_MCP_TAGS = 10;
export const MAX_MCP_TAG_LENGTH = 24;

/** Same allowlist as dmworkskillmarket — letters, digits, whitespace,
 *  and `- _ / . # +`. Anything else is rejected. */
const MCP_TAG_PATTERN = /^[\p{L}\p{N} _./#+-]+$/u;

/** Count characters as visible code points (so wide CJK chars each count as 1
 *  toward MAX_MCP_TAG_LENGTH instead of by UTF-16 units). */
export function tagLength(value: string): number {
  return Array.from(value).length;
}

/** Validate a single tag string. Returns an error message or null when OK.
 *  Empty tags return null so callers can decide whether to add them. */
export function validateMcpTag(value: string): string | null {
  const tag = value.trim();
  if (!tag) return null;
  if (tagLength(tag) > MAX_MCP_TAG_LENGTH) {
    return t("mcp.form.tagLengthLimit", { values: { count: MAX_MCP_TAG_LENGTH } });
  }
  if (!MCP_TAG_PATTERN.test(tag)) {
    return t("mcp.form.tagInvalidChars");
  }
  return null;
}

/** Validate the full tags array — blocks the save button when a legacy row
 *  is loaded with too many tags or a tag that violates the pattern/length
 *  rule. Returns the first error message encountered, or null when clean. */
export function validateMcpTags(tags: string[]): string | null {
  if (tags.length > MAX_MCP_TAGS) {
    return t("mcp.form.tagLimit", { values: { count: MAX_MCP_TAGS } });
  }
  for (const tag of tags) {
    const error = validateMcpTag(tag);
    if (error) return error;
  }
  return null;
}
