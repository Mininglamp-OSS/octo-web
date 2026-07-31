// Forward-grant REST (feature #511, contract 1). Backend XIN-275.
//
// Calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths (inheriting `/api/v1/`).
// Forward-grant is a DISTINCT endpoint from member management (PUT /docs/{docId}/members): it
// runs `upsertGrantMax` (GREATEST — only升不降, source=direct) so it can never demote an existing
// member, and it is (doc_id, uid)-idempotent (no client-side idempotency key — contract 3).
//
// Path/param naming is "待后端 XIN-275 确认" (POST /docs/{docId}/forward-grant vs a members mode
// flag). The stable contract the frontend relies on is: single uid, body `{ uid, role }`, per-uid
// status 200 / 404 / 403. If the backend finalizes a different path, only this file changes.

import { apiClient, type ApiError } from '../octoweb/index.ts'

/** Roles a forwarder may grant — reader/writer only (no commenter/admin, AC-3/AC-16). */
export type ForwardGrantRole = 'reader' | 'writer'

/** Per-uid grant outcome, mapped from the HTTP status so the caller can aggregate N/M. */
export type ForwardGrantOutcome = 'ok' | 'not_found' | 'forbidden' | 'error'

/**
 * Grant one uid access to a doc via the forward-grant endpoint.
 * 200 → 'ok' (real upgrade OR already ≥ target level — both are idempotent success);
 * 404 → 'not_found' (uid is not a registered octo user);
 * 403 → 'forbidden' (forwarder is not admin/owner — backend double-checks, E-10);
 * anything else / network → 'error' (retryable; the run does not roll back — contract 2).
 */
export async function grantForward(
  docId: string,
  uid: string,
  role: ForwardGrantRole,
): Promise<ForwardGrantOutcome> {
  try {
    await apiClient().post(`/docs/${docId}/forward-grant`, { uid, role })
    return 'ok'
  } catch (e) {
    const status = (e as ApiError).response?.status
    if (status === 404) return 'not_found'
    if (status === 403) return 'forbidden'
    return 'error'
  }
}

/** Aggregate result of a grant loop over a uid snapshot (host reads it to compose the Toast). */
export interface GrantForwardResult {
  granted: number
  failed: number
  /** uids that failed (not_found / forbidden / error), for the partial-failure hint. */
  failures?: string[]
}

/**
 * Grant a whole uid snapshot, one call per uid (contract 2: no batch endpoint — the frontend
 * loops). Part failures do NOT roll back the successes; each `ok` is GREATEST-idempotent, each
 * failure is retryable. De-dupes the uid list defensively so a member appearing twice (e.g. in
 * two selected groups) is granted once.
 */
export async function grantForwardMany(
  docId: string,
  uids: string[],
  role: ForwardGrantRole,
): Promise<GrantForwardResult> {
  const unique = [...new Set(uids.filter(Boolean))]
  let granted = 0
  const failures: string[] = []
  for (const uid of unique) {
    const outcome = await grantForward(docId, uid, role)
    if (outcome === 'ok') granted++
    else failures.push(uid)
  }
  return failures.length > 0 ? { granted, failed: failures.length, failures } : { granted, failed: 0 }
}
