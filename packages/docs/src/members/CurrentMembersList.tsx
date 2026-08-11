import { useRef, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { sortMembersForDisplay, withSyntheticOwner, applyOrderSnapshot } from './sort.ts'
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
 *
 * Any row whose effective role has no matching option in `roles` (e.g. the html owner's `'author'`
 * sentinel, or a historical `admin` grant surfaced on the html reader/commenter/writer surface)
 * renders the role as STATIC text instead of a select. Rendering a select there would leave React
 * with no matching <option>, silently snapping the shown value to option 0 (reader) — which both
 * misrepresents the row's real role and, on change, would downgrade it. Fail closed: no editable
 * control for a role this surface can't grant. This is one uniform rule, not a caller branch.
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
  botUids,
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
  /**
   * uids known to be bots (from the space directory). Bots are grouped below all humans in a
   * default-collapsed section and tagged AI. Fail-soft: an empty set (directory not resolved /
   * fetch failed) means EVERY row renders as a human — a real human is never hidden in the fold.
   */
  botUids?: Set<string>
}) {
  const [botsOpen, setBotsOpen] = useState(false)
  // Frozen display order (need #4): once seeded, a role change updates a row's content but not its
  // position; the panel only re-sorts when it is closed + reopened (this component unmounts) or the
  // owner (document) changes. The snapshot lives for the component's mount lifetime.
  const snapshotRef = useRef<Map<string, number>>(new Map())
  const seededOwnerRef = useRef<string | undefined>(undefined)

  // Order via sort.ts on the adapted Member[]; keep the original display rows keyed by uid so the
  // owner sentinel role survives (the adapter only exists for ranking, not rendering).
  const byUid = new Map(rows.map((r) => [r.uid, r]))
  const bots = botUids ?? new Set<string>()

  // Reset the frozen order when the document (owner) changes — a doc switch must re-sort from
  // scratch rather than carry a stale snapshot from the previous doc.
  if (seededOwnerRef.current !== ownerUid) {
    seededOwnerRef.current = ownerUid
    snapshotRef.current = new Map()
  }

  // Normal role-ranked order (owner pinned → admin → writer → commenter → reader).
  const ranked = sortMembersForDisplay(withSyntheticOwner(rows.map(toSortMember), ownerUid), ownerUid)

  // Seed the snapshot the FIRST time we have non-empty rows (skip the empty first paint so an
  // initial [] never freezes the order to empty). After seeding, freeze order via the snapshot;
  // append brand-new uids to its tail and drop vanished uids so it can't grow unbounded.
  if (ranked.length > 0) {
    if (snapshotRef.current.size === 0) {
      const seeded = new Map<string, number>()
      ranked.forEach((m, i) => seeded.set(m.uid, i))
      snapshotRef.current = seeded
    } else {
      const snap = snapshotRef.current
      const present = new Set(ranked.map((m) => m.uid))
      // Drop uids no longer present (removed members) so the snapshot stays bounded.
      for (const uid of [...snap.keys()]) if (!present.has(uid)) snap.delete(uid)
      // Append any new uid after the current max index, preserving arrival order.
      let next = snap.size ? Math.max(...snap.values()) + 1 : 0
      for (const m of ranked) if (!snap.has(m.uid)) snap.set(m.uid, next++)
    }
  }

  // Apply the frozen order to the ranked rows (a no-op before seeding / when empty).
  const ordered = snapshotRef.current.size > 0 ? applyOrderSnapshot(ranked, snapshotRef.current) : ranked

  // Partition into owner / humans / bots. Partition FIRST, then the snapshot only reorders WITHIN
  // the full list — a role change never moves a row across a partition, so changing a permission
  // can't make a human jump into the bot fold.
  const ownerRows = ordered.filter((sm) => ownerUid != null && sm.uid === ownerUid)
  const humanRows = ordered.filter((sm) => (ownerUid == null || sm.uid !== ownerUid) && !bots.has(sm.uid))
  const botRows = ordered.filter((sm) => (ownerUid == null || sm.uid !== ownerUid) && bots.has(sm.uid))

  function renderRow(sm: Member) {
    const isOwner = ownerUid != null && sm.uid === ownerUid
    const isBotRow = !isOwner && bots.has(sm.uid)
    // Resolve back to the display row; the synthetic owner has no display row, so fall back to
    // the sort member (its uid is all the owner row renders beyond the badge).
    const row = byUid.get(sm.uid) ?? { uid: sm.uid, role: sm.role, source: sm.source }
    const removable = !isOwner && (canRemove ? canRemove(row) : true)
    // The row's effective (display) role is `row.role` — the owner sentinel `'author'` for the
    // html owner, or the real/mapped role otherwise. Editable only when that role has a matching
    // option in `roles`; otherwise show static text (see the file header for why).
    const effectiveRole = row.role
    const roleGrantable = roles.includes(effectiveRole as Role)
    return (
      <div className="octo-member-row" key={sm.uid}>
        <span className="octo-uid">
          {displayName(sm.uid)}{' '}
          {isBotRow && <span className="octo-member-picker-badge">{t('docs.member.aiTag')}</span>}
          {isOwner && <span className="octo-owner-badge">{t('docs.member.ownerBadge')}</span>}
          {!isOwner && (
            <small style={{ color: 'var(--octo-muted)' }}> · {t(`docs.member.source.${row.source}`)}</small>
          )}
        </span>
        {roleGrantable ? (
          <select
            // The effective role has a matching option; the owner row is inert (disabled) but
            // still shows its real role (admin where admin is grantable, i.e. rich).
            value={effectiveRole as Role}
            disabled={isOwner}
            onChange={(e) => onChangeRole(sm.uid, e.target.value as Role)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`docs.role.${r}`)}
              </option>
            ))}
          </select>
        ) : (
          // Role not in this surface's grantable set: render it read-only (no select) so we
          // neither misrepresent it as reader nor allow a silent downgrade on change. The html
          // owner ('author') has no docs.role.* text — it's already covered by the owner badge.
          !isOwner && <span>{t(`docs.role.${effectiveRole}`)}</span>
        )}
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
  }

  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
      {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
      {!loading && ordered.length === 0 && (
        <p className="octo-member-empty">{t('docs.member.empty')}</p>
      )}
      {/* Owner pinned first (even a bot owner), then humans — unchanged tiled behavior. */}
      {ownerRows.map(renderRow)}
      {humanRows.map(renderRow)}
      {/* Bots grouped below all humans behind a default-collapsed expander. Not rendered at all
          when there are no bots (no empty "Show 0 Bots" affordance). */}
      {botRows.length > 0 && (
        <>
          <button
            type="button"
            className="octo-member-picker-expand"
            aria-expanded={botsOpen}
            onClick={() => setBotsOpen((v) => !v)}
          >
            <span className="octo-member-picker-chevron" aria-hidden="true" />
            {t(botsOpen ? 'docs.member.hideBots' : 'docs.member.showBots', {
              values: { count: botRows.length },
            })}
          </button>
          {botsOpen && botRows.map(renderRow)}
        </>
      )}
    </div>
  )
}
