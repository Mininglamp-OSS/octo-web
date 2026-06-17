// Invite link REST + accept-response mapping (frontend-design §12.2 / §12.3, backend §8.4).
//
// All calls go through WKApp.apiClient with bare-relative `/docs/...` paths.

import { apiClient, type ApiError } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

export interface Invite {
  inviteToken: string
  url: string
  role: Role
  expiresAt?: string
  maxUses?: number
  usedCount?: number
}

export interface CreateInviteOptions {
  role?: Role
  expiresAt?: string
  /** 0 = unlimited uses. */
  maxUses?: number
}

export async function createInvite(docId: string, opts: CreateInviteOptions = {}): Promise<Invite> {
  const { data } = await apiClient().post<Invite>(`/docs/${docId}/invites`, {
    role: opts.role ?? 'writer',
    expiresAt: opts.expiresAt,
    maxUses: opts.maxUses ?? 0, // 0 = unlimited
  })
  return data
}

export async function listInvites(docId: string): Promise<Invite[]> {
  const { data } = await apiClient().get<{ items: Invite[] }>(`/docs/${docId}/invites`)
  return data.items ?? []
}

export async function revokeInvite(docId: string, inviteToken: string): Promise<void> {
  await apiClient().delete(`/docs/${docId}/invites/${inviteToken}`)
}

// ---- accept flow ----

export interface AcceptSuccess {
  status: 'entered'
  docId: string
  documentName: string
  role: Role
}
export interface AcceptLoginRequired {
  status: 'login-required'
}
export interface AcceptInvalid {
  status: 'invalid'
}
export type AcceptResult = AcceptSuccess | AcceptLoginRequired | AcceptInvalid

/**
 * Map the accept response to a UI state (frontend-design §12.3):
 *   200 -> entered (branches a/b/c/d all return 200 with a role)
 *   401 login_required -> login-required (caller does login-then-redirect-back-retry)
 *   410 invite_invalid -> invalid (terminal)
 * Other errors rethrow.
 */
export async function acceptInvite(inviteToken: string): Promise<AcceptResult> {
  try {
    const { data } = await apiClient().post<{ docId: string; documentName: string; role: Role }>(
      `/docs/invites/${inviteToken}/accept`,
    )
    return { status: 'entered', docId: data.docId, documentName: data.documentName, role: data.role }
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    const code = err.response?.status
    if (code === 401) return { status: 'login-required' }
    if (code === 410) return { status: 'invalid' }
    throw e
  }
}
