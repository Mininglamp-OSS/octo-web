// Access-request REST (feature #511 screen 4c, contract 4). Backend XIN-275 §4.
//
// Calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths (inheriting `/api/v1/`).
// MVP is PULL-based (no push): the admin panel fetches pending requests with
// GET /docs/{docId}/access-requests?status=pending. Approving reuses the forward-grant
// GREATEST semantics server-side (contract 1). Requests are (doc_id, requester)-idempotent so a
// double submit does not create a second row.

import { apiClient, type ApiError } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

/** A pending access request (subset the panel renders). */
export interface AccessRequest {
  requestId: string
  uid: string
  /** ISO timestamp the request was created, when the backend provides it. */
  createdAt?: string
}

interface ListAccessRequestsResult {
  items: AccessRequest[]
}

/** Grantable roles when approving — reader/writer only (mirrors forward-grant, AC-3/AC-16). */
export type AccessRequestRole = 'reader' | 'writer'

/** Distinct marker so the UI can grey the button "already requested" instead of erroring. */
export class AccessRequestConflictError extends Error {
  constructor() {
    super('access_request_conflict')
    this.name = 'AccessRequestConflictError'
  }
}

/**
 * Submit an access request for a doc the caller cannot open (screen 4c apply).
 * 200/201 → submitted; 409 → already requested (surfaced as AccessRequestConflictError so the
 * button can show "Request submitted" without treating it as a failure).
 *
 * `spaceId` MUST be passed on the standalone `/d/:docId` surface: that page mounts before the app
 * shell restores `currentSpaceId`, so the global interceptor injects no `X-Space-Id` and the
 * backend's by-space middleware rejects a bare request (same fix getDoc uses). In-shell callers can
 * omit it — the interceptor supplies the header there.
 */
export async function requestAccess(docId: string, opts?: { spaceId?: string }): Promise<void> {
  const config = opts?.spaceId ? { headers: { 'X-Space-Id': opts.spaceId } } : undefined
  try {
    await apiClient().post(`/docs/${docId}/access-requests`, undefined, config)
  } catch (e) {
    if ((e as ApiError).response?.status === 409) throw new AccessRequestConflictError()
    throw e
  }
}

/** GET the pending access requests for a doc (admin/owner only; pull-based, MVP §4.2). */
export async function listPendingAccessRequests(docId: string): Promise<AccessRequest[]> {
  const { data } = await apiClient().get<ListAccessRequestsResult>(
    `/docs/${docId}/access-requests?status=pending`,
  )
  return data.items ?? []
}

/** Approve a pending request at the chosen role (reuses upsertGrantMax server-side, contract 1). */
export async function approveAccessRequest(
  docId: string,
  requestId: string,
  role: AccessRequestRole,
): Promise<void> {
  await apiClient().post(`/docs/${docId}/access-requests/${requestId}/approve`, { role })
}

/** Deny a pending request. */
export async function denyAccessRequest(docId: string, requestId: string): Promise<void> {
  await apiClient().post(`/docs/${docId}/access-requests/${requestId}/deny`)
}

/** Narrowing helper for callers that want to keep `Role` and `AccessRequestRole` in sync. */
export function isAccessRequestRole(role: Role): role is Role & AccessRequestRole {
  return role === 'reader' || role === 'writer'
}
