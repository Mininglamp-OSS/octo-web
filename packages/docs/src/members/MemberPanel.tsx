import { useEffect, useState, useCallback } from 'react'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import {
  listMembers,
  addOrUpdateMember,
  removeMember,
  canRemoveMember,
  UserNotFoundError,
  type Member,
} from './api.ts'
import { useMemberNames } from './useMemberNames.ts'
import { MemberPicker } from './MemberPicker.tsx'
import { sortMembersForDisplay, withSyntheticOwner } from './sort.ts'
import { InvitePanel } from '../invite/InvitePanel.tsx'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/**
 * Admin-only member management panel (frontend-design §12.1). Hidden when role is not admin.
 *
 * Layout (#5): the "Add member" row and the "Invite" links live at the TOP; the resolved member
 * list (with display NAMES from the space-member seam, #7) follows. `space` is the octo space id
 * used to resolve uid → name; absent/unknown uids fall back to the raw uid.
 */
export function MemberPanel({
  docId,
  role,
  space,
  ownerId,
  onClose,
}: {
  docId: string
  role: Role
  space?: string
  ownerId?: string
  onClose?: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const names = useMemberNames(space ?? '')

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

  /** Display name for a uid (space member name), falling back to the raw uid (#7/#8). */
  const displayName = (uid: string) => names.get(uid) || uid

  async function onAdd(uids: string[], r: Role) {
    setError(null)
    setAdding(true)
    try {
      // #A2: add every picked member with the one chosen role in a single action.
      for (const uid of uids) await addOrUpdateMember(docId, uid.trim(), r)
      await refresh()
    } catch (e) {
      if (e instanceof UserNotFoundError) {
        setError(t('docs.member.errorUserNotFound'))
        return
      }
      setError(t('docs.member.errorAdd'))
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(uid: string) {
    setError(null)
    try {
      await removeMember(docId, uid)
      await refresh()
    } catch {
      setError(t('docs.member.errorRemove'))
    }
  }

  async function onChangeRole(uid: string, r: Role) {
    setError(null)
    try {
      await addOrUpdateMember(docId, uid, r)
      await refresh()
    } catch {
      setError(t('docs.member.errorRole'))
    }
  }

  return (
    <section className="octo-member-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.member.manage')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.member.close')}
          </button>
        )}
      </div>

      {/* #5: "Add member" + "Invite" sit at the top of the members panel. */}
      <div className="octo-member-section">
        <h4 className="octo-member-subtitle">{t('docs.member.addMember')}</h4>
        <MemberPicker
          space={space}
          existingUids={new Set(members.map((m) => m.uid))}
          onAdd={onAdd}
          busy={adding}
        />
        {error && <p className="octo-member-error">{error}</p>}
      </div>

      <div className="octo-member-section">
        <h4 className="octo-member-subtitle">{t('docs.member.inviteTitle')}</h4>
        <InvitePanel docId={docId} role={role} />
      </div>

      <div className="octo-member-section">
        <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
        {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
        {!loading && members.length === 0 && (
          <p className="octo-member-empty">{t('docs.member.empty')}</p>
        )}
        {sortMembersForDisplay(withSyntheticOwner(members, resolvedOwner), resolvedOwner).map((m) => {
          const isOwner = resolvedOwner != null && m.uid === resolvedOwner
          const removable = !isOwner && (resolvedOwner ? canRemoveMember(m, resolvedOwner) : true)
          return (
            <div className="octo-member-row" key={m.uid}>
              <span className="octo-uid">
                {displayName(m.uid)}{' '}
                {isOwner && <span className="octo-owner-badge">{t('docs.member.ownerBadge')}</span>}
                {!isOwner && <small style={{ color: 'var(--octo-muted)' }}> · {m.source}</small>}
              </span>
              <select
                value={m.role}
                disabled={isOwner}
                onChange={(e) => onChangeRole(m.uid, e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`docs.role.${r}`)}
                  </option>
                ))}
              </select>
              {/* The owner row is synthetic (owner lives in doc_meta, not doc_member) — it is not
                  a removable member grant, so it shows no remove button. */}
              {!isOwner && (
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={!removable}
                  onClick={() => onRemove(m.uid)}
                >
                  {t('docs.member.remove')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
