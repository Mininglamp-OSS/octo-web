import { useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { PortalMenu } from './PortalMenu.tsx'
import type { CreatorOption } from './docsApi.ts'

/**
 * Resolve a creator's display name: prefer the server-resolved facet `name` (frontend-design §3.5),
 * then the space member-name map fallback, then the raw uid. Kept pure + shared so the dropdown and
 * the chips label creators identically.
 */
export function creatorName(
  uid: string,
  options: CreatorOption[],
  nameFallback: (uid: string) => string | undefined,
): string {
  const opt = options.find((o) => o.uid === uid)
  const name = (opt?.name || '').trim()
  if (name) return name
  const fallback = (nameFallback(uid) || '').trim()
  return fallback || uid
}

/**
 * Multi-select creator filter for the recent tab (frontend-design §5.2). Opens a body-portal menu
 * (reusing PortalMenu) of checkbox rows sourced from the server `recent/creators` facet — the
 * candidate set is the whole recent result set's distinct owners AFTER `q`, BEFORE creator filter,
 * BEFORE pagination, so every creator is selectable without scrolling the list. Selections are OR'd
 * server-side. The button shows the selected count; chips (see CreatorChips) render below the toolbar.
 */
export function CreatorFilter({
  options,
  selected,
  onToggle,
  nameFallback,
}: {
  options: CreatorOption[]
  selected: string[]
  onToggle: (uid: string) => void
  nameFallback: (uid: string) => string | undefined
}): React.ReactElement {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const open = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt(at ? null : { left: r.left, top: r.bottom + 6 })
  }

  const label =
    selected.length > 0
      ? `${t('docs.filter.creator')} (${selected.length})`
      : t('docs.filter.creator')

  return (
    <div className="octo-docs-filter">
      <button
        ref={btnRef}
        type="button"
        className={
          selected.length > 0
            ? 'octo-docs-filter-btn octo-docs-filter-btn-active'
            : 'octo-docs-filter-btn'
        }
        aria-haspopup="menu"
        aria-expanded={at != null}
        onClick={open}
      >
        {label}
        <span className="octo-docs-filter-caret" aria-hidden="true">▾</span>
      </button>
      {at && (
        <PortalMenu at={at} onClose={() => setAt(null)} minWidth={200}>
          {options.length === 0 ? (
            <div className="octo-docs-filter-option octo-docs-filter-option-empty">
              {t('docs.filter.noCreators')}
            </div>
          ) : (
            options.map((o) => {
              const checked = selected.includes(o.uid)
              return (
                <label key={o.uid} className="octo-docs-filter-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(o.uid)}
                  />
                  <span className="octo-docs-filter-option-name">
                    {creatorName(o.uid, options, nameFallback)}
                  </span>
                </label>
              )
            })
          )}
        </PortalMenu>
      )}
    </div>
  )
}

/**
 * Chips row for the selected creators (frontend-design §5.2). Each chip removes its creator; a
 * trailing "clear all" clears the filter. Rendered below the toolbar only when something is selected.
 */
export function CreatorChips({
  options,
  selected,
  onToggle,
  onClearAll,
  nameFallback,
}: {
  options: CreatorOption[]
  selected: string[]
  onToggle: (uid: string) => void
  onClearAll: () => void
  nameFallback: (uid: string) => string | undefined
}): React.ReactElement | null {
  if (selected.length === 0) return null
  return (
    <div className="octo-docs-filter-chips">
      {selected.map((uid) => (
        <span key={uid} className="octo-docs-filter-chip">
          {creatorName(uid, options, nameFallback)}
          <button
            type="button"
            className="octo-docs-filter-chip-x"
            aria-label={creatorName(uid, options, nameFallback)}
            onClick={() => onToggle(uid)}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="octo-docs-filter-clear" onClick={onClearAll}>
        {t('docs.filter.clearAll')}
      </button>
    </div>
  )
}
