// Pure ordering helpers for the member UI (Batch 4 #A3). Kept dependency-free and side-effect
// free so the ordering rules are unit-testable without a live editor / network.

import type { Member } from './api.ts'
import type { Role } from '../auth/roles.ts'
import type { SpaceMemberLite } from '../octoweb/index.ts'

/** Role precedence for the document member list (owner is handled separately, above all). */
const ROLE_RANK: Record<Role, number> = { admin: 0, writer: 1, reader: 2 }

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
