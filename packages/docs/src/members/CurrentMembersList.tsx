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
 * Bots are AI-tagged and NEST under their creator: each top-level row (owner + humans + ownerless
 * bots) carries its own default-collapsed expander for the bots it owns; bots whose creator is
 * unknown or not a top-level row fall into one default-collapsed "ownerless bots" fold at the
 * bottom. The order freeze applies to TOP-LEVEL rows only — nested bots ride along with their
 * creator. Fail-soft: an empty `botUids` set makes every row a human (never hide a real person).
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
  botCreators,
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
   * uids known to be bots (from the space directory). Bots are tagged AI and nested under their
   * creator's row (default-collapsed per creator); bots whose creator is unknown or not a top-level
   * row fall into a single default-collapsed "ownerless bots" fold at the bottom. Fail-soft: an
   * empty set (directory not resolved / fetch failed) means EVERY row renders as a human — a real
   * human is never hidden in the fold.
   */
  botUids?: Set<string>
  /**
   * botUid → creatorUid (from `/robot/space_bots`). A bot whose creator is itself a top-level row is
   * nested beneath that creator; anything else (creator unknown, or not a top-level row) is an
   * "ownerless" bot in the bottom fold. Empty map + non-empty `botUids` ⇒ every bot is ownerless
   * (never hide a bot just because its owner is unknown).
   */
  botCreators?: Map<string, string>
}) {
  // Per-creator expansion (need: each owner's bots collapse independently) + the ownerless fold.
  const [openCreators, setOpenCreators] = useState<Set<string>>(() => new Set())
  const [orphanOpen, setOrphanOpen] = useState(false)
  // Frozen display order (need #4): once seeded, a role change updates a row's content but not its
  // position; the panel only re-sorts when it is closed + reopened (this component unmounts) or the
  // owner (document) changes. The snapshot lives for the component's mount lifetime.
  const snapshotRef = useRef<Map<string, number>>(new Map())
  const seededOwnerRef = useRef<string | undefined>(undefined)

  // Order via sort.ts on the adapted Member[]; keep the original display rows keyed by uid so the
  // owner sentinel role survives (the adapter only exists for ranking, not rendering).
  const byUid = new Map(rows.map((r) => [r.uid, r]))
  const bots = botUids ?? new Set<string>()
  const creators = botCreators ?? new Map<string, string>()

  // Reset the frozen order when the document (owner) changes — a doc switch must re-sort from
  // scratch rather than carry a stale snapshot from the previous doc.
  if (seededOwnerRef.current !== ownerUid) {
    seededOwnerRef.current = ownerUid
    snapshotRef.current = new Map()
  }

  const isBot = (uid: string) => bots.has(uid)
  const isOwnerUid = (uid: string) => ownerUid != null && uid === ownerUid

  // TOP-LEVEL rows = owner + humans + ORPHAN bots (a bot whose creator is unknown, or whose creator
  // is itself not a top-level row). A NESTED bot is a bot whose creator IS a top-level row and gets
  // rendered under that creator. We compute this in the required order: first the top-level SET,
  // then the snapshot over top-level rows, then per-creator bot ordering. A role change can never
  // move a row across these groups (partition is by identity, not role).
  //
  // A bot's creator qualifies as a top-level row iff it is the owner OR a human (non-bot) member
  // present in `rows`, OR a bot member that itself has no resolvable top-level creator (an orphan
  // bot can still own bots). To keep it simple + robust: a creator is a top-level row iff it is
  // NOT a nested bot. We resolve nesting with a single pass since nesting is only one level deep in
  // practice (a bot's creator is a person/owner). Guard against a creator chain / self-reference by
  // treating a creator that is itself a bot-with-a-known-top-level-creator as non-top-level.
  const memberUids = new Set(rows.map((r) => r.uid))
  if (ownerUid != null) memberUids.add(ownerUid)

  // A bot nests iff its creator is present as a member/owner AND that creator is not itself a bot
  // that nests under someone else. Owner and humans always qualify as nest targets.
  const creatorIsTopLevel = (creatorUid: string): boolean => {
    if (!memberUids.has(creatorUid)) return false
    if (isOwnerUid(creatorUid)) return true
    if (!isBot(creatorUid)) return true
    // creator is a bot member: it is top-level only if it is itself an orphan (its own creator is
    // not a top-level row) — avoids hiding a bot under another bot that is itself hidden.
    const grandCreator = creators.get(creatorUid)
    return !grandCreator || !creatorIsTopLevel(grandCreator)
  }

  const nestedCreatorOf = (uid: string): string | undefined => {
    if (!isBot(uid) || isOwnerUid(uid)) return undefined // owner is never nested
    const c = creators.get(uid)
    if (!c || c === uid) return undefined
    return creatorIsTopLevel(c) ? c : undefined
  }

  // Normal role-ranked order (owner pinned → admin → writer → commenter → reader) over ALL rows.
  const ranked = sortMembersForDisplay(withSyntheticOwner(rows.map(toSortMember), ownerUid), ownerUid)

  const isOrphanBot = (uid: string) => isBot(uid) && !isOwnerUid(uid) && nestedCreatorOf(uid) === undefined

  // TOP-LEVEL = everything that is NOT a nested bot: owner + humans + orphan bots. The order freeze
  // (snapshot) applies to this whole set so a role change can't reorder it; we then SPLIT it for
  // rendering (owner/humans tiled at top, orphan bots into the bottom fold) — nested bots ride with
  // their creator and never enter the snapshot.
  const topRanked = ranked.filter((sm) => nestedCreatorOf(sm.uid) === undefined)

  // Seed / maintain the frozen order snapshot over TOP-LEVEL rows only.
  if (topRanked.length > 0) {
    if (snapshotRef.current.size === 0) {
      const seeded = new Map<string, number>()
      topRanked.forEach((m, i) => seeded.set(m.uid, i))
      snapshotRef.current = seeded
    } else {
      const snap = snapshotRef.current
      const present = new Set(topRanked.map((m) => m.uid))
      for (const uid of [...snap.keys()]) if (!present.has(uid)) snap.delete(uid)
      let next = snap.size ? Math.max(...snap.values()) + 1 : 0
      for (const m of topRanked) if (!snap.has(m.uid)) snap.set(m.uid, next++)
    }
  }

  // Apply the frozen order to the top-level rows (a no-op before seeding / when empty).
  const orderedTop = snapshotRef.current.size > 0 ? applyOrderSnapshot(topRanked, snapshotRef.current) : topRanked

  // Split the ordered top-level rows for rendering: owner + humans are tiled directly (each may
  // carry a per-creator bot fold); orphan bots drop into the single bottom fold. Both keep the
  // frozen top-level order.
  const tiledRows = orderedTop.filter((sm) => !isOrphanBot(sm.uid))
  const orphanBots = orderedTop.filter((sm) => isOrphanBot(sm.uid))

  // Nested bots grouped by their (top-level) creator, each group ordered by the SAME role-ranked
  // rules (from `ranked`, which already carries role order + stable tie-break).
  const botsByCreator = new Map<string, Member[]>()
  for (const sm of ranked) {
    if (!isBot(sm.uid) || isOwnerUid(sm.uid)) continue
    const c = nestedCreatorOf(sm.uid)
    if (c === undefined) continue
    const arr = botsByCreator.get(c) ?? []
    arr.push(sm)
    botsByCreator.set(c, arr)
  }

  const tiledSet = new Set(tiledRows.map((m) => m.uid))
  // Defensive: a nested bot whose creator is not actually a tiled row (shouldn't happen given
  // nestedCreatorOf) is demoted to an orphan so it can never vanish (fail-soft: never hide a bot).
  for (const [c, arr] of [...botsByCreator.entries()]) {
    if (!tiledSet.has(c)) {
      orphanBots.push(...arr)
      botsByCreator.delete(c)
    }
  }

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

  const noRows = tiledRows.length === 0 && orphanBots.length === 0
  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
      {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
      {!loading && noRows && (
        <p className="octo-member-empty">{t('docs.member.empty')}</p>
      )}
      {/* Each tiled row (owner pinned first, then humans, in frozen order), with its own bots nested
          directly beneath it behind a per-creator, default-collapsed expander. */}
      {tiledRows.map((sm) => {
        const ownBots = botsByCreator.get(sm.uid) ?? []
        const open = openCreators.has(sm.uid)
        return (
          <div key={sm.uid}>
            {renderRow(sm)}
            {ownBots.length > 0 && (
              <>
                <button
                  type="button"
                  className="octo-member-picker-expand"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenCreators((prev) => {
                      const next = new Set(prev)
                      if (next.has(sm.uid)) next.delete(sm.uid)
                      else next.add(sm.uid)
                      return next
                    })
                  }
                >
                  <span className="octo-member-picker-chevron" aria-hidden="true" />
                  {t(open ? 'docs.member.hideBots' : 'docs.member.showBots', {
                    values: { count: ownBots.length },
                  })}
                </button>
                {open && ownBots.map(renderRow)}
              </>
            )}
          </div>
        )
      })}
      {/* Ownerless bots (creator unknown or not a top-level row) grouped in one default-collapsed
          fold at the bottom. Not rendered at all when there are none (no empty "Show 0 Bots"). */}
      {orphanBots.length > 0 && (
        <>
          <button
            type="button"
            className="octo-member-picker-expand"
            aria-expanded={orphanOpen}
            onClick={() => setOrphanOpen((v) => !v)}
          >
            <span className="octo-member-picker-chevron" aria-hidden="true" />
            {t(orphanOpen ? 'docs.member.hideBots' : 'docs.member.showBots', {
              values: { count: orphanBots.length },
            })}
          </button>
          {orphanOpen && orphanBots.map(renderRow)}
        </>
      )}
    </div>
  )
}
