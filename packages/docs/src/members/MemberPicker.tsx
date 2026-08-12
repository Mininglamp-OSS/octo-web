import { useEffect, useMemo, useRef, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { fetchAllSpaceMembers, fetchMyOwnedBots, fetchSpaceBotSnapshots, t, type SpaceMemberLite } from '../octoweb/index.ts'
import { colorFromId } from '../awareness/presence.ts'
import { sortPickerMembers, findMatchRanges, matchesQuery } from './sort.ts'

const DEFAULT_ROLES: Role[] = ['reader', 'commenter', 'writer', 'admin']

/** First glyph of a name for the fallback avatar (uppercased; '?' when empty). */
function initial(name: string): string {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

/**
 * Render `text` with every case-insensitive occurrence of `query` wrapped in a semantic <mark>.
 * Slice-based (text/mark/text React nodes) — never innerHTML — so the original casing is preserved
 * and multiple hits are all marked. No query / no hit → the plain string.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const ranges = query ? findMatchRanges(text, query) : []
  if (ranges.length === 0) return <>{text}</>
  const nodes: Array<string | JSX.Element> = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(
      <mark key={i} className="octo-member-picker-hit">{text.slice(start, end)}</mark>,
    )
    cursor = end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

/**
 * Candidate roster = Space members ∪ the caller's OWNED agents (fetchMyOwnedBots — bots the current
 * user CREATED in this Space, Boss decision) ∪ the Space Bot snapshot (fetchSpaceBotSnapshots).
 * De-duplicated by uid: the Space-member entry wins a uid collision (richer host data), then an
 * owned agent, then a Space Bot backfills creatorUid so the picker can nest that Bot beneath its
 * creator. Both Bot requests are fail-soft and never break the human roster path.
 *
 * Provenance boundary (P1 + Boss ownership): trust to grant a creator-less Bot as a standalone
 * candidate comes ONLY from viewer-scoped, caller-attributable sources — the Space MEMBER roster
 * (queryMembers) or the caller's OWNED agents (fetchMyOwnedBots, /robot/owned_bots). A merely
 * friend-added bot owned by someone else is NOT such a source: it is neither a standalone candidate
 * nor default-selected as "mine" (the earlier /robot/my_bots friend-dimension merge is gone). We
 * track that trusted-uid set SEPARATELY and stamp `safeStandalone` from it, never from "an entry
 * already exists": the Space-Bot catalog is NOT viewer-scoped, so a catalog entry (even a duplicate
 * row sharing a uid with another catalog-only entry) can never confer trust on itself. A
 * creator-less, non-trusted catalog Bot therefore never becomes a grantable standalone (it may
 * still show disabled when already granted); a catalog Bot with a resolvable creator still nests
 * beneath them regardless of trust.
 */
async function fetchCandidateRoster(space: string): Promise<SpaceMemberLite[]> {
  const [members, ownedBots, spaceBots] = await Promise.all([
    fetchAllSpaceMembers(space),
    space ? fetchMyOwnedBots(space).catch(() => [] as SpaceMemberLite[]) : Promise.resolve([]),
    space ? fetchSpaceBotSnapshots(space).catch(() => [] as SpaceMemberLite[]) : Promise.resolve([]),
  ])
  const byUid = new Map<string, SpaceMemberLite>()
  // Trusted-provenance uids come ONLY from viewer-scoped, caller-attributable sources (member
  // roster + the caller's OWNED bots). Tracked separately so a catalog entry can never bootstrap
  // trust off a prior (possibly catalog-only) row.
  const trustedBotUids = new Set<string>()
  for (const m of members) {
    byUid.set(m.uid, m)
    if (m.isBot) trustedBotUids.add(m.uid)
  }
  // Agents the current user OWNS that the space-member query dropped (creator-owned, non-member):
  // append flat, never overwrite a member's richer row.
  for (const b of ownedBots) {
    if (!byUid.has(b.uid)) byUid.set(b.uid, b)
    if (b.isBot) trustedBotUids.add(b.uid)
  }
  // Space Bots backfill creatorUid (+ isBot) so a Bot with a known creator nests beneath them,
  // merging onto whatever entry already exists (member/friend) without discarding its richer data.
  for (const b of spaceBots) {
    const prev = byUid.get(b.uid)
    byUid.set(b.uid, { ...prev, ...b, isBot: true })
  }
  // Stamp safe standalone provenance solely from the trusted-uid set (never from catalog presence).
  for (const uid of trustedBotUids) {
    const entry = byUid.get(uid)
    if (entry) byUid.set(uid, { ...entry, safeStandalone: true })
  }
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
  // uids the user EXPLICITLY collapsed under the current query. A query-hit auto-expands a
  // creator's Bot list (convenience), but the user must be able to collapse it and have it stay
  // collapsed — this override wins over both `expanded` and the query hit. It is scoped to the
  // current search term: changing `query` clears it so a new term restores "hit ⇒ default open".
  // Semantics (intentional): collapsing ALSO drops the uid from `expanded` (see the expander
  // onClick) so the last EXPLICIT user action wins. Keeping it in `expanded` instead would let a
  // later query (even one not hitting this Bot) clear the override and re-open a list the user
  // closed ("ghost expand"); collapse must stay collapse until the user reopens it.
  const [collapsedByUser, setCollapsedByUser] = useState<Set<string>>(new Set())
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

  // A new search term drops every manual-collapse override so the fresh term recovers the
  // "query hits a Bot ⇒ its list defaults open" convenience (behaviour #3).
  useEffect(() => {
    setCollapsedByUser((prev) => (prev.size === 0 ? prev : new Set()))
  }, [query])

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
      // hideUids means "omit ENTIRELY": a doc owner Bot (owner lives in doc_meta, so it is absent
      // from existingUids) must not be nested, default-selected and submitted via its creator.
      if (hideUids?.has(bot.uid)) continue
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

  // Topology-level OFFERED set (independent of the search query): the uids the current roster pass
  // actually renders as selectable top-level rows, split into humans and standalone Bots. This is
  // the authoritative reachability set for the selection invariant (Scope A): a uid may only stay
  // selected while it is still offered here. The query filter only hides rows for display; it never
  // invalidates a selection. Nested Bot uids never appear here (they live under botsByCreator).
  const offered = useMemo(() => {
    const nestedBotUids = new Set<string>()
    for (const bots of botsByCreator.values()) for (const bot of bots) nestedBotUids.add(bot.uid)
    const humanUids = new Set<string>()
    const standaloneBotUids = new Set<string>()
    // Rows to RENDER (includes already-granted rows shown disabled) — a superset of the selectable
    // sets, kept so existing members/Bots stay visible (pinned, disabled) without being selectable.
    const displayHumanUids = new Set<string>()
    const displayStandaloneBotUids = new Set<string>()
    for (const m of members) {
      if (hideUids?.has(m.uid)) continue
      if (!m.isBot) {
        if (nestedBotUids.has(m.uid)) continue
        displayHumanUids.add(m.uid)
        // A human is offered as a selectable candidate only while not already granted (existing).
        // An existing member still renders (pinned, disabled) but can never be re-submitted.
        if (!existingUids.has(m.uid)) humanUids.add(m.uid)
        continue
      }
      if (nestedBotUids.has(m.uid)) continue
      // A Bot is offered standalone when it is NOT nested under a visible creator AND either:
      //   - it carries trusted, caller-attributable provenance (`safeStandalone`: a Space-member
      //     Bot or one the current user OWNS), or
      //   - it is already granted (shown disabled), or
      //   - it has a known creator who is at a legitimate document boundary (hidden self/owner, or
      //     an existing member) so the Bot can no longer nest but stays independently grantable.
      const creatorAtBoundary = !!m.creatorUid &&
        (!!hideUids?.has(m.creatorUid) || existingUids.has(m.creatorUid))
      const alreadyGranted = existingUids.has(m.uid)
      const offeredStandalone = m.safeStandalone === true || alreadyGranted || creatorAtBoundary
      if (!offeredStandalone) continue
      displayStandaloneBotUids.add(m.uid)
      // Already-granted Bots render disabled but are never re-submittable.
      if (!alreadyGranted) standaloneBotUids.add(m.uid)
    }
    return { humanUids, standaloneBotUids, displayHumanUids, displayStandaloneBotUids, nestedBotUids }
  }, [members, existingUids, hideUids, botsByCreator])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Reuse the topology-level OFFERED set so display and the reachability invariant agree on which
    // rows are top-level: a standalone Bot surfaces only with trusted provenance or when already
    // granted (disabled); a known-creator Bot falls back to standalone only at a legitimate document
    // boundary (hidden self/owner or an existing member); a creator-less catalog-only Bot is never a
    // grantable candidate and only appears — disabled — when already granted (existing).
    const topLevel = members.filter((m) =>
      m.isBot ? offered.displayStandaloneBotUids.has(m.uid) : offered.displayHumanUids.has(m.uid),
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
  }, [members, query, existingUids, offered, botsByCreator])

  // Enforce the reachability invariant (Scope A): every uid still in `selected` / `selectedBots`
  // must remain RENDERED, ENABLED, ATTRIBUTABLE and VALID on the current pass. On any roster /
  // existing / hide / topology change we drop selections that no longer qualify:
  //   - Humans: keep only uids still offered as a selectable human row. A human who became
  //     existing/hidden OR whose row vanished from the roster (creator removed, search topology,
  //     roster reload) is pruned so a stale/hidden uid can never ride along in the submitted
  //     snapshot.
  //   - Standalone Bots (tracked inside `selected`): keep only uids still offered as a standalone
  //     Bot row. A standalone Bot whose offered row vanished (its trusted provenance or
  //     already-granted status changed, or it turned nested) is pruned immediately.
  //   - Nested Bots: keep only uids still nested UNDER A CURRENTLY-SELECTED creator. A Bot whose
  //     creator was deselected, became existing/hidden, or turned standalone is pruned.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(
        [...prev].filter((uid) => {
          const entry = memberByUid.get(uid)
          // Unknown uid (roster no longer offers it at all) → drop.
          if (!entry) return false
          return entry.isBot ? offered.standaloneBotUids.has(uid) : offered.humanUids.has(uid)
        }),
      )
      return next.size === prev.size ? prev : next
    })
    setSelectedBots((prev) => {
      if (prev.size === 0) return prev
      const selectable = new Set<string>()
      for (const [creatorUid, bots] of botsByCreator) {
        if (!selected.has(creatorUid)) continue
        for (const b of bots) selectable.add(b.uid)
      }
      const next = new Set([...prev].filter((uid) => selectable.has(uid)))
      return next.size === prev.size ? prev : next
    })
  }, [memberByUid, offered, botsByCreator, selected])

  // Toggle a human row. Both state transitions happen in the EVENT phase as independent, pure
  // setter calls (no setter nested inside another updater) so React StrictMode's double-invoked
  // updaters stay side-effect free. Selecting a human defaults all their nested Bots on; deselecting
  // drops those Bots. Each updater derives purely from its own previous state.
  function toggle(uid: string) {
    const bots = botsByCreator.get(uid) ?? []
    const willSelect = !selected.has(uid)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
    if (bots.length === 0) return
    setSelectedBots((prev) => {
      const next = new Set(prev)
      if (willSelect) bots.forEach((bot) => next.add(bot.uid))
      else bots.forEach((bot) => next.delete(bot.uid))
      return next
    })
  }

  // Toggle one nested Bot. Guarded: a Bot may only enter the selection while its creator is
  // selected (the UI already disables the control when the human is unselected; this keeps the
  // invariant even if invoked directly). Deselecting is always allowed.
  function toggleBot(uid: string) {
    setSelectedBots((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) {
        next.delete(uid)
        return next
      }
      let creatorSelected = false
      for (const [creatorUid, bots] of botsByCreator) {
        if (bots.some((b) => b.uid === uid)) {
          creatorSelected = selected.has(creatorUid)
          break
        }
      }
      if (!creatorSelected) return prev
      next.add(uid)
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
    // Defensive intersection with the CURRENT offered sets (Scope A). Even if state briefly lagged
    // a render, only uids still offered may submit; a uid whose row vanished is excluded, and a Bot
    // is classified strictly by `memberByUid[...].isBot` — a vanished/unknown uid is dropped, never
    // silently reclassified as a human.
    const { humanUids, standaloneBotUids, nestedBotUids } = submittable
    const botUids = [...new Set([...nestedBotUids, ...standaloneBotUids])]
    const uids = [...new Set([...humanUids, ...botUids])]
    if (uids.length === 0) return
    if (botUids.length > 0) await onAdd(uids, submittedRole, { humanUids, botUids })
    else await onAdd(uids, submittedRole)
    setSelected(new Set())
    setSelectedBots(new Set())
    setQuery('')
  }

  // The button label and the submitted payload MUST be derived from one classification, otherwise the
  // label can count a uid the submission drops (e.g. an unknown uid read as a human).
  const submittable = useMemo(() => {
    const humanUids = [...selected].filter((uid) => {
      const entry = memberByUid.get(uid)
      return !!entry && !entry.isBot && offered.humanUids.has(uid)
    })
    const standaloneBotUids = [...selected].filter((uid) => {
      const entry = memberByUid.get(uid)
      return !!entry && entry.isBot === true && offered.standaloneBotUids.has(uid)
    })
    // Only nested Bots whose creator is currently selected may ride along — a defensive re-check so
    // no stale/hidden Bot selection can submit even if state briefly lagged a render (P1).
    const selectableNested = new Set<string>()
    for (const [creatorUid, bots] of botsByCreator) {
      if (!selected.has(creatorUid)) continue
      for (const b of bots) selectableNested.add(b.uid)
    }
    const nestedBotUids = [...selectedBots].filter((uid) => selectableNested.has(uid))
    return { humanUids, standaloneBotUids, nestedBotUids }
  }, [selected, selectedBots, memberByUid, offered, botsByCreator])

  const selectedHumanCount = submittable.humanUids.length
  const selectedBotCount =
    new Set([...submittable.nestedBotUids, ...submittable.standaloneBotUids]).size
  const count = selectedHumanCount + selectedBotCount

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
          // Every human with eligible nested Bots exposes the expander regardless of selection
          // (UX #3): the admin can inspect a person's Bots before selecting them. While the person
          // is unselected, the nested Bot controls are read-only (disabled) and create no selection;
          // selecting the person defaults all their Bots on (see toggle). The active query also
          // force-expands a creator whose Bot matched, so a Bot search reveals it under its creator.
          const q = query.trim().toLowerCase()
          const nameHit = matchesQuery(m.name, q)
          const uidHit = matchesQuery(m.uid, q)
          // Show the uid only when it explains the match: uid hit while the name did NOT (so the
          // admin sees why a name-less match surfaced). A pure name hit stays uid-free to avoid
          // hanging a hex string on every row.
          const showUid = !!q && uidHit && !nameHit
          // A top-level row that is itself a Bot (standalone) and matches the query earns the
          // "matched" tag, mirroring the nested-Bot treatment (#3).
          const selfBotMatched = m.isBot && !!q && (nameHit || uidHit)
          const queryHitsBot =
            !!q && bots.some((b) => matchesQuery(b.name, q) || matchesQuery(b.uid, q))
          const matchedBotCount = q
            ? bots.filter((b) => matchesQuery(b.name, q) || matchesQuery(b.uid, q)).length
            : 0
          const showBots = bots.length > 0
          // A user's explicit collapse (scoped to this query) wins over both the click-expand set
          // and the query auto-expand; otherwise a click-expand or a query hit opens the list.
          const isExpanded = collapsedByUser.has(m.uid)
            ? false
            : expanded.has(m.uid) || queryHitsBot
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
              {/* Selection indicator: an SVG tick, never a text/unicode glyph (UI spec). */}
              <span
                className={'octo-member-picker-check' + (isSelected ? ' is-checked' : '')}
                aria-hidden="true"
              >
                {isSelected && (
                  <svg viewBox="0 0 16 16" width="10" height="10" focusable="false" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span
                className="octo-member-picker-avatar"
                style={m.avatar ? undefined : { backgroundColor: colorFromId(m.uid) }}
              >
                {m.avatar ? <img src={m.avatar} alt="" /> : initial(m.name)}
              </span>
              <span className="octo-member-picker-name"><HighlightedText text={m.name} query={q} /></span>
              {showUid && (
                <span className="octo-member-picker-uid" aria-hidden="true">
                  <HighlightedText text={m.uid} query={q} />
                </span>
              )}
              {m.isBot && <span className="octo-member-picker-badge">{t('docs.member.aiTag')}</span>}
              {selfBotMatched && (
                <span className="octo-member-picker-matched">{t('docs.member.matchedTag')}</span>
              )}
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
                {/* Expander is its own control: clicking it toggles the Bot list, never the human
                    row's selection (UX #3). Chevron is decorative; state is on aria-expanded. */}
                <button type="button" className="octo-member-picker-expand" aria-expanded={isExpanded}
                  onClick={() => {
                    // Toggle from the ACTUAL rendered state (isExpanded), not just `expanded`, so a
                    // query-auto-expanded list collapses on the first click. Keep both sets coherent:
                    // collapsing records the override + clears the click-expand; expanding clears the
                    // override + records the click-expand.
                    if (isExpanded) {
                      setCollapsedByUser((prev) => { const next = new Set(prev); next.add(m.uid); return next })
                      setExpanded((prev) => { if (!prev.has(m.uid)) return prev; const next = new Set(prev); next.delete(m.uid); return next })
                    } else {
                      setCollapsedByUser((prev) => { if (!prev.has(m.uid)) return prev; const next = new Set(prev); next.delete(m.uid); return next })
                      setExpanded((prev) => { const next = new Set(prev); next.add(m.uid); return next })
                    }
                  }}>
                  <span className="octo-member-picker-chevron" aria-hidden="true" />
                  {isExpanded
                    ? t('docs.member.hideBots', { values: { count: bots.length } })
                    : matchedBotCount > 0
                      ? t('docs.member.showBotsWithMatch', { values: { count: bots.length, matched: matchedBotCount } })
                      : t('docs.member.showBots', { values: { count: bots.length } })}
                </button>
                {isExpanded && bots.map((bot) => {
                  const botNameHit = matchesQuery(bot.name, q)
                  const botUidHit = matchesQuery(bot.uid, q)
                  const botMatched = botNameHit || botUidHit
                  // Same rule as the top-level row: surface the uid only when IT is what matched.
                  // Without this a uid-only Bot hit shows the "matched" tag with nothing highlighted
                  // to explain it — the exact black box this feature exists to remove.
                  const showBotUid = botUidHit && !botNameHit
                  return (
                  // Bot controls are live only while the human is selected. When the human is
                  // unselected the checkbox is a disabled, read-only preview: inspecting a Bot must
                  // create no Bot selection. Selecting the human defaults these on (see toggle).
                  <label key={bot.uid} className={'octo-member-picker-bot' + (isSelected ? '' : ' is-preview')}>
                    <input type="checkbox" checked={isSelected && selectedBots.has(bot.uid)}
                      disabled={!isSelected} onChange={() => toggleBot(bot.uid)} />
                    <span><HighlightedText text={bot.name} query={q} /></span><span className="octo-member-picker-badge">{t('docs.member.aiTag')}</span>
                    {showBotUid && (
                      <span className="octo-member-picker-uid" aria-hidden="true">
                        <HighlightedText text={bot.uid} query={q} />
                      </span>
                    )}
                    {botMatched && <span className="octo-member-picker-matched">{t('docs.member.matchedTag')}</span>}
                    <span className="octo-member-picker-bot-creator">{t('docs.member.botCreator', { values: { name: m.name } })}</span>
                  </label>
                  )
                })}
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
          {selectedBotCount > 0
            ? t('docs.member.addSnapshotCount', { values: { people: selectedHumanCount, bots: selectedBotCount } })
            : selectedHumanCount > 1
              ? t('docs.member.addCount', { values: { count: selectedHumanCount } })
              : t('docs.member.add')}
        </button>
      </div>
    </div>
  )
}
