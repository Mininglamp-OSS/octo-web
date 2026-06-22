// Invite link REST + accept-response mapping (frontend-design §12.2 / §12.3, backend §8.4).
//
// All calls go through WKApp.apiClient with bare-relative `/docs/...` paths.

import { apiClient, type ApiError } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

export interface Invite {
  inviteToken: string
  /**
   * Shareable accept URL. Built FRONT-END from the current origin
   * (`${window.location.origin}/docs/invite/${inviteToken}`) rather than a backend-derived
   * field — the backend now returns only `{ inviteToken, role }`. Optional/derived: if a legacy
   * backend still sends a `url`, the locally-built origin URL is preferred (it is the correct,
   * environment-accurate one). May be undefined in non-browser contexts.
   */
  url?: string
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

/**
 * Build the shareable invite-accept URL from the front-end's own origin. The route
 * `/docs/invite/:token` is registered by the docs module (module.tsx). Returns an empty string
 * in non-browser contexts (so callers can guard) — the token is still available on the Invite.
 */
export function buildInviteUrl(inviteToken: string): string {
  if (typeof window === 'undefined' || !window.location?.origin) return ''
  return `${window.location.origin}/docs/invite/${inviteToken}`
}

export async function createInvite(docId: string, opts: CreateInviteOptions = {}): Promise<Invite> {
  const { data } = await apiClient().post<Invite>(`/docs/${docId}/invites`, {
    role: opts.role ?? 'writer',
    expiresAt: opts.expiresAt,
    maxUses: opts.maxUses ?? 0, // 0 = unlimited
  })
  // Always prefer the locally-built origin URL over any backend `url` (the secure, correct one).
  return { ...data, url: buildInviteUrl(data.inviteToken) || data.url }
}

export async function listInvites(docId: string): Promise<Invite[]> {
  const { data } = await apiClient().get<{ items: Invite[] }>(`/docs/${docId}/invites`)
  const items = data.items ?? []
  // Re-derive each link from the current origin (don't trust a stale backend `url`).
  return items.map((inv) => ({ ...inv, url: buildInviteUrl(inv.inviteToken) || inv.url }))
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
