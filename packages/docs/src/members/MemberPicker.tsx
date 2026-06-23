import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { fetchAllSpaceMembers, t, type SpaceMemberLite } from '../octoweb/index.ts'
import { colorFromId } from '../awareness/presence.ts'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/** First glyph of a name for the fallback avatar (uppercased; '?' when empty). */
function initial(name: string): string {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

/**
 * Searchable space-member picker (Problem 1). Replaces the raw uid <input>: lists the real
 * space members (via fetchAllSpaceMembers through the octoweb seam) with avatar + name + a
 * human/AI badge, filters locally by name/uid, marks already-added members disabled, then lets
 * the admin choose a role and add. Zero backend beyond the existing member-list seam.
 */
export function MemberPicker({
  space,
  existingUids,
  onAdd,
  busy,
}: {
  /** Space id used to fetch the member roster; absent → empty list (falls back gracefully). */
  space?: string
  /** uids already on the document (rendered disabled / "already added"). */
  existingUids: Set<string>
  /** Add the chosen member with the chosen role. */
  onAdd: (uid: string, role: Role) => Promise<void> | void
  /** True while a parent add/refresh is in flight (disables the Add button). */
  busy?: boolean
}) {
  const [members, setMembers] = useState<SpaceMemberLite[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
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
    if (!q) return members
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.uid.toLowerCase().includes(q),
    )
  }, [members, query])

  // Drop a stale selection if it falls out of the filtered view.
  useEffect(() => {
    if (selectedUid && !filtered.some((m) => m.uid === selectedUid)) setSelectedUid(null)
  }, [filtered, selectedUid])

  async function add() {
    if (!selectedUid) return
    await onAdd(selectedUid, role)
    setSelectedUid(null)
    setQuery('')
  }

  return (
    <div className="octo-member-picker">
      <input
        className="octo-member-picker-search"
        placeholder={t('docs.member.pickPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="octo-member-picker-list" role="listbox">
        {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
        {!loading && filtered.length === 0 && (
          <p className="octo-member-picker-empty">{t('docs.member.noMembers')}</p>
        )}
        {filtered.map((m) => {
          const added = existingUids.has(m.uid)
          const selected = selectedUid === m.uid
          return (
            <button
              type="button"
              key={m.uid}
              role="option"
              aria-selected={selected}
              className={
                'octo-member-picker-item' +
                (selected ? ' is-selected' : '') +
                (added ? ' is-added' : '')
              }
              disabled={added}
              title={added ? t('docs.member.alreadyAdded') : undefined}
              onClick={() => setSelectedUid(m.uid)}
            >
              <span
                className="octo-member-picker-avatar"
                style={m.avatar ? undefined : { backgroundColor: colorFromId(m.uid) }}
              >
                {m.avatar ? (
                  <img src={m.avatar} alt="" />
                ) : (
                  initial(m.name)
                )}
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
        <button
          type="button"
          className="octo-tb-btn"
          disabled={!selectedUid || busy}
          onClick={add}
        >
          {t('docs.member.add')}
        </button>
      </div>
    </div>
  )
}
