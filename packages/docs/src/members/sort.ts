// Pure ordering helpers for the member UI (Batch 4 #A3). Kept dependency-free and side-effect
// free so the ordering rules are unit-testable without a live editor / network.

import type { Member } from './api.ts'
import type { Role } from '../auth/roles.ts'
import type { SpaceMemberLite } from '../octoweb/index.ts'

/** Role precedence for the document member list (owner is handled separately, above all). */
const ROLE_RANK: Record<Role, number> = { admin: 0, writer: 1, commenter: 2, reader: 3 }

/**
 * Ensure the document owner appears in the member list (#A1/#A3, Option A — front-end synthesis).
 *
 * The backend's `GET /docs/{docId}/members` returns only `doc_member` rows and EXCLUDES the
 * owner (the owner identity lives in `doc_meta.owner_id`, a deliberate backend design that keeps
 * ownership separate from the member-grant table). So the owner row would otherwise be missing
 * from the list, leaving the owner badge with nothing to attach to. We synthesize an owner row
 * from the already-wired `ownerId` and pin it first. Defensive de-dup: if the owner ever DOES
 * appear in `members` (not the case today, but future-proof), we keep the real row and do not
 * add a duplicate. The synthetic row is marked `source: 'owner'` so the panel can render it as
 * non-removable. Pure → unit-testable.
 */
export function withSyntheticOwner(members: Member[], ownerId?: string): Member[] {
  if (!ownerId) return members
  if (members.some((m) => m.uid === ownerId)) return members
  const ownerRow: Member = { uid: ownerId, role: 'admin', source: 'owner', grantedBy: '' }
  return [ownerRow, ...members]
}

/**
 * Order the document member list (#A3): the owner is pinned first, then admins → writers →
 * readers, ties broken by original (backend) order so the list is stable across refreshes.
 */
export function sortMembersForDisplay(members: Member[], ownerId?: string): Member[] {
  return members
    .map((m, i) => [m, i] as const)
    .sort((a, b) => {
      const ao = ownerId && a[0].uid === ownerId ? 0 : 1
      const bo = ownerId && b[0].uid === ownerId ? 0 : 1
      if (ao !== bo) return ao - bo
      const ar = ROLE_RANK[a[0].role] ?? 9
      const br = ROLE_RANK[b[0].role] ?? 9
      if (ar !== br) return ar - br
      return a[1] - b[1]
    })
    .map(([m]) => m)
}

/**
 * Apply a frozen order snapshot to a set of rows (need #4). Given `snapshot` mapping uid → a fixed
 * index, rows are ordered by that index so a role change (which would otherwise re-rank a row via
 * sortMembersForDisplay) does NOT move the row. Behavior:
 *   - a uid present in the snapshot keeps its snapshot index (stable regardless of its new role);
 *   - a uid absent from the snapshot (newly added since the snapshot was taken) is appended AFTER
 *     all snapshot rows, preserving the relative order in which such new uids arrive in `rows`;
 *   - a uid that has disappeared from `rows` simply does not appear (nothing to place).
 *
 * Pure + side-effect free (independent of sortMembersForDisplay / withSyntheticOwner). Callers seed
 * the snapshot once from the normal sorted order, then keep using this so the visible order is
 * frozen until the snapshot is discarded (panel reopen / doc switch).
 */
export function applyOrderSnapshot<T extends { uid: string }>(
  rows: T[],
  snapshot: Map<string, number>,
): T[] {
  return rows
    .map((row, i) => [row, i] as const)
    .sort((a, b) => {
      const ai = snapshot.get(a[0].uid)
      const bi = snapshot.get(b[0].uid)
      const aKnown = ai !== undefined
      const bKnown = bi !== undefined
      // Snapshot rows come before any brand-new (unsnapshotted) rows.
      if (aKnown !== bKnown) return aKnown ? -1 : 1
      // Both in the snapshot: order by the frozen index.
      if (aKnown && bKnown) return ai - bi
      // Both new: keep their incoming relative order (stable append).
      return a[1] - b[1]
    })
    .map(([row]) => row)
}

/**
 * Case-fold `s` WITHOUT changing its length, so indices computed on the folded string still address
 * the original string. Plain `toLowerCase()` is not length-stable: some code points lower-case into a
 * different number of UTF-16 units (e.g. Turkish 'İ' U+0130 → 'i' + U+0307, 1 unit → 2), which would
 * shift every index after it and highlight the WRONG characters. Any code point whose lower-case form
 * has a different length is left as-is: that character then only matches case-sensitively, which is
 * the safe direction (no highlight beats a misplaced highlight).
 */
function foldKeepingLength(s: string): string {
  let out = ''
  for (const ch of s) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

/**
 * All case-insensitive match ranges of `query` inside `text`, as half-open [start, end) pairs over
 * the ORIGINAL string (so callers can slice `text` and preserve its original casing). Every
 * occurrence is returned, not just the first. Empty query, empty text, or no hit → `[]`.
 *
 * Guard: a zero-length query (empty or, after we do NOT trim here, a caller passing '') must return
 * `[]` — `indexOf('')` returns 0 forever and would otherwise spin. Callers that treat pure-whitespace
 * as "no query" should trim before calling; a non-empty whitespace query still matches literally.
 *
 * Index safety: folding is length-preserving (see foldKeepingLength), so a returned range always
 * slices the intended characters out of `text`. Matches are non-overlapping (the scan resumes after
 * the previous hit) and every range stays within `[0, text.length]`.
 */
export function findMatchRanges(text: string, query: string): Array<[number, number]> {
  if (!text || !query) return []
  const hay = foldKeepingLength(text)
  const needle = foldKeepingLength(query)
  const ranges: Array<[number, number]> = []
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) break
    ranges.push([at, at + needle.length])
    from = at + needle.length // non-overlapping; needle.length > 0 guaranteed above
  }
  return ranges
}

/** Whether `text` contains `query` case-insensitively — the picker's single matching predicate
 *  (mirrors the `.toLowerCase().includes` filter), reused so JSX never re-implements it. */
export function matchesQuery(text: string, query: string): boolean {
  if (!query) return false
  return text.toLowerCase().includes(query.toLowerCase())
}

/**
 * Order the picker roster (#A3): members already on the document are pinned at the top (they are
 * shown disabled/marked) so the admin can see who is already in, with the original order preserved
 * within each group.
 */
export function sortPickerMembers(
  members: SpaceMemberLite[],
  existing: Set<string>,
): SpaceMemberLite[] {
  return members
    .map((m, i) => [m, i] as const)
    .sort((a, b) => {
      const ax = existing.has(a[0].uid) ? 0 : 1
      const bx = existing.has(b[0].uid) ? 0 : 1
      if (ax !== bx) return ax - bx
      return a[1] - b[1]
    })
    .map(([m]) => m)
}
