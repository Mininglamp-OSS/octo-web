// Member management REST (frontend-design §12.1, backend §8.4).
//
// All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting the
// `/api/v1/` baseURL -> `/api/v1/docs/...`. The global interceptor injects the octo `token`
// header; no auth code here. Management is admin-gated by the caller (canManage).

import { apiClient, type ApiError } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

export interface Member {
  uid: string
  role: Role
  source: 'direct' | 'invite' | 'owner'
  grantedBy: string
}

export interface ListMembersResult {
  items: Member[]
}

/** Marker error so the UI can surface "user is not an octo user" distinctly (404 user_not_found). */
export class UserNotFoundError extends Error {
  constructor() {
    super('user_not_found')
    this.name = 'UserNotFoundError'
  }
}

export async function listMembers(docId: string): Promise<Member[]> {
  const { data } = await apiClient().get<ListMembersResult>(`/docs/${docId}/members`)
  return data.items ?? []
}

/**
 * Add or change a member's role (PUT, upsert by uid). A 404 with `user_not_found` means the
 * uid is not a registered octo user — surfaced as UserNotFoundError, not swallowed (§12.1).
 */
export async function addOrUpdateMember(docId: string, uid: string, role: Role): Promise<void> {
  try {
    await apiClient().put(`/docs/${docId}/members`, { uid, role })
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    if (err.response?.status === 404 && err.response.data?.error === 'user_not_found') {
      throw new UserNotFoundError()
    }
    throw e
  }
}

export async function removeMember(docId: string, uid: string): Promise<void> {
  await apiClient().delete(`/docs/${docId}/members/${uid}`)
}

/** owner_id may not be removed/demoted — disable controls on the owner row (§12.1). */
export function canRemoveMember(member: Member, ownerId: string): boolean {
  return member.uid !== ownerId
}
