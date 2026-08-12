// Pure helpers for the "search hits self" contacts injection.
//
// Extracted from GlobalSearchVM so the matching + entry-build logic is
// independently unit-testable — the VM's transitive imports pull in
// react-virtuoso ESM that the current vitest harness can't resolve, so
// only helper-level tests reliably run in CI.
//
// Contract: `shouldInjectSelf` uses trim()+toLowerCase() on both keyword
// and selfName to match the rest of the search stack:
//   - createGlobalSearchDataSource.loadSenderCandidates: `keyword.trim().toLowerCase()`
//     (packages/dmworkbase/src/bridge/globalSearch/createGlobalSearchDataSource.ts)
//   - Backend /v1/search/global name filter: MySQL LIKE with default collation
//     (utf8mb4_general_ci ~ case-insensitive)
// Without normalization a user named "Alice" searching "alice" (or "Alice ")
// gets a self-injection miss even though the rest of the pipeline matches —
// this is the RC-1368 Jerry-Xin blocker.
//
// `buildSelfContactEntry` returns a RAW channel_name (no `<mark>` wrapping).
// The Contacts tab renderer (Components/GlobalSearch/tab-contacts.tsx
// renderItem) is the single source of highlighting: it wraps the raw
// keyword in `<mark>` when it matches the raw channel_name. Pre-wrapping
// here would risk `<mark><mark>...</mark></mark>` double-wrap when the
// renderer sees the same raw substring again inside our marked value.
// One highlight authority ⇒ predictable behavior.

/** Wire shape of a Contacts-tab friend entry (subset used by TabContacts). */
export interface SelfContactEntry {
  channel_id: string;
  channel_type: number;
  channel_name: string;
  channel_remark: string;
}

/**
 * Decide whether the keyword hits selfName under the same normalization
 * as the rest of the search stack (trim + case-insensitive substring).
 * Returns false for empty/whitespace-only keyword or missing selfName.
 */
export function shouldInjectSelf(
  keyword: string | undefined,
  selfName: string | undefined
): boolean {
  if (!keyword || !selfName) return false;
  const kw = keyword.trim().toLowerCase();
  if (kw.length === 0) return false;
  return selfName.trim().toLowerCase().indexOf(kw) !== -1;
}

/**
 * Build the friend-shaped entry the Contacts tab renders for "me".
 * Raw name (renderer owns highlighting); channel_remark left empty so
 * downstream "remark overrides name" logic is a no-op.
 */
export function buildSelfContactEntry(
  selfUid: string,
  selfName: string,
  channelTypePerson: number
): SelfContactEntry {
  return {
    channel_id: selfUid,
    channel_type: channelTypePerson,
    channel_name: selfName,
    channel_remark: "",
  };
}
