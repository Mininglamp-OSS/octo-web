import type { Role } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { sortMembersForDisplay, withSyntheticOwner } from './sort.ts'
import type { Member } from './api.ts'

/**
 * Shared "current members" list for the rich-doc (MemberPanel) and HTML (HtmlMemberPanel) panels.
 *
 * Pure presentation + callbacks — no network. Both panels feed it their own `rows` and mutation
 * callbacks; the ordering (owner pinned → admin → writer → commenter → reader, stable within a
 * tier) is applied here via sort.ts so the two surfaces stay byte-identical.
 *
 * The owner is a synthetic row (owner identity lives outside the grant table): it carries the
 * fixed owner badge, a disabled role select, and no remove button. Non-owner rows show ` · source`
 * and an editable role select limited to `roles` (the caller narrows the surface — html omits admin
 * so it can never be minted through /grants).
 */

/** A row's role may be a real Role or the owner sentinel `'author'` (never a doc_member role). */
export interface CurrentMemberRow {
  uid: string
  role: Role | 'author'
  source: 'direct' | 'invite' | 'owner'
}

/**
 * Adapt a display row to the rich-doc `Member` shape sort.ts consumes. The owner sentinel role
 * `'author'` is mapped to `'admin'` purely for ranking — the synthetic owner is pinned first by
 * `ownerUid` anyway, so the mapped role never affects placement, and this keeps sort.ts's public
 * `Member` signature untouched (no widening of the Role union).
 */
function toSortMember(row: CurrentMemberRow): Member {
  return {
    uid: row.uid,
    role: row.role === 'author' ? 'admin' : row.role,
    source: row.source,
    grantedBy: '',
  }
}

export function CurrentMembersList({
  rows,
  ownerUid,
  roles,
  displayName,
  loading,
  onChangeRole,
  onRemove,
  canRemove,
}: {
  rows: CurrentMemberRow[]
  ownerUid?: string
  /** Grantable role set for the row selects (rich: 4 roles; html: reader/commenter/writer). */
  roles: Role[]
  displayName: (uid: string) => string
  loading?: boolean
  onChangeRole: (uid: string, role: Role) => void | Promise<void>
  onRemove: (uid: string) => void | Promise<void>
  /** Whether a (non-owner) row may be removed. Default: any non-owner row is removable. */
  canRemove?: (row: CurrentMemberRow) => boolean
}) {
  // Order via sort.ts on the adapted Member[]; keep the original display rows keyed by uid so the
  // owner sentinel role survives (the adapter only exists for ranking, not rendering).
  const byUid = new Map(rows.map((r) => [r.uid, r]))
  const sorted = sortMembersForDisplay(withSyntheticOwner(rows.map(toSortMember), ownerUid), ownerUid)

  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
      {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
      {!loading && sorted.length === 0 && (
        <p className="octo-member-empty">{t('docs.member.empty')}</p>
      )}
      {sorted.map((sm) => {
        const isOwner = ownerUid != null && sm.uid === ownerUid
        // Resolve back to the display row; the synthetic owner has no display row, so fall back to
        // the sort member (its uid is all the owner row renders beyond the badge).
        const row = byUid.get(sm.uid) ?? { uid: sm.uid, role: sm.role, source: sm.source }
        const removable = !isOwner && (canRemove ? canRemove(row) : true)
        return (
          <div className="octo-member-row" key={sm.uid}>
            <span className="octo-uid">
              {displayName(sm.uid)}{' '}
              {isOwner && <span className="octo-owner-badge">{t('docs.member.ownerBadge')}</span>}
              {!isOwner && (
                <small style={{ color: 'var(--octo-muted)' }}> · {t(`docs.member.source.${row.source}`)}</small>
              )}
            </span>
            <select
              // Owner is disabled; use the ranking role (admin) as its shown value so it maps to a
              // real option where admin is grantable (rich) and stays inert otherwise (html).
              value={isOwner ? (sm.role as Role) : (row.role as Role)}
              disabled={isOwner}
              onChange={(e) => onChangeRole(sm.uid, e.target.value as Role)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`docs.role.${r}`)}
                </option>
              ))}
            </select>
            {/* The owner row is synthetic (owner lives outside doc_member) — not a removable grant,
                so it shows no remove button. */}
            {!isOwner && (
              <button
                type="button"
                className="octo-tb-btn"
                disabled={!removable}
                onClick={() => onRemove(sm.uid)}
              >
                {t('docs.member.remove')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
