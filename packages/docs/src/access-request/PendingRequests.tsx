// "Pending access requests" area inside the member panel (feature #511 screen 4c admin side).
//
// Admin-only (the parent MemberPanel already gates on canManage). Each row shows the requester
// (resolved to a display name when known), a reader/writer role selector, and Approve / Deny.
// Approving grants at the chosen role (server reuses upsertGrantMax, contract 1).

import { useState } from 'react'
import { t } from '../octoweb/index.ts'
import type { AccessRequestRole } from './api.ts'
import type { UseAccessRequestsResult } from './useAccessRequests.ts'

const REQUEST_ROLES: AccessRequestRole[] = ['reader', 'writer']

export function PendingRequests({
  requests,
  loading,
  error,
  approve,
  deny,
  displayName,
}: {
  requests: UseAccessRequestsResult['requests']
  loading: boolean
  error: boolean
  approve: UseAccessRequestsResult['approve']
  deny: UseAccessRequestsResult['deny']
  /** uid → display name (space member name), falling back to the raw uid. */
  displayName: (uid: string) => string
}) {
  // Per-row chosen role (defaults to reader) and in-flight guard so a double click can't double-act.
  const [roleByReq, setRoleByReq] = useState<Record<string, AccessRequestRole>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const run = async (requestId: string, fn: () => Promise<void>) => {
    if (busy[requestId]) return
    setBusy((b) => ({ ...b, [requestId]: true }))
    try {
      await fn()
    } finally {
      setBusy((b) => ({ ...b, [requestId]: false }))
    }
  }

  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">
        {t('docs.forward.pendingTitle')}
        {requests.length > 0 && <span className="octo-access-badge">{requests.length}</span>}
      </h4>
      {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
      {error && (
        <p className="octo-member-error" role="alert">
          {t('docs.forward.pendingError')}
        </p>
      )}
      {!loading && !error && requests.length === 0 && (
        <p className="octo-member-empty">{t('docs.forward.pendingEmpty')}</p>
      )}
      {requests.map((req) => {
        const role = roleByReq[req.requestId] ?? 'reader'
        const disabled = !!busy[req.requestId]
        return (
          <div className="octo-member-row" key={req.requestId}>
            <span className="octo-uid">{displayName(req.uid)}</span>
            <select
              value={role}
              disabled={disabled}
              onChange={(e) =>
                setRoleByReq((m) => ({ ...m, [req.requestId]: e.target.value as AccessRequestRole }))
              }
            >
              {REQUEST_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`docs.role.${r}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={disabled}
              onClick={() => void run(req.requestId, () => approve(req.requestId, role))}
            >
              {t('docs.forward.approve')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={disabled}
              onClick={() => void run(req.requestId, () => deny(req.requestId))}
            >
              {t('docs.forward.deny')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
