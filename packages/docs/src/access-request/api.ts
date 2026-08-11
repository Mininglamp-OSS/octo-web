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
  /** Bot uid snapshot captured when the requester submitted. */
  botUids?: string[]
  /** ISO timestamp the request was created, when the backend provides it. */
  createdAt?: string
}

interface ListAccessRequestsResult {
  items: AccessRequest[]
}

/** Grantable roles when approving — reader/commenter/writer (no admin; four-role redesign). Mirrors
 *  the docs-backend access-request approve contract (parseReqRole: reader|commenter|writer). */
export type AccessRequestRole = 'reader' | 'commenter' | 'writer'

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
 * `spaceId` is for legacy/in-shell by-space callers only. The standalone forbidden landing omits
 * it deliberately: a 403 open-context response does not reveal the document home Space, and the
 * docId-global backend resolves the target (and validates any owned Bots) from doc_meta.space_id.
 * Sending the viewer's unrelated current Space would reject a valid cross-Space request.
 */
export async function requestAccess(docId: string, opts?: { spaceId?: string; botUids?: string[] }): Promise<void> {
  const config = opts?.spaceId
    ? { headers: { 'X-Space-Id': opts.spaceId } }
    : { suppressSpaceId: true }
  // Zero Bots → send NO body (preserves the pre-feature request shape); only attach a body once
  // the requester actually carries at least one Bot.
  const uids = [...new Set(opts?.botUids ?? [])]
  const body = uids.length > 0 ? { botUids: uids } : undefined
  try {
    await apiClient().post(`/docs/${docId}/access-requests`, body, config)
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
  return role === 'reader' || role === 'commenter' || role === 'writer'
}
