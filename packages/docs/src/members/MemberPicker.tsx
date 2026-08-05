import { useEffect, useMemo, useRef, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { fetchAllSpaceMembers, fetchMyBots, fetchSpaceBotSnapshots, t, type SpaceMemberLite } from '../octoweb/index.ts'
import { colorFromId } from '../awareness/presence.ts'
import { sortPickerMembers } from './sort.ts'

const DEFAULT_ROLES: Role[] = ['reader', 'commenter', 'writer', 'admin']

/** First glyph of a name for the fallback avatar (uppercased; '?' when empty). */
function initial(name: string): string {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

/**
 * Candidate roster = Space members ∪ the caller's friend-added agents (fetchMyBots, #839) ∪ the
 * Space Bot snapshot (fetchSpaceBotSnapshots). De-duplicated by uid: the Space-member entry wins a
 * uid collision (richer host data), then a friend agent, then a Space Bot backfills creatorUid so
 * the picker can nest that Bot beneath its creator. Both Bot requests are fail-soft and never break
 * the human roster path.
 */
async function fetchCandidateRoster(space: string): Promise<SpaceMemberLite[]> {
  const [members, myBots, spaceBots] = await Promise.all([
    fetchAllSpaceMembers(space),
    space ? fetchMyBots(space).catch(() => [] as SpaceMemberLite[]) : Promise.resolve([]),
    space ? fetchSpaceBotSnapshots(space).catch(() => [] as SpaceMemberLite[]) : Promise.resolve([]),
  ])
  const byUid = new Map<string, SpaceMemberLite>()
  for (const m of members) byUid.set(m.uid, m)
  // Friend agents the space-member query dropped (#839): append flat, never overwrite a member.
  for (const b of myBots) if (!byUid.has(b.uid)) byUid.set(b.uid, b)
  // Space Bots backfill creatorUid (+ isBot) so a Bot with a known creator nests beneath them,
  // merging onto whatever entry already exists (member/friend) without discarding its richer data.
  for (const b of spaceBots) byUid.set(b.uid, { ...byUid.get(b.uid), ...b, isBot: true })
  return [...byUid.values()]
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
  roles = DEFAULT_ROLES,
  defaultRole,
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
  /** Initial role for a scoped caller. Omit to preserve the rich-doc writer default. */
  defaultRole?: Role
  /** Add the chosen members (one or many) with the chosen role. */
  onAdd: (uids: string[], role: Role, snapshot?: { humanUids: string[]; botUids: string[] }) => Promise<void> | void
  /** True while a parent add/refresh is in flight (disables the Add button). */
  busy?: boolean
}) {
  // An empty roles={[]} would yield an undefined role + empty dropdown; fall back to defaults.
  const effectiveRoles = roles.length > 0 ? roles : DEFAULT_ROLES
  const [members, setMembers] = useState<SpaceMemberLite[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedBots, setSelectedBots] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Default to 'writer' when offered (keeps rich-doc's prior initial), else the sole/first role
  // so a single-role dropdown ('reader' for HTML) is selected without an empty state.
  const [role, setRole] = useState<Role>(
    defaultRole && effectiveRoles.includes(defaultRole)
      ? defaultRole
      : effectiveRoles.includes('writer') ? 'writer' : effectiveRoles[0],
  )
  const previousDefaultRole = useRef(defaultRole)

  useEffect(() => {
    const defaultRoleChanged = previousDefaultRole.current !== defaultRole
    previousDefaultRole.current = defaultRole
    setRole((current) => {
      if (defaultRoleChanged && defaultRole && effectiveRoles.includes(defaultRole)) {
        return defaultRole
      }
      if (effectiveRoles.includes(current)) return current
      if (defaultRole && effectiveRoles.includes(defaultRole)) return defaultRole
      return effectiveRoles.includes('writer') ? 'writer' : effectiveRoles[0]
    })
  }, [roles, defaultRole])

  useEffect(() => {
    let active = true
    setLoading(true)
    void fetchCandidateRoster(space ?? '')
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

  const botsByCreator = useMemo(() => {
    const grouped = new Map<string, SpaceMemberLite[]>()
    const visibleHumanUids = new Set(
      members
        .filter((m) => !m.isBot && !hideUids?.has(m.uid) && !existingUids.has(m.uid))
        .map((m) => m.uid),
    )
    for (const bot of members) {
      if (!bot.isBot || !bot.creatorUid || existingUids.has(bot.uid)) continue
      // Only nest under a visible, addable creator. Otherwise the Bot remains a standalone
      // candidate so creator visibility/membership never removes the Bot's own grantability.
      if (!visibleHumanUids.has(bot.creatorUid)) continue
      grouped.set(bot.creatorUid, [...(grouped.get(bot.creatorUid) ?? []), bot])
    }
    return grouped
  }, [members, existingUids, hideUids])

  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members])
  const humanNameByUid = useMemo(
    () => new Map(members.filter((m) => !m.isBot).map((m) => [m.uid, m.name])),
    [members],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Drop hidden uids (self / owner) from the roster entirely before filtering/sorting.
    const nestedBotUids = new Set<string>()
    for (const bots of botsByCreator.values()) for (const bot of bots) nestedBotUids.add(bot.uid)
    // A known creator may fall back to standalone only at a legitimate document boundary:
    // hidden self/owner or an existing member. An absent creator remains unlisted.
    const topLevel = members.filter(
      (m) => {
        if (!m.isBot || !m.creatorUid) return !nestedBotUids.has(m.uid)
        if (nestedBotUids.has(m.uid)) return false
        return !!hideUids?.has(m.creatorUid) || existingUids.has(m.creatorUid) || existingUids.has(m.uid)
      },
    )
    const roster = hideUids?.size ? topLevel.filter((m) => !hideUids.has(m.uid)) : topLevel
    if (!q) return sortPickerMembers(roster, existingUids)
    // A query matches a human by name/uid OR a creator whose nested Bot matches by name/uid, so
    // typing a Bot's name surfaces its creator row (the Bot is shown beneath, with its creator).
    const base = roster.filter((m) => {
      if (m.name.toLowerCase().includes(q) || m.uid.toLowerCase().includes(q)) return true
      const bots = botsByCreator.get(m.uid) ?? []
      return bots.some((b) => b.name.toLowerCase().includes(q) || b.uid.toLowerCase().includes(q))
    })
    // Already-added members pinned at the top (#A3).
    return sortPickerMembers(base, existingUids)
  }, [members, query, existingUids, hideUids, botsByCreator])

  // Drop selections that are no longer valid after a roster/existing change (e.g. a successful add
  // + refresh, or a row that became existing/hidden). Humans: drop any now-existing OR now-hidden
  // uid so a hidden creator/self/owner can never ride along in the submitted snapshot. Bots: keep
  // only uids still nested and not already present. Bots that become standalone are independently
  // selectable and must no longer ride along with a previously selected creator.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((uid) => !existingUids.has(uid) && !hideUids?.has(uid)))
      return next.size === prev.size ? prev : next
    })
    setSelectedBots((prev) => {
      if (prev.size === 0) return prev
      const offered = new Set<string>()
      for (const bots of botsByCreator.values()) for (const b of bots) offered.add(b.uid)
      const next = new Set([...prev].filter((uid) => offered.has(uid)))
      return next.size === prev.size ? prev : next
    })
  }, [existingUids, hideUids, botsByCreator])

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      const bots = botsByCreator.get(uid) ?? []
      if (next.has(uid)) {
        next.delete(uid)
        setSelectedBots((current) => {
          const copy = new Set(current)
          bots.forEach((bot) => copy.delete(bot.uid))
          return copy
        })
      } else {
        next.add(uid)
        setSelectedBots((current) => new Set([...current, ...bots.map((bot) => bot.uid)]))
      }
      return next
    })
  }

  function toggleBot(uid: string) {
    setSelectedBots((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function add() {
    if (selected.size === 0) return
    const submittedRole = effectiveRoles.includes(role)
      ? role
      : defaultRole && effectiveRoles.includes(defaultRole)
        ? defaultRole
        : effectiveRoles.includes('writer') ? 'writer' : effectiveRoles[0]
    const humanUids = [...selected].filter((uid) => !memberByUid.get(uid)?.isBot)
    const standaloneBotUids = [...selected].filter((uid) => memberByUid.get(uid)?.isBot)
    const botUids = [...new Set([...selectedBots, ...standaloneBotUids])]
    const uids = [...new Set([...humanUids, ...botUids])]
    if (botUids.length > 0) await onAdd(uids, submittedRole, { humanUids, botUids })
    else await onAdd(uids, submittedRole)
    setSelected(new Set())
    setSelectedBots(new Set())
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
          const bots = botsByCreator.get(m.uid) ?? []
          const standaloneCreator = m.isBot && m.creatorUid
            ? humanNameByUid.get(m.creatorUid) || m.creatorUid
            : undefined
          // Surface a creator's Bots when the row is selected, or when the active query matched one
          // of its Bots (so a Bot search reveals it under its creator even before selecting them).
          const q = query.trim().toLowerCase()
          const queryHitsBot =
            !!q && bots.some((b) => b.name.toLowerCase().includes(q) || b.uid.toLowerCase().includes(q))
          const showBots = bots.length > 0 && (isSelected || queryHitsBot)
          const isExpanded = expanded.has(m.uid) || queryHitsBot
          return (
            <div key={m.uid} className="octo-member-picker-group" role="presentation">
            <button
              type="button"
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
              {standaloneCreator && (
                <span className="octo-member-picker-bot-creator">
                  {t('docs.member.botCreator', { values: { name: standaloneCreator } })}
                </span>
              )}
              {added && (
                <span className="octo-member-picker-added">{t('docs.member.alreadyAdded')}</span>
              )}
            </button>
            {showBots && (
              <>
                <button type="button" className="octo-member-picker-expand" aria-expanded={isExpanded}
                  onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(m.uid)) next.delete(m.uid); else next.add(m.uid); return next })}>
                  {t(isExpanded ? 'docs.member.hideBots' : 'docs.member.showBots', { values: { count: bots.length } })}
                </button>
                {isExpanded && bots.map((bot) => (
                  <label key={bot.uid} className="octo-member-picker-bot">
                    <input type="checkbox" checked={selectedBots.has(bot.uid)} onChange={() => toggleBot(bot.uid)} />
                    <span>{bot.name}</span><span className="octo-member-picker-badge">{t('docs.member.aiTag')}</span>
                    <span className="octo-member-picker-bot-creator">{t('docs.member.botCreator', { values: { name: m.name } })}</span>
                  </label>
                ))}
              </>
            )}
            </div>
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
          {selectedBots.size > 0
            ? t('docs.member.addSnapshotCount', { values: { people: count, bots: selectedBots.size } })
            : count > 1
              ? t('docs.member.addCount', { values: { count } })
              : t('docs.member.add')}
        </button>
      </div>
    </div>
  )
}
