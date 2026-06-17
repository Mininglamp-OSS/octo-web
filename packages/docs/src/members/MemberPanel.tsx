import { useEffect, useState, useCallback } from 'react'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
import {
  listMembers,
  addOrUpdateMember,
  removeMember,
  canRemoveMember,
  UserNotFoundError,
  type Member,
} from './api.ts'
import { InvitePanel } from '../invite/InvitePanel.tsx'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/** Admin-only member management panel (frontend-design §12.1). Hidden when role is not admin. */
export function MemberPanel({
  docId,
  role,
  ownerId,
  onClose,
}: {
  docId: string
  role: Role
  ownerId?: string
  onClose?: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [newUid, setNewUid] = useState('')
  const [newRole, setNewRole] = useState<Role>('writer')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setMembers(await listMembers(docId))
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    if (canManage(role)) void refresh()
  }, [role, refresh])

  // Entry gate: canManage drives visibility (role change auto-hides — §12.1).
  if (!canManage(role)) return null

  const resolvedOwner = ownerId ?? members.find((m) => m.role === 'admin' && m.source === 'direct')?.uid

  async function onAdd() {
    setError(null)
    try {
      await addOrUpdateMember(docId, newUid.trim(), newRole)
      setNewUid('')
      await refresh()
    } catch (e) {
      if (e instanceof UserNotFoundError) {
        setError('That user is not an octo user and cannot be added.')
        return
      }
      setError('Failed to add member.')
    }
  }

  async function onRemove(uid: string) {
    setError(null)
    try {
      await removeMember(docId, uid)
      await refresh()
    } catch {
      setError('Failed to remove member.')
    }
  }

  async function onChangeRole(uid: string, r: Role) {
    setError(null)
    try {
      await addOrUpdateMember(docId, uid, r)
      await refresh()
    } catch {
      setError('Failed to change role.')
    }
  }

  return (
    <section className="octo-member-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>Members</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {loading && <p className="octo-loading">Loading members…</p>}

      {members.map((m) => {
        const isOwner = resolvedOwner != null && m.uid === resolvedOwner
        const removable = resolvedOwner ? canRemoveMember(m, resolvedOwner) : !isOwner
        return (
          <div className="octo-member-row" key={m.uid}>
            <span className="octo-uid">
              {m.uid} {isOwner && <em>(owner)</em>}
              <small style={{ color: 'var(--octo-muted)' }}> · {m.source}</small>
            </span>
            <select
              value={m.role}
              disabled={isOwner}
              onChange={(e) => onChangeRole(m.uid, e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={!removable}
              title={isOwner ? 'The owner cannot be removed' : undefined}
              onClick={() => onRemove(m.uid)}
            >
              Remove
            </button>
          </div>
        )
      })}

      <div className="octo-member-row">
        <input
          className="octo-uid"
          placeholder="octo user id"
          value={newUid}
          onChange={(e) => setNewUid(e.target.value)}
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="button" className="octo-tb-btn" disabled={!newUid.trim()} onClick={onAdd}>
          Add
        </button>
      </div>

      {error && <p className="octo-member-error">{error}</p>}

      <InvitePanel docId={docId} role={role} />
    </section>
  )
}
