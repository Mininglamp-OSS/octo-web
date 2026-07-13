import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { fetchAllSpaceMembers, t, type SpaceMemberLite } from '../octoweb/index.ts'
import { colorFromId } from '../awareness/presence.ts'
import { sortPickerMembers } from './sort.ts'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/** First glyph of a name for the fallback avatar (uppercased; '?' when empty). */
function initial(name: string): string {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

/**
 * Searchable, MULTI-SELECT space-member picker (#A2). Lists the real space members (via
 * fetchAllSpaceMembers through the octoweb seam) with avatar + name + a human/AI badge, filters
 * locally by name/uid, pins already-added members at the top (#A3) shown disabled, and lets the
 * admin tick several members then add them all with one role in a single action.
 */
export function MemberPicker({
  space,
  existingUids,
  hideUids,
  onAdd,
  busy,
}: {
  /** Space id used to fetch the member roster; absent → empty list (falls back gracefully). */
  space?: string
  /** uids already on the document (rendered disabled / "already added", pinned to the top). */
  existingUids: Set<string>
  /** uids to omit from the candidate list ENTIRELY (not shown at all) — the current user and the
   *  doc owner, who can never be "added" and shouldn't appear as candidates. */
  hideUids?: Set<string>
  /** Add the chosen members (one or many) with the chosen role. */
  onAdd: (uids: string[], role: Role) => Promise<void> | void
  /** True while a parent add/refresh is in flight (disables the Add button). */
  busy?: boolean
}) {
  const [members, setMembers] = useState<SpaceMemberLite[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [role, setRole] = useState<Role>('writer')

  useEffect(() => {
    let active = true
    setLoading(true)
    void fetchAllSpaceMembers(space ?? '')
      .then((list) => {
        if (active) setMembers(list)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [space])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Drop hidden uids (self / owner) from the roster entirely before filtering/sorting.
    const roster = hideUids?.size ? members.filter((m) => !hideUids.has(m.uid)) : members
    const base = q
      ? roster.filter(
          (m) => m.name.toLowerCase().includes(q) || m.uid.toLowerCase().includes(q),
        )
      : roster
    // Already-added members pinned at the top (#A3).
    return sortPickerMembers(base, existingUids)
  }, [members, query, existingUids, hideUids])

  // Drop selections that have been added elsewhere (e.g. after a successful add + refresh).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((uid) => !existingUids.has(uid)))
      return next.size === prev.size ? prev : next
    })
  }, [existingUids])

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function add() {
    if (selected.size === 0) return
    await onAdd([...selected], role)
    setSelected(new Set())
    setQuery('')
  }

  const count = selected.size

  return (
    <div className="octo-member-picker">
      <input
        className="octo-member-picker-search"
        placeholder={t('docs.member.pickPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="octo-member-picker-list" role="listbox" aria-multiselectable="true">
        {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
        {!loading && filtered.length === 0 && (
          <p className="octo-member-picker-empty">{t('docs.member.noMembers')}</p>
        )}
        {filtered.map((m) => {
          const added = existingUids.has(m.uid)
          const isSelected = selected.has(m.uid)
          return (
            <button
              type="button"
              key={m.uid}
              role="option"
              aria-selected={isSelected || added}
              className={
                'octo-member-picker-item' +
                (isSelected ? ' is-selected' : '') +
                (added ? ' is-added' : '')
              }
              disabled={added}
              title={added ? t('docs.member.alreadyAdded') : undefined}
              onClick={() => toggle(m.uid)}
            >
              <span
                className={'octo-member-picker-check' + (isSelected ? ' is-checked' : '')}
                aria-hidden="true"
              >
                {isSelected ? '✓' : ''}
              </span>
              <span
                className="octo-member-picker-avatar"
                style={m.avatar ? undefined : { backgroundColor: colorFromId(m.uid) }}
              >
                {m.avatar ? <img src={m.avatar} alt="" /> : initial(m.name)}
              </span>
              <span className="octo-member-picker-name">{m.name}</span>
              {m.isBot && <span className="octo-member-picker-badge">{t('docs.member.aiTag')}</span>}
              {added && (
                <span className="octo-member-picker-added">{t('docs.member.alreadyAdded')}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="octo-member-picker-actions">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`docs.role.${r}`)}
            </option>
          ))}
        </select>
        <button type="button" className="octo-tb-btn" disabled={count === 0 || busy} onClick={add}>
          {count > 1 ? t('docs.member.addCount', { values: { count } }) : t('docs.member.add')}
        </button>
      </div>
    </div>
  )
}
