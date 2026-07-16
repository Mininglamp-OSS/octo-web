// ─── Shared MCP constants ──────────────────────────────────────────────────
// Values that MUST stay byte-for-byte in sync with the backend wire contract
// (octo-marketplace/docs/api/mcp-v1.md §0). Do not localize or reformat these.

/**
 * Placeholder value the frontend submits for token-like env / header fields the
 * user left blank. The backend (mcp-v1.md §5) treats this sentinel and the empty
 * string as equivalent, so a blank secret never trips `secret_leaked`. The value
 * is fixed ASCII so it never varies with locale.
 *
 * Contract source: mcp-v1.md §0 — must match the backend literal exactly.
 */
export const SECRET_PLACEHOLDER_SENTINEL = "__OCTO_SECRET_PLACEHOLDER__";

/**
 * Reserved category key that disables the category filter on the list
 * endpoints. Mirrors `CATEGORY_KEY_ALL` from mcp-v1.md §0.
 */
export const CATEGORY_KEY_ALL = "all";

/**
 * Keys whose values are treated as secrets by the backend (mcp-v1.md §5.1).
 * A non-empty, non-sentinel value under one of these keys is rejected with
 * `err.marketplace.mcp.secret_leaked`. The frontend uses the same pattern to
 * decide when to substitute the sentinel on submit, so a blank token never
 * reaches the wire as a real value and never causes a whole-request 400.
 *
 * Kept identical to the backend regex in mcp-v1.md §5.1.
 */
export const SECRET_KEY_PATTERN =
  /^(authorization|token|.*token|.*key|.*secret|password|pwd|api[-_]?key)$/i;

/** True when `key` names a token-like field per {@link SECRET_KEY_PATTERN}. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key.trim());
}

/**
 * Safe fallback slug when a name slugifies to the empty string (all non-ASCII,
 * e.g. a pure-Chinese name). A JSON `mcpServers` key must be a stable ASCII
 * identifier, so we never emit an empty key.
 */
export const DEFAULT_SERVER_SLUG = "mcp-server";

/**
 * Turn a display name into an ASCII slug usable as a `mcpServers` JSON key:
 * lowercase, spaces → `-`, drop every non-ASCII char (Chinese names break the
 * copy-paste config), collapse repeated / edge dashes. Returns
 * {@link DEFAULT_SERVER_SLUG} when the result would be empty.
 */
export function slugifyServerName(name: string): string {
  const slug = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || DEFAULT_SERVER_SLUG;
}

/**
 * Replace blank / already-sentinel secret values with the sentinel so the
 * backend accepts them, while leaving a user-typed real value untouched (the
 * backend will then reject it with `secret_leaked`, surfacing the mistake).
 * Non-secret keys pass through verbatim.
 */
export function applySecretSentinel(
  record: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!record) return record;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSecretKey(key) && !value.trim()) {
      out[key] = SECRET_PLACEHOLDER_SENTINEL;
    } else {
      out[key] = value;
    }
  }
  return out;
}
