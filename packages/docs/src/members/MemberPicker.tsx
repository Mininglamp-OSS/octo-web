import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import {
  fetchSpaceRoster,
  fetchMyBots,
  searchSpaceMembers,
  t,
  type SpaceMemberLite,
} from '../octoweb/index.ts'
import { colorFromId } from '../awareness/presence.ts'
import { sortPickerMembers } from './sort.ts'

const DEFAULT_ROLES: Role[] = ['reader', 'writer', 'admin']

/** Debounce (ms) for search-as-you-type so a large space gets one backend search per pause. */
const SEARCH_DEBOUNCE_MS = 250

/** First glyph of a name for the fallback avatar (uppercased; '?' when empty). */
function initial(name: string): string {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

/**
 * Searchable, MULTI-SELECT space-member picker (#A2). Shows the space roster (avatar + name +
 * human/AI badge), lets the admin tick several members and add them with one role, and pins
 * already-added members at the top (#A3) shown disabled.
 *
 * Search is SERVER-SIDE (debounced): typing a keyword calls searchSpaceMembers so a match is
 * found regardless of roster size — the old client-side filter over a 1000-capped local fetch
 * meant everyone past the cap (5760-member space observed) was unsearchable. The empty-query
 * browse view also pulls server-side via fetchSpaceRoster (full roster, no 1000 cap), matching
 * the top global search's model. The caller's friend-added agents (fetchMyBots, #839) are
 * unioned in and filtered client-side by the same keyword; a my_bots failure resolves to [] so
 * it never breaks the human-member path.
 */
export function MemberPicker({
  space,
  existingUids,
  hideUids,
  roles = DEFAULT_ROLES,
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
  /** Grantable roles for the dropdown. Default = all three (rich-doc unchanged). HTML docs pass
   *  ['reader'] so only the single "只读" option shows — backend grants only accept reader there. */
  roles?: Role[]
  /** Add the chosen members (one or many) with the chosen role. */
  onAdd: (uids: string[], role: Role) => Promise<void> | void
  /** True while a parent add/refresh is in flight (disables the Add button). */
  busy?: boolean
}) {
  // An empty roles={[]} would yield an undefined role + empty dropdown; fall back to defaults.
  const effectiveRoles = roles.length > 0 ? roles : DEFAULT_ROLES
  // Human space members for the current view: the browse roster (empty query) or the server-side
  // search hits (non-empty query). Friend agents are tracked separately and merged in `filtered`.
  const [spaceMembers, setSpaceMembers] = useState<SpaceMemberLite[]>([])
  const [bots, setBots] = useState<SpaceMemberLite[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Default to 'writer' when offered (keeps rich-doc's prior initial), else the sole/first role
  // so a single-role dropdown ('reader' for HTML) is selected without an empty state.
  const [role, setRole] = useState<Role>(
    effectiveRoles.includes('writer') ? 'writer' : effectiveRoles[0],
  )

  // Debounce the raw query so search-as-you-type issues at most one backend search per pause,
  // not one request per keystroke against a multi-thousand-member roster.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Friend-added agents (my_bots) are a small, caller-scoped dimension: fetch once per space and
  // filter locally. A failure resolves to [] so it never breaks the human-member path (#839).
  useEffect(() => {
    let active = true
    if (!space) {
      setBots([])
      return () => {
        active = false
      }
    }
    void fetchMyBots(space)
      .catch(() => [] as SpaceMemberLite[])
      .then((list) => {
        if (active) setBots(list)
      })
    return () => {
      active = false
    }
  }, [space])

  // Space members: with a keyword, search server-side (finds matches past the browse cap); empty
  // query shows the first roster page(s) as a browse view (carries avatars).
  useEffect(() => {
    let active = true
    setLoading(true)
    const load = debouncedQuery
      ? searchSpaceMembers(space ?? '', debouncedQuery)
      : fetchSpaceRoster(space ?? '')
    void load
      .then((list) => {
        if (active) setSpaceMembers(list)
      })
      .catch(() => {
        if (active) setSpaceMembers([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [space, debouncedQuery])

  const filtered = useMemo(() => {
    const q = debouncedQuery.toLowerCase()
    // Friend agents are filtered client-side by the same keyword (space members already come
    // back server-filtered when a query is set, or as the browse page when it isn't).
    const botMatches = q
      ? bots.filter((b) => b.name.toLowerCase().includes(q) || b.uid.toLowerCase().includes(q))
      : bots
    // Space-member entry wins on a uid collision (richer host data); friend agent appended (#839).
    const byUid = new Map<string, SpaceMemberLite>()
    for (const m of spaceMembers) byUid.set(m.uid, m)
    for (const b of botMatches) if (!byUid.has(b.uid)) byUid.set(b.uid, b)
    let roster = [...byUid.values()]
    // Drop hidden uids (self / owner) entirely before sorting.
    if (hideUids?.size) roster = roster.filter((m) => !hideUids.has(m.uid))
    // Already-added members pinned at the top (#A3).
    return sortPickerMembers(roster, existingUids)
  }, [spaceMembers, bots, debouncedQuery, existingUids, hideUids])

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
          {effectiveRoles.map((r) => (
            <option key={r} value={r}>
              {t(`docs.role.${r}`)}
            </option>
          ))}
        </select>
        <button type="button" className="octo-doc-primary-btn" disabled={count === 0 || busy} onClick={add}>
          {count > 1 ? t('docs.member.addCount', { values: { count } }) : t('docs.member.add')}
        </button>
      </div>
    </div>
  )
}
