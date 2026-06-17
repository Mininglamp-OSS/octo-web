import { useEffect, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
import { createInvite, listInvites, revokeInvite, type Invite } from './api.ts'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/** Admin-only invite link management (frontend-design §12.2). */
export function InvitePanel({ docId, role }: { docId: string; role: Role }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [newRole, setNewRole] = useState<Role>('writer')

  async function refresh() {
    setInvites(await listInvites(docId))
  }

  useEffect(() => {
    if (canManage(role)) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, role])

  if (!canManage(role)) return null

  async function onGenerate() {
    await createInvite(docId, { role: newRole, maxUses: 0 })
    await refresh()
  }

  async function onRevoke(token: string) {
    await revokeInvite(docId, token)
    await refresh()
  }

  return (
    <div className="octo-invite-panel">
      <div className="octo-member-row">
        <h4 style={{ flex: 1, margin: '8px 0' }}>Invite links</h4>
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="button" className="octo-tb-btn" onClick={onGenerate}>
          Generate
        </button>
      </div>
      {invites.map((inv) => (
        <div className="octo-member-row" key={inv.inviteToken}>
          <input className="octo-uid" readOnly value={inv.url} onFocus={(e) => e.currentTarget.select()} />
          <span style={{ fontSize: 12, color: 'var(--octo-muted)' }}>
            {inv.role}
            {inv.maxUses === 0 ? ' · unlimited' : inv.maxUses != null ? ` · ${inv.usedCount ?? 0}/${inv.maxUses}` : ''}
          </span>
          <button type="button" className="octo-tb-btn" onClick={() => onRevoke(inv.inviteToken)}>
            Revoke
          </button>
        </div>
      ))}
    </div>
  )
}
