// ─── Shared MCP constants ──────────────────────────────────────────────────
// Values that MUST stay byte-for-byte in sync with the backend wire contract
// (octo-marketplace/docs/api/mcp-v1.md §0). Do not localize or reformat these.

/**
 * Legacy placeholder value the frontend used to submit for a header/env key
 * whose value each consumer must fill locally (`*_user_supplied` arrays in
 * mcp-v1.md §5). Since the §5.1 relaxation, user-supplied values are stored
 * verbatim for the owner and blanked to non-owners at read time — the frontend
 * no longer needs to substitute the sentinel on submit. The constant is kept
 * because `entriesFromWire` still normalizes it back to "" when reading a
 * legacy record that persisted the sentinel literal.
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
 * Keys the frontend treats as token-shaped. Used to seed the smart default
 * ON for the KvEditor "user fills locally" toggle when a JSON import
 * introduces a fresh key row — so pasting a Claude Desktop config with an
 * `Authorization` header doesn't accidentally publish a shared blank value.
 *
 * The backend used to run the SAME pattern for a public-secret guardrail
 * (`public_secret_disallowed`), but that rule was removed in the §5.1
 * relaxation — this pattern is now frontend-only. A narrower pattern just
 * degrades the smart-default; nothing else fails.
 */
export const SECRET_KEY_PATTERN =
  /^(authorization|.*authorization|token|.*token|.*key|.*secret|password|.*password|pwd|.*pwd|passwd|pass|passphrase|api[-_]?key|pat|cookie|.*cookie|credential|credentials|.*credential|auth|.*auth|bearer|.*bearer|session|.*session|sessionid|jwt|.*jwt|dsn|.*dsn|connection[-_]?string|.*connection[-_]?string|access|.*access)$/i;

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
